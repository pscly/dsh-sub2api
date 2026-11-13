/**
 * Which models the user wants in the picker.
 *
 * Configuration can pin a list, but typing model ids into a YAML file is not a
 * reasonable way to choose from forty of them, so the panel writes this small
 * sidecar instead. It is deliberately separate from the settings document: the
 * settings service projects a schema, and a growing list of upstream ids is not
 * a schema.
 * @module dsh-sub2api/selection
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class SelectionStore {
  /**
   * @param {object} deps
   * @param {() => string} deps.path file to keep the selection in
   * @param {{warn: Function}} [deps.logger]
   */
  constructor(deps) {
    this.deps = deps;
    this.logger = deps.logger ?? { warn() {} };
    /** @type {string[] | undefined} */
    this.ids = undefined;
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return this.current();
    this.loaded = true;
    try {
      const text = await readFile(this.deps.path(), "utf8");
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed?.ids)) {
        this.ids = parsed.ids.filter((id) => typeof id === "string" && id.trim() !== "");
      }
    } catch {
      // No file yet: an empty selection means "show everything".
    }
    return this.current();
  }

  /** The stored ids, synchronously. Empty means no restriction. */
  current() {
    return Array.isArray(this.ids) ? this.ids : [];
  }

  /**
   * @param {string[]} ids model ids to keep; an empty list restores "show all"
   * @returns {Promise<string[]>}
   */
  async save(ids) {
    const clean = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id).trim()))]
      .filter((id) => id !== "");
    this.ids = clean;
    this.loaded = true;
    try {
      await mkdir(dirname(this.deps.path()), { recursive: true });
      await writeFile(this.deps.path(), JSON.stringify({ ids: clean }, null, 0), { mode: 0o600 });
    } catch (error) {
      this.logger.warn?.(`[sub2api] 模型选择保存失败：${error instanceof Error ? error.message : error}`);
    }
    return clean;
  }
}
