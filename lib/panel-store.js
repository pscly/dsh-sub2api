/**
 * Panel-owned state: which models to show, and per-model corrections.
 *
 * Neither belongs in the settings document. A list of upstream ids is not a
 * schema, and a per-model number the operator never set is noise in a YAML
 * file. Both live in one small sidecar next to the catalog cache instead.
 * @module dsh-sub2api/panel-store
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** @typedef {{visible: string[], contextOverrides: Record<string, number>}} PanelState */

export class PanelStore {
  /**
   * @param {object} deps
   * @param {() => string} deps.path where the sidecar lives
   * @param {() => string} [deps.legacyPath] older allowlist-only file to migrate from
   * @param {{warn: Function}} [deps.logger]
   */
  constructor(deps) {
    this.deps = deps;
    this.logger = deps.logger ?? { warn() {} };
    /** @type {PanelState} */
    this.state = { visible: [], contextOverrides: {} };
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return this.state;
    this.loaded = true;

    const fromJson = async (path) => {
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch {
        return undefined;
      }
    };

    const parsed = await fromJson(this.deps.path());
    if (parsed !== undefined) {
      this.state = normalizeState(parsed);
      return this.state;
    }

    // Migrate the allowlist-only file written by 0.1.6 and earlier.
    const legacyPath = this.deps.legacyPath?.();
    if (legacyPath) {
      const legacy = await fromJson(legacyPath);
      if (Array.isArray(legacy?.ids)) {
        this.state = normalizeState({ visible: legacy.ids });
        await this.#persist();
      }
    }
    return this.state;
  }

  /** @returns {string[]} allowlist; empty means "show every model" */
  visible() {
    return this.state.visible;
  }

  /** @param {string} id @returns {number | undefined} */
  contextOverride(id) {
    const value = this.state.contextOverrides[id];
    return typeof value === "number" && value > 0 ? value : undefined;
  }

  /** @returns {Record<string, number>} */
  contextOverrides() {
    return { ...this.state.contextOverrides };
  }

  /**
   * @param {string[]} ids an empty list restores "show all"
   * @returns {Promise<string[]>}
   */
  async setVisible(ids) {
    this.state.visible = cleanIds(ids);
    await this.#persist();
    return this.state.visible;
  }

  /**
   * @param {string} id model id
   * @param {number | null | undefined} value positive tokens, or null/undefined to clear
   * @returns {Promise<Record<string, number>>}
   */
  async setContextOverride(id, value) {
    const modelId = String(id ?? "").trim();
    if (modelId === "") return this.contextOverrides();

    if (value === null || value === undefined || value === "") {
      delete this.state.contextOverrides[modelId];
    } else {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        throw new TypeError(`上下文窗口必须是正数，收到 ${String(value)}`);
      }
      this.state.contextOverrides[modelId] = Math.trunc(n);
    }
    await this.#persist();
    return this.contextOverrides();
  }

  snapshot() {
    return {
      visible: [...this.state.visible],
      contextOverrides: { ...this.state.contextOverrides },
    };
  }

  async #persist() {
    try {
      await mkdir(dirname(this.deps.path()), { recursive: true });
      await writeFile(this.deps.path(), JSON.stringify(this.state, null, 0), { mode: 0o600 });
    } catch (error) {
      this.logger.warn?.(
        `[sub2api] 面板状态保存失败：${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

/** @returns {PanelState} */
function normalizeState(raw) {
  /** @type {PanelState} */
  const state = { visible: [], contextOverrides: {} };

  const list = Array.isArray(raw?.visible) ? raw.visible : Array.isArray(raw?.ids) ? raw.ids : [];
  state.visible = cleanIds(list);

  const overrides = raw?.contextOverrides;
  if (overrides !== null && typeof overrides === "object") {
    for (const [id, value] of Object.entries(overrides)) {
      const n = Number(value);
      if (typeof id === "string" && id !== "" && Number.isFinite(n) && n > 0) {
        state.contextOverrides[id] = Math.trunc(n);
      }
    }
  }
  return state;
}

/** @param {unknown} ids @returns {string[]} */
function cleanIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map((id) => String(id ?? "").trim()))].filter((id) => id !== "");
}
