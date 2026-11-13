/**
 * Stable identifiers shared by the host plugin, its HTTP routes and the browser panel.
 * @module dsh-sub2api/constants
 */

/** Cordis plugin name (the `name` export hosts log and address). */
export const PLUGIN_NAME = "llm-sub2api";

/** The single provider route this plugin owns. */
export const PROVIDER = "sub2api";

/** Settings namespace the Models page associates with this provider. */
export const SETTINGS_NS = "llm-sub2api";

/** Credential reference that holds the sub2api API key. */
export const API_KEY_REF = "SUB2API_API_KEY";

/** Credential reference that holds an optional saved account password. */
export const PASSWORD_REF = "SUB2API_PASSWORD";

/** Credential record scope/id holding the login session (tokens + user snapshot). */
export const SESSION_SCOPE = "llm-sub2api";
export const SESSION_ID = "session";

/** Name of the API key this plugin creates on the user's behalf. */
export const KEY_NAME = "dsh";

/** Prefix every browser-facing route lives under. */
export const ROUTE_PREFIX = "/api/sub2api";

/** Default model catalog cache file name under $DSH_HOME. */
export const MODELS_CACHE_FILE = "sub2api-models.json";

/** Where the panel keeps the model allowlist (an empty list means "show all"). */
export const SELECTION_FILE = "sub2api-selection.json";

/** How long a discovered catalog stays fresh before a background refresh. */
export const CATALOG_TTL_MS = 10 * 60 * 1000;

/** Refresh the access token this long before it expires. */
export const TOKEN_REFRESH_LEAD_MS = 60 * 1000;

/** Default page size when listing API keys. */
export const KEY_PAGE_SIZE = 100;

/** Model id fragments that mark an image-capable model when the endpoint says nothing. */
export const VISION_HINTS = [
  "gpt-4o",
  "gpt-4.1",
  "gpt-5",
  "o3",
  "o4",
  "claude-3",
  "claude-4",
  "claude-sonnet",
  "claude-opus",
  "gemini",
  "vision",
  "vl",
  "-v-",
  "qwen-vl",
  "glm-4v",
  "pixtral",
  "llava",
  "internvl",
  "step-1v",
];
