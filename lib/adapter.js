/**
 * The provider adapter.
 *
 * Protocol work is delegated: `@dsh-ai-providers/openai-compatible` already
 * speaks `chat/completions`, including streaming, tool calls, reasoning
 * deltas, image parts and retries. What is left here is the seam between the
 * host's request shape and that service's `LlmCall`: build the route from the
 * live catalog, merge the sampling controls, and dispatch.
 *
 * The transport is imported lazily so a missing or broken dependency leaves the
 * settings panel fully usable and only disables chat, with an error that says
 * exactly that.
 * @module dsh-sub2api/adapter
 */

import { LlmAdapter, attributionHeaders } from "@deepseek-ai/dsh-llm";
import { PROVIDER } from "./constants.js";
import { Sub2ApiError } from "./util.js";

/** @type {Promise<any> | undefined} */
let transportModule;

/**
 * Load the reused transport once. A rejection is remembered: retrying a broken
 * dependency on every request would turn one clear error into a stream of them.
 * @returns {Promise<any>}
 */
export function loadTransport() {
  if (transportModule === undefined) {
    transportModule = import("@dsh-ai-providers/openai-compatible").catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Sub2ApiError(
        `缺少 @dsh-ai-providers/openai-compatible（${detail}）。安装插件时请一并安装依赖。`,
        { code: "transport_missing", cause: error },
      );
    });
  }
  return transportModule;
}

/**
 * A `Volatile<T>` backed by a getter.
 *
 * The transport reads its configuration through `Volatile.get()` on every call,
 * which is what lets a refreshed catalog apply without rebuilding the service.
 * A snapshot from `createVolatile` would freeze the first catalog forever.
 * @template T
 * @param {() => T} get
 * @returns {{get: () => T}}
 */
export function liveRef(get) {
  return { get };
}

export class Sub2ApiAdapter extends LlmAdapter {
  /**
   * @param {object} deps
   * @param {() => any} deps.ctx host context, for the credential and attachment services
   * @param {import("./sub2api/catalog.js").ModelCatalog} deps.catalog
   * @param {() => string} deps.apiBase
   * @param {() => string} deps.apiKeyEnv credential reference holding the key
   * @param {() => number} deps.timeoutMs
   * @param {() => number} deps.idleTimeoutMs
   * @param {{warn: Function}} [deps.logger]
   */
  constructor(deps) {
    super();
    this.deps = deps;
    /** @type {any} */
    this.service = undefined;
  }

  /** Build the transport on first use, once the catalog has something to offer. */
  async #service() {
    if (this.service !== undefined) return this.service;

    const module = await loadTransport();
    const { OpenAiLlmService } = module;
    if (typeof OpenAiLlmService !== "function") {
      throw new Sub2ApiError("@dsh-ai-providers/openai-compatible 未导出 OpenAiLlmService", {
        code: "transport_broken",
      });
    }

    const deps = this.deps;
    const config = {
      connections: liveRef(() => [
        {
          id: PROVIDER,
          name: "Sub2API",
          baseUrl: `${deps.apiBase()}/v1`,
          apiKeyRef: deps.apiKeyEnv(),
        },
      ]),
      llmRoutes: liveRef(() => [
        {
          id: PROVIDER,
          name: "Sub2API",
          connection: PROVIDER,
          models: deps.catalog.llmModels(),
          maxCompletionTokens: false,
        },
      ]),
      llmIdleTimeoutMs: liveRef(() => deps.idleTimeoutMs()),
      timeoutMs: liveRef(() => deps.timeoutMs()),
      batchSize: liveRef(() => 16),
    };

