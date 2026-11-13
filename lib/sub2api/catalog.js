/**
 * Upstream model catalog.
 *
 * The site is the source of truth: `/v1/models` returns whatever the operator
 * has routed, and the panel must follow it without the user editing a list.
 * The catalog is cached on disk so a restart shows models before the first
 * network call, and refreshed on a TTL and on demand.
 * @module dsh-sub2api/sub2api/catalog
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CATALOG_TTL_MS, VISION_HINTS } from "../constants.js";
import { Sub2ApiError } from "../util.js";

/**
 * @typedef {object} ModelRecord
 * @property {string} id upstream model id, the value a request names
 * @property {string} name display name
 * @property {string} [ownedBy]
 * @property {number} [contextWindow]
 * @property {number} [maxTokens]
 * @property {boolean} [vision]
 * @property {string} [description]
 */

export class ModelCatalog {
  /**
   * @param {object} deps
   * @param {import("./api.js").Sub2ApiApi} deps.api
   * @param {() => string} deps.cachePath
   * @param {() => (string | undefined)} deps.visibleModels allowlist, empty means all
   * @param {() => (number | undefined)} deps.contextWindow forced context window
   * @param {(apiKey: string) => Promise<string | undefined>} deps.apiKey resolves the stored key
   * @param {{info: Function, warn: Function}} [deps.logger]
   */
  constructor(deps) {
    this.deps = deps;
    this.logger = deps.logger ?? { info() {}, warn() {} };
    /** @type {ModelRecord[]} */
    this.models = [];
    this.fetchedAt = 0;
    this.loaded = false;
    this.inflight = undefined;
  }

  /** Read the disk cache once, so a cold start is not an empty picker. */
  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const text = await readFile(this.deps.cachePath(), "utf8");
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed?.models)) {
        this.models = parsed.models.filter(isModelRecord);
        this.fetchedAt = Number(parsed.fetchedAt) || 0;
      }
    } catch {
      // No cache yet is the normal first run.
    }
  }

  /** Whether the cached snapshot is older than the TTL. */
  get stale() {
    return Date.now() - this.fetchedAt > CATALOG_TTL_MS;
  }

  /**
   * Refresh from the gateway and persist.
   * @param {string} [apiKey] overrides the stored key (used right after provisioning)
   * @param {AbortSignal} [signal]
   * @returns {Promise<number>} how many models are now known
   */
  async refresh(apiKey, signal) {
    const explicit = typeof apiKey === "string" && apiKey !== "";

    // Dedupe only among callers asking for the same thing. The warm-up runs
    // with no key at all; letting it share this slot would poison a later
    // explicit refresh with its "no key" failure.
    if (this.inflight !== undefined && (!explicit || this.inflightKey === apiKey)) {
      return this.inflight;
    }

    const key = explicit ? apiKey : await this.deps.apiKey();
    this.inflightKey = key;

    this.inflight = (async () => {
      try {
        if (!key) throw new Sub2ApiError("还没有可用的 API Key，无法同步模型", { code: "no_api_key" });
        const payload = await this.deps.api.gatewayModels(key, signal);
        const records = normalizeModels(payload);
        if (records.length === 0) {
          throw new Sub2ApiError("上游没有返回任何模型", { code: "empty_catalog" });
        }
        this.models = records;
        this.fetchedAt = Date.now();
        await this.#persist();
        this.logger.info?.(`[sub2api] 模型目录已同步：${records.length} 个`);
        return records.length;
      } finally {
        this.inflight = undefined;
        this.inflightKey = undefined;
      }
    })();

    return this.inflight;
  }

  /** Refresh only when the snapshot is stale; failures keep the old snapshot. */
  async ensureFresh(signal) {
    await this.load();
    if (!this.stale && this.models.length > 0) return this.models.length;
    // Without a key there is nothing to ask the gateway; stay on the cache
    // instead of recording a failure the user never triggered.
    if ((await this.deps.apiKey()) === undefined) return this.models.length;
    try {
      return await this.refresh(undefined, signal);
    } catch (error) {
      this.logger.warn?.(`[sub2api] 模型同步失败，沿用缓存：${describe(error)}`);
      return this.models.length;
    }
  }

  /** Models as the picker should see them: allowlist applied, forced context honored. */
  visible() {
    const allow = this.deps.visibleModels() ?? [];
    const forcedContext = this.deps.contextWindow();
    return this.models
      .filter((model) => allow.length === 0 || allow.includes(model.id))
      .map((model) =>
        forcedContext === undefined ? model : { ...model, contextWindow: forcedContext },
      );
  }

  /**
   * The shape the reused transport wants (`OpenAiLlmModelConfig`).
   * @returns {Array<Record<string, unknown>>}
   */
  llmModels() {
    return this.visible().map((model) => {
      /** @type {Record<string, unknown>} */
      const entry = { id: model.id, name: model.name };
      if (model.contextWindow !== undefined) entry.contextWindow = model.contextWindow;
      if (model.maxTokens !== undefined) entry.maxTokens = model.maxTokens;
      if (model.vision === true) entry.vision = true;
      return entry;
    });
  }

  /** The shape the host's model picker wants (`LlmModelInfo`). */
  listModels(provider) {
    return this.visible().map((model) => {
      /** @type {Record<string, unknown>} */
      const entry = {
        provider,
        id: model.id,
        name: model.name,
        inputModalities: model.vision === true ? ["text", "image"] : ["text"],
      };
      if (model.description) entry.description = model.description;
      return entry;
    });
  }

  /** Snapshot for the panel: everything the user may need to judge a model. */
  snapshot() {
    return {
      fetchedAt: this.fetchedAt,
      stale: this.stale,
      models: this.visible().map((model) => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow ?? null,
        maxTokens: model.maxTokens ?? null,
        vision: model.vision === true,
        ownedBy: model.ownedBy ?? null,
      })),
    };
  }

  async #persist() {
    const path = this.deps.cachePath();
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({ fetchedAt: this.fetchedAt, models: this.models }, null, 0),
        { mode: 0o600 },
      );
    } catch (error) {
      this.logger.warn?.(`[sub2api] 模型缓存写入失败：${describe(error)}`);
    }
  }
}

