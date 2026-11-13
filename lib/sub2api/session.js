/**
 * Durable login session, stored as a credential record.
 *
 * Why a record rather than a private JSON file: it rides the host's own
 * credential store (`~/.dsh/.credentials.yaml`, mode 0600), disappears with the
 * plugin, and is never enumerated into anything the browser can read. The
 * record's payload is a `grant` blob — the seam treats it as opaque and only
 * this plugin interprets it.
 * @module dsh-sub2api/sub2api/session
 */

import { SESSION_ID, SESSION_SCOPE, TOKEN_REFRESH_LEAD_MS } from "../constants.js";
import { Sub2ApiError } from "../util.js";

/**
 * Build the record key. The host brand is a TypeScript-only marker, so a plain
 * `<scope>/<id>` string is accepted at runtime and keeps this module importable
 * outside a running host (tests, tooling).
 */
function sessionKey() {
  return `${SESSION_SCOPE}/${SESSION_ID}`;
}

/** @typedef {{accessToken: string, refreshToken?: string, expiresAt: number, user?: any, email?: string}} Session */

export class SessionStore {
  /**
   * @param {object} deps
   * @param {() => any} deps.credentials resolves the host credential provider, may return undefined
   * @param {import("./api.js").Sub2ApiApi} deps.api
   * @param {() => string} deps.apiKeyEnv credential reference holding the API key
   */
  constructor(deps) {
    this.deps = deps;
    /** In-flight refresh, so concurrent callers share one rotation. */
    this.refreshing = undefined;
    /** Last read, so a settings page render does not hit the store repeatedly. */
    this.cached = undefined;
  }

  /** @returns {Promise<Session | undefined>} */
  async read() {
    if (this.cached !== undefined) return this.cached;
    const credentials = this.deps.credentials();
    if (credentials === undefined) return undefined;
    const record = await credentials.readRecord(sessionKey());
    const payload = record?.kind === "grant" ? record.payload : undefined;
    if (!payload || typeof payload !== "object") return undefined;
    this.cached = /** @type {Session} */ (payload);
    return this.cached;
  }

  /** @param {Session} session */
  async write(session) {
    const credentials = this.deps.credentials();
    if (credentials === undefined) {
      throw new Sub2ApiError("当前运行环境没有凭据服务，无法保存登录状态", {
        code: "no_credentials_service",
      });
    }
    const next = normalize(session);
    await credentials.modifyRecord(sessionKey(), async () => ({ kind: "grant", payload: next }));
    this.cached = next;
  }

  async clear() {
    const credentials = this.deps.credentials();
    this.cached = undefined;
    if (credentials === undefined) return;
    await credentials.deleteRecord(sessionKey());
    try {
      await credentials.unset(this.deps.apiKeyEnv());
    } catch {
      // A missing reference is not a failure worth surfacing on logout.
    }
  }

  /**
   * A usable access token, refreshing shortly before expiry.
   * @param {AbortSignal} [signal]
   * @returns {Promise<string>}
   * @throws {Sub2ApiError} `not_logged_in` when there is no session at all
   */
  async accessToken(signal) {
    const session = await this.read();
    if (session === undefined) {
      throw new Sub2ApiError("尚未登录 Sub2API", { code: "not_logged_in" });
    }
    if (session.expiresAt > Date.now() + TOKEN_REFRESH_LEAD_MS || !session.refreshToken) {
      return session.accessToken;
    }
    return this.refresh(session, signal);
  }

  /**
   * Rotate the access token. Concurrent callers share one request: two
   * rotations of the same refresh token would invalidate each other upstream.
   * @param {Session} [session]
   * @param {AbortSignal} [signal]
   * @returns {Promise<string>}
   */
  async refresh(session, signal) {
    if (this.refreshing !== undefined) return this.refreshing;
    const current = session ?? (await this.read());
    if (current === undefined || !current.refreshToken) {
      throw new Sub2ApiError("登录状态已失效，请重新登录", { code: "not_logged_in" });
    }

    this.refreshing = (async () => {
      try {
        const fresh = await this.deps.api.refresh(current.refreshToken);
        const next = normalize({
          accessToken: fresh.access_token,
          refreshToken: fresh.refresh_token ?? current.refreshToken,
          expiresAt: expiresAtOf(fresh),
          user: fresh.user ?? current.user,
          email: current.email,
        });
        await this.write(next);
        return next.accessToken;
      } catch (error) {
        // A rejected refresh token means the session is unrecoverable; drop it
        // rather than leaving the panel looping on a dead token.
        if (error instanceof Sub2ApiError && error.status === 401) await this.clear();
        throw error;
      } finally {
        this.refreshing = undefined;
      }
    })();

    return this.refreshing;
  }

  /** @returns {Promise<string | undefined>} the stored API key, if any */
  async apiKey() {
    const credentials = this.deps.credentials();
    if (credentials === undefined) return undefined;
    const resolved = await credentials.resolve(this.deps.apiKeyEnv());
    const value = typeof resolved?.value === "string" ? resolved.value : undefined;
    return value === undefined || value === "" ? undefined : value;
  }

  /** @param {string} value */
  async setApiKey(value) {
    const credentials = this.deps.credentials();
    if (credentials === undefined) {
      throw new Sub2ApiError("当前运行环境没有凭据服务，无法保存 API Key", {
        code: "no_credentials_service",
      });
    }
    await credentials.set(this.deps.apiKeyEnv(), value);
  }
}

/** Normalize whatever the site returned into the stored shape. */
export function normalize(input) {
  const expiresIn = typeof input.expiresIn === "number" ? input.expiresIn : undefined;
  return {
    accessToken: String(input.accessToken ?? ""),
    refreshToken: input.refreshToken ? String(input.refreshToken) : undefined,
    expiresAt: Number.isFinite(input.expiresAt) ? Number(input.expiresAt) : Date.now() + 3600_000,
    user: input.user,
    email: input.email ?? input.user?.email,
  };
}

/**
 * Convert an auth response's relative `expires_in` into an absolute deadline.
 * @param {{expires_in?: number}} response
 * @returns {number}
 */
function expiresAtOf(response) {
  const seconds =
    typeof response.expires_in === "number" && response.expires_in > 0 ? response.expires_in : 3600;
  return Date.now() + seconds * 1000;
}

/** Build a session from a login/register payload. */
export function sessionFromAuth(auth, email) {
  return normalize({
    accessToken: auth.access_token,
    refreshToken: auth.refresh_token,
    expiresAt: expiresAtOf(auth),
    user: auth.user,
    email,
  });
}
