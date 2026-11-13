/**
 * Plugin configuration: defaults plus a tolerant reader.
 *
 * The loader may hand `apply()` either plain values or volatile references
 * (`{ get() }`), depending on how the row was written. Everything here reads
 * through {@link field} so both shapes work, and so a settings-page write is
 * visible on the next read without re-applying the plugin.
 * @module dsh-sub2api/config
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { API_KEY_REF, KEY_NAME, MODELS_CACHE_FILE } from "./constants.js";
import { normalizeBaseUrl } from "./util.js";

/**
 * Read one configuration field, unwrapping a volatile reference when present.
 * @template T
 * @param {any} config raw or volatile configuration
 * @param {string} key field name
 * @param {T} fallback value used when the field is absent or blank
 * @returns {T}
 */
export function field(config, key, fallback) {
  let value = config?.[key];
  if (value !== null && typeof value === "object" && typeof value.get === "function") {
    value = value.get();
  }
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}

/**
 * Resolve the raw configuration into the facts the rest of the plugin uses.
 * @param {any} config configuration handed to `apply()`
 * @returns {{
 *   apiBase: string,
 *   payBase: string,
 *   apiKeyEnv: string,
 *   groupId: number | undefined,
 *   keyName: string,
 *   requestTimeoutMs: number,
 *   streamIdleTimeoutMs: number,
 *   modelsCachePath: string,
 *   showSidebarQuota: boolean,
 *   visibleModels: string[],
 *   contextWindow: number | undefined,
 *   autoProvision: boolean,
 *   announceToAgent: boolean,
 * }}
 */
export function resolveConfig(config) {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  const configuredKeyName = String(field(config, "keyName", "")).trim();

  return {
    apiBase: normalizeBaseUrl(field(config, "apiBase", "https://sub.pscly.cc")),
    payBase: normalizeBaseUrl(field(config, "payBase", "https://pay.pscly.cc")),
    apiKeyEnv: String(field(config, "apiKeyEnv", API_KEY_REF)),
    groupId: toPositiveInt(field(config, "groupId", undefined)),
    keyName: configuredKeyName === "" ? KEY_NAME : configuredKeyName,
    requestTimeoutMs: toPositiveInt(field(config, "requestTimeoutMs", 300000)),
    streamIdleTimeoutMs: toPositiveInt(field(config, "streamIdleTimeoutMs", 300000)),
    modelsCachePath: String(
      field(config, "modelsCachePath", join(dshHome, MODELS_CACHE_FILE)),
    ),
    showSidebarQuota: field(config, "showSidebarQuota", false) === true,
    visibleModels: toStringArray(field(config, "visibleModels", [])),
    contextWindow: toPositiveInt(field(config, "contextWindow", undefined)),
    autoProvision: field(config, "autoProvision", true) !== false,
    announceToAgent: field(config, "announceToAgent", true) !== false,
  };
}

/** Coerce to a positive integer, or undefined when it is not one. */
function toPositiveInt(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

/** Coerce to a list of non-empty strings. */
function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter((item) => item !== "");
}