/**
 * Accept every shape an OpenAI-compatible `/v1/models` may reasonably return,
 * including the sub2api envelope that is already unwrapped by `requestJson`.
 * @param {any} payload
 * @returns {ModelRecord[]}
 */
export function normalizeModels(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload?.data?.data)
          ? payload.data.data
          : [];

  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const id = typeof raw === "string" ? raw : raw?.id;
    if (typeof id !== "string" || id.trim() === "" || seen.has(id)) continue;
    seen.add(id);
    out.push(normalizeOne(raw, id.trim()));
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** @returns {ModelRecord} */
function normalizeOne(raw, id) {
  /** @type {ModelRecord} */
  const record = { id, name: displayName(id) };
  if (typeof raw !== "object" || raw === null) return record;

  if (typeof raw.owned_by === "string") record.ownedBy = raw.owned_by;
  if (typeof raw.description === "string" && raw.description.trim() !== "") {
    record.description = raw.description;
  }

  const context =
    firstNumber(
      raw.context_length,
      raw.context_window,
      raw.max_context_length,
      raw.max_input_tokens,
      raw.limits?.context_window,
    ) ?? undefined;
  if (context !== undefined) record.contextWindow = context;

  const maxTokens =
    firstNumber(
      raw.max_output_tokens,
      raw.max_completion_tokens,
      raw.max_tokens,
      raw.limits?.max_output_tokens,
    ) ?? undefined;
  if (maxTokens !== undefined) record.maxTokens = maxTokens;

  const capabilities = raw.capabilities ?? raw.features ?? raw.modalities;
  if (declaresVision(capabilities)) record.vision = true;
  else if (declaresTextOnly(capabilities)) record.vision = false;
  else if (VISION_HINTS.some((hint) => id.toLowerCase().includes(hint))) record.vision = true;

  return record;
}

/** A model id is the only reliable label; strip a provider prefix for display. */
function displayName(id) {
  const tail = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return tail === "" ? id : tail;
}

/** First finite positive number among the candidates. */
function firstNumber(...values) {
  for (const value of values) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return undefined;
}

/** Whether a capability declaration says pictures are accepted. */
function declaresVision(capabilities) {
  if (capabilities === undefined || capabilities === null) return false;
  if (Array.isArray(capabilities)) {
    return capabilities.some((item) => String(item).toLowerCase() === "image");
  }
  if (typeof capabilities === "object") {
    if (capabilities.vision === true || capabilities.image === true) return true;
    const inputs = capabilities.input_modalities ?? capabilities.inputs;
    if (Array.isArray(inputs)) return inputs.some((item) => String(item).toLowerCase() === "image");
  }
  return false;
}

/** An explicit text-only declaration must beat the id heuristics. */
function declaresTextOnly(capabilities) {
  if (capabilities === undefined || capabilities === null || Array.isArray(capabilities)) {
    return false;
  }
  if (typeof capabilities !== "object") return false;
  if (capabilities.vision === false || capabilities.image === false) return true;
  const inputs = capabilities.input_modalities ?? capabilities.inputs;
  return Array.isArray(inputs) && !inputs.some((item) => String(item).toLowerCase() === "image");
}

/** Whether a cached entry still has the fields this module reads. */
function isModelRecord(value) {
  return Boolean(value) && typeof value === "object" && typeof value.id === "string";
}

/** @param {unknown} error */
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
