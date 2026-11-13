/**
 * The sub2api control-plane client.
 *
 * Covers exactly what the panel needs: authentication, the account snapshot,
 * key management, groups, subscriptions, usage and redeem codes. The model
 * gateway (an OpenAI-compatible `/v1`) is a separate concern and lives in
 * `catalog.js` / the transport adapter.
 *
 * Every call resolves the same `{code, message, data}` envelope through
 * `requestJson`, so a caller only ever sees the payload or a `Sub2ApiError`.
 * @module dsh-sub2api/sub2api/api
 */

import { KEY_PAGE_SIZE } from "../constants.js";
import { Sub2ApiError, requestJson } from "../util.js";

export class Sub2ApiApi {
  /**
   * @param {object} deps
   * @param {() => string} deps.apiBase current site origin, read per call so a settings change applies
   * @param {() => number} deps.timeoutMs request deadline
   * @param {typeof fetch} [deps.fetchImpl] replacement transport for tests
   */
  constructor(deps) {
    this.deps = deps;
  }

  /** @param {string} path */
  #url(path) {
    return `${this.deps.apiBase()}${path}`;
  }

  /**
   * @param {string} path
   * @param {object} [options]
   * @param {string} [options.method]
   * @param {unknown} [options.body]
   * @param {string} [options.token] bearer access token
   * @param {AbortSignal} [options.signal]
   */
  async #call(path, options = {}) {
    const headers = {};
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    try {
      const { payload } = await requestJson(this.#url(path), {
        method: options.method ?? "GET",
        headers,
        body: options.body,
        timeoutMs: this.deps.timeoutMs(),
        signal: options.signal,
        fetchImpl: this.deps.fetchImpl,
      });
      return payload;
    } catch (error) {
      throw annotate(error, path);
    }
  }

  // ---------------------------------------------------------------- auth

  /**
   * Exchange a password for tokens.
   * @returns {Promise<AuthResponse>}
   */
  login(email, password) {
    return this.#call("/api/v1/auth/login", { method: "POST", body: { email, password } });
  }

  /**
   * Create an account. The site returns the same payload as `login`, because
   * email verification is disabled on this deployment — that is what makes
   * "register and start chatting" a single step.
   * @returns {Promise<AuthResponse>}
   */
  register({ email, password, username, promoCode }) {
    const body = { email, password };
    if (username) body.username = username;
    if (promoCode) body.promo_code = promoCode;
    return this.#call("/api/v1/auth/register", { method: "POST", body });
  }

  /** @returns {Promise<AuthResponse>} a fresh token pair */
  refresh(refreshToken) {
    return this.#call("/api/v1/auth/refresh", {
      method: "POST",
      body: { refresh_token: refreshToken },
    });
  }

  me(token, signal) {
    return this.#call("/api/v1/auth/me", { token, signal });
  }

  logout(token) {
    return this.#call("/api/v1/auth/logout", { method: "POST", token });
  }

  validatePromoCode(code) {
    return this.#call("/api/v1/auth/validate-promo-code", { method: "POST", body: { code } });
  }

  // -------------------------------------------------------------- account

  profile(token, signal) {
    return this.#call("/api/v1/user/profile", { token, signal });
  }

  platformQuotas(token, signal) {
    return this.#call("/api/v1/user/platform-quotas", { token, signal });
  }

  /** Groups this user may bind a key to. */
  groups(token, signal) {
    return this.#call("/api/v1/groups/available", { token, signal });
  }

  // ------------------------------------------------------------------ keys

  /**
   * @param {string} token
   * @param {{page?: number, pageSize?: number, signal?: AbortSignal}} [options]
   * @returns {Promise<{items?: KeyRecord[], total?: number, page?: number, page_size?: number}>}
   */
  listKeys(token, options = {}) {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? KEY_PAGE_SIZE;
    return this.#call(`/api/v1/keys?page=${page}&page_size=${pageSize}`, {
      token,
      signal: options.signal,
    });
  }

  /**
   * Create a key. The response carries the plaintext value in `key`, which is
   * the only moment it can be captured without the user copying it by hand.
   * @param {string} token
   * @param {{name: string, groupId?: number|null, quota?: number, expiresInDays?: number}} input
   */
  createKey(token, input) {
    const body = { name: input.name };
    if (input.groupId !== undefined && input.groupId !== null) body.group_id = input.groupId;
    if (typeof input.quota === "number" && input.quota > 0) body.quota = input.quota;
    if (typeof input.expiresInDays === "number" && input.expiresInDays > 0) {
      body.expires_in_days = input.expiresInDays;
    }
    return this.#call("/api/v1/keys", { method: "POST", token, body });
  }

  updateKey(token, id, patch) {
    return this.#call(`/api/v1/keys/${id}`, { method: "PUT", token, body: patch });
  }

  deleteKey(token, id) {
    return this.#call(`/api/v1/keys/${id}`, { method: "DELETE", token });
  }

  // --------------------------------------------------------- subscriptions

  activeSubscriptions(token, signal) {
    return this.#call("/api/v1/subscriptions/active", { token, signal });
  }

  subscriptionProgress(token, signal) {
    return this.#call("/api/v1/subscriptions/progress", { token, signal });
  }

  subscriptionSummary(token, signal) {
    return this.#call("/api/v1/subscriptions/summary", { token, signal });
  }

  // ----------------------------------------------------------------- usage

  usageStats(token, signal) {
    return this.#call("/api/v1/usage/stats", { token, signal });
  }

  usageDashboardStats(token, signal) {
    return this.#call("/api/v1/usage/dashboard/stats", { token, signal });
  }

  // ---------------------------------------------------------------- redeem

  redeem(token, code) {
    return this.#call("/api/v1/redeem", { method: "POST", token, body: { code } });
  }

  // ----------------------------------------------------------- public site

  publicSettings(signal) {
    return this.#call("/api/v1/settings/public", { signal });
  }

  /** Site announcements; the list is empty when the operator published none. */
  announcements(token, signal) {
    return this.#call("/api/v1/announcements", { token, signal });
  }

  // -------------------------------------------------------- model gateway

  /**
   * The model catalog, authenticated with the user's API key rather than a session.
   * @param {string} apiKey
   * @param {AbortSignal} [signal]
   */
  gatewayModels(apiKey, signal, baseUrl) {
    return this.#gateway("/v1/models", apiKey, signal, baseUrl);
  }

  /**
   * Per-key billing facts. Unlike the profile endpoint this needs no login, so
   * the sidebar can show a balance before the panel is opened.
   */
  gatewayBilling(apiKey, signal) {
    return this.#gateway("/v1/sub2api/billing", apiKey, signal);
  }

  async #gateway(path, apiKey, signal, baseUrl) {
    const root = baseUrl === undefined || baseUrl === "" ? this.deps.apiBase() : String(baseUrl).replace(/\/+$/, "");
    try {
      const { payload } = await requestJson(`${root}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: this.deps.timeoutMs(),
        signal,
        fetchImpl: this.deps.fetchImpl,
      });
      return payload;
    } catch (error) {
      throw annotate(error, path);
    }
  }
}

/**
 * Attach the endpoint (never the query string) to an error so a UI message can
 * say which call failed without leaking tokens.
 */
function annotate(error, path) {
  if (error instanceof Sub2ApiError && error.status !== undefined) {
    error.endpoint = path;
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Sub2ApiError(`${path} 请求失败：${message}`, { code: "transport", cause: error });
}

/** @typedef {{access_token: string, refresh_token?: string, expires_in?: number, user?: any}} AuthResponse */
/** @typedef {{id: number, key: string, name: string, group_id?: number|null, status: string, quota?: number, quota_used?: number}} KeyRecord */