    this.service = new OpenAiLlmService({
      config,
      provider: PROVIDER,
      credentials: () => optionalService(deps.ctx, "credentials"),
      images: () => optionalService(deps.ctx, "attachments"),
    });
    return this.service;
  }

  providerInfo(provider) {
    return { id: provider, name: "Sub2API" };
  }

  async listModels(provider) {
    await this.deps.catalog.load();
    return this.deps.catalog.listModels(provider);
  }

  /**
   * Per-model facts the host uses for context metering and auto-compaction.
   * The base class would answer with the id as the name and no capacity at all.
   */
  async resolveModel(provider, model) {
    await this.deps.catalog.load();
    const known = this.deps.catalog.visible().find((entry) => entry.id === model);
    /** @type {Record<string, unknown>} */
    const resolved = { provider, id: model, name: known?.name ?? model };
    if (known?.contextWindow !== undefined) resolved.context = { contextWindow: known.contextWindow };
    if (known?.maxTokens !== undefined) resolved.defaultMaxTokens = known.maxTokens;
    if (known?.vision === true) resolved.inputModalities = ["text", "image"];

    // Declaring the levels is the only way the picker offers a thinking control:
    // the host rejects any effort a model has not declared.
    const reasoning = this.deps.catalog.reasoningFor(model);
    if (reasoning !== undefined) {
      resolved.reasoning = {
        efforts: reasoning.efforts.map((effort) => ({ id: effort.id, name: effort.name })),
        ...(reasoning.defaultEffort === undefined ? {} : { defaultEffort: reasoning.defaultEffort }),
      };
    }
    return resolved;
  }

  async *stream(options) {
    const service = await this.#service();
    const route = service.routes()[0];
    // An empty `models` array still yields a route object; without this check
    // the transport would build a request with no model and fail at the wire.
    if (route === undefined || route.models.length === 0) {
      throw new Sub2ApiError("尚未同步到可用模型，请先在 Sub2API 面板登录或刷新模型", {
        code: "no_models",
      });
    }

    const model = route.models.find((entry) => entry.id === options.model);

    // The transport forwards `sampling.body` verbatim, so the chosen level's
    // fields have to land there; the host only validates the id.
    const sampling = mergeSampling(route.sampling, model?.sampling, options);
    const effort = selectedEffort(model, options.reasoningEffort);
    if (effort !== undefined) {
      sampling.body = { ...(sampling.body ?? {}), ...effort.body };
    }

    /** @type {any} */
    const call = {
      options,
      route,
      model,
      sampling,
      headers: safeAttributionHeaders(),
    };

    // A dropped connection before the first chunk is safe to retry: nothing was
    // shown to the user and nothing was billed. The host retries some of these
    // too, but its budget is shared with every other failure class, so a single
    // reset can consume it and surface as a terminal error.
    const attempts = Math.max(0, Math.min(5, this.deps.transportRetries?.() ?? 1));
    let attempt = 0;

    for (;;) {
      let emitted = false;
      try {
        for await (const chunk of service.stream(call)) {
          emitted = true;
          yield chunk;
        }
        return;
      } catch (error) {
        const canRetry =
          !emitted &&
          attempt < attempts &&
          options.signal?.aborted !== true &&
          isTransportFailure(error);
        if (!canRetry) throw describeStreamFailure(error, emitted, attempt);
        attempt += 1;
        this.deps.logger?.warn?.(
          `[sub2api] 连接中断，第 ${attempt} 次重试：${String(error?.message ?? error).slice(0, 120)}`,
        );
        await delay(400 * attempt);
      }
    }
  }
}

/**
 * Merge the sampling controls the request sets over the route's and the
 * model's defaults. Explicit `undefined` must not erase a configured default.
 * @param {any} routeSampling
 * @param {any} modelSampling
 * @param {any} options
 */
export function mergeSampling(routeSampling, modelSampling, options) {
  /** @type {Record<string, unknown>} */
  const merged = { ...(modelSampling ?? {}), ...(routeSampling ?? {}) };
  const overlay = {
    temperature: options?.temperature,
    topP: options?.topP,
    maxTokens: options?.maxTokens,
    stop: options?.stop,
  };
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/** Whether a failure came from the transport rather than the endpoint's answer. */
export function isTransportFailure(error) {
  const code = String(error?.code ?? "");
  if (code === "TRANSPORT" || code === "TIMEOUT") return true;
  const message = String(error?.message ?? "");
  return /fetch failed|could not be reached|connection dropped|socket hang up|ECONNRESET|ETIMEDOUT|EPIPE/i.test(
    message,
  );
}

/**
 * Name the endpoint that actually failed.
 *
 * The transport reports the connection's base URL, so the thrown message reads
 * "https://host/v1 could not be reached" even though the request went to
 * /v1/chat/completions. That sends people looking at the wrong thing.
 */
export function describeStreamFailure(error, emitted, attempts) {
  const message = String(error?.message ?? error);
  const isTransport = isTransportFailure(error);
  if (!isTransport) return error;

  const retryNote = attempts > 0 ? `，已重试 ${attempts} 次` : "";
  const midStream = emitted ? "，回复中途断开" : "";
  const hint =
    "；如果这条会话很长，可能是等待首字超时，可在插件配置里调大 streamIdleTimeoutMs";
  return new Sub2ApiError(
    `与中转站的连接中断（/chat/completions${retryNote}${midStream}）${hint}。原始信息：${message}`,
    { code: error?.code ?? "TRANSPORT", cause: error },
  );
}

/** Sleep between retries. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The level a request selected, matched by id against the model's declared
 * levels. An unknown id yields undefined rather than guessing.
 * @param {any} model
 * @param {unknown} id
 */
export function selectedEffort(model, id) {
  if (id === undefined || id === null) return undefined;
  const levels = model?.reasoningLevels;
  if (!Array.isArray(levels)) return undefined;
  return levels.find((level) => String(level.id) === String(id));
}

/** Read an optional host service without letting an absent one abort the call. */
function optionalService(ctx, name) {
  try {
    return ctx?.get?.(name);
  } catch {
    return undefined;
  }
}

/** Harness attribution headers, when the host exports them. */
function safeAttributionHeaders() {
  try {
    return typeof attributionHeaders === "function" ? attributionHeaders() : {};
  } catch {
    return {};
  }
}
