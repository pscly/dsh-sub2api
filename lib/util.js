/**
 * Small shared helpers: an HTTP JSON client with timeout/cancellation, error types,
 * secret masking and loopback detection. No DSH imports here, so the module is testable
 * on its own.
 * @module dsh-sub2api/util
 */

/** One failed remote or local operation, carrying enough context for a UI message. */
export class Sub2ApiError extends Error {
  /**
   * @param {string} message human-readable, already redacted
   * @param {object} [options]
   * @param {number} [options.status] HTTP status when the failure came from a response
   * @param {string} [options.code] provider error code or a local discriminant
   * @param {unknown} [options.cause] original error
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "Sub2ApiError";
    this.status = options.status;
    this.code = options.code;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** Whether an unknown value is a Sub2ApiError carrying one of the given codes. */
export function hasCode(error, ...codes) {
  return error instanceof Sub2ApiError && typeof error.code === "string" && codes.includes(error.code);
}

/**
 * Read a Response body as JSON, translating the two sub2api envelopes
 * (`{code, message, data}` for the control plane, plain objects for the gateway).
 * @param {Response} response
 * @returns {Promise<any>} the unwrapped payload
 * @throws {Sub2ApiError} for a non-2xx status or an unusable body
 */
export async function readEnvelope(response) {
  const text = await response.text().catch(() => "");
  let body;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    throw new Sub2ApiError(readableMessage(body, response.status), {
      status: response.status,
      code: typeof body?.code === "string" ? body.code : `http_${response.status}`,
    });
  }

  if (body !== undefined && typeof body === "object" && "code" in body) {
    if (body.code !== 0 && body.code !== "0") {
      throw new Sub2ApiError(String(body.message || `provider error ${body.code}`), {
        status: response.status,
        code: typeof body.code === "string" ? body.code : `code_${body.code}`,
      });
    }
    return body.data;
  }

  return body;
}

/**
 * Perform one JSON request with a timeout and an optional caller signal.
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {string} [options.method] HTTP method, GET when omitted
 * @param {Record<string,string>} [options.headers] extra headers
 * @param {unknown} [options.body] JSON-serializable request body
 * @param {number} [options.timeoutMs] overall deadline
 * @param {AbortSignal} [options.signal] caller cancellation
 * @param {typeof fetch} [options.fetchImpl] replacement transport for tests
 * @returns {Promise<{status:number, headers:Headers, payload:any}>}
 */
export async function requestJson(url, options = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 30000,
    signal,
    fetchImpl = fetch,
  } = options;

  const timeoutSignal = AbortSignal.timeout(Math.max(1, timeoutMs));
  const merged = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);

  const init = {
    method,
    headers: { Accept: "application/json", ...headers },
    signal: merged,
  };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json", ...init.headers };
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (cause) {
    const aborted = merged.aborted;
    throw new Sub2ApiError(
      aborted ? "请求超时或已取消" : `网络请求失败：${String(cause?.message ?? cause)}`,
      { code: aborted ? "timeout" : "network", cause },
    );
  }

  const payload = await readEnvelope(response);
  return { status: response.status, headers: response.headers, payload };
}

/**
 * Pull a human-readable sentence out of whatever error body came back.
 *
 * Three shapes reach this: sub2api's `{code, message}`, OpenAI's
 * `{error:{message, type}}` (which the gateway uses for key and permission
 * faults), and a bare string. Taking `body.error` verbatim and casting it to a
 * string is how an error surfaces as "[object Object]" in the panel.
 * @param {any} body parsed response body
 * @param {number} status HTTP status, used as the last resort
 * @returns {string}
 */
export function readableMessage(body, status) {
  if (typeof body === "string" && body.trim() !== "") return body.trim().slice(0, 500);

  if (body !== null && typeof body === "object") {
    for (const candidate of [body.message, body.error, body.detail, body.code]) {
      if (typeof candidate === "string" && candidate.trim() !== "" && candidate !== "0") {
        return candidate;
      }
    }
    if (body.error !== null && typeof body.error === "object") {
      for (const inner of [body.error.message, body.error.type, body.error.code]) {
        if (typeof inner === "string" && inner.trim() !== "") return inner;
      }
    }
  }

  return `HTTP ${status}`;
}

/**
 * Mask a secret for display: keep a short head and tail so users can tell keys apart.
 * @param {string | undefined} value
 * @returns {string}
 */
export function maskSecret(value) {
  if (typeof value !== "string" || value === "") return "";
  if (value.length <= 12) return "…";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Reduce a URL to origin + path for logs and error text: query strings may carry tokens.
 * @param {string} url
 * @returns {string}
 */
export function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<invalid url>";
  }
}

/** Whether a request originates from the loopback interface. */
export function isLoopbackRequest(req) {
  const address = req?.socket?.remoteAddress ?? req?.connection?.remoteAddress ?? "";
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.startsWith("127.")
  );
}

/** Serialize a JSON response with no cache. */
export function writeJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(text);
}

/**
 * Read a bounded JSON request body.
 * @returns {Promise<any | undefined>} parsed body, or undefined for an unusable one
 */
export async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) return undefined;
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

/** Hostname of this machine, used in the default API key name. */
export function localHostname() {
  try {
    return String(process.env.HOSTNAME ?? "").trim() || "localhost";
  } catch {
    return "localhost";
  }
}

/** Normalize a base URL: strip trailing slashes and an accidental /v1 suffix. */
export function normalizeBaseUrl(value) {
  const trimmed = String(value ?? "").trim().replace(/\/+$/, "");
  return trimmed.replace(/\/v1$/, "");
}
