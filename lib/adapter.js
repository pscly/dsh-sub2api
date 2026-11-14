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
          isRetryableFailure(error);
        if (!canRetry) throw describeStreamFailure(error, emitted, attempt);
        attempt += 1;
        this.deps.logger?.warn?.(
          `[sub2api] 第 ${attempt} 次重试：${plainText(error?.message ?? error).slice(0, 100)}`,
        );
        await delay(500 * attempt * attempt);
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

/**
 * The provider-level failure class.
 *
 * The transport's error carries the real class in `failure`; its `code` is the
 * seam-level bucket (`unavailable`) and using that for routing silently treats
 * every provider fault as one kind.
 */
export function failureClass(error) {
  const failure = String(error?.failure ?? "");
  if (failure !== "") return failure;
  return String(error?.code ?? "");
}

/** HTTP status the transport recorded for this failure, when it has one. */
export function failureStatus(error) {
  const status = Number(error?.facts?.status ?? error?.status);
  return Number.isFinite(status) ? status : undefined;
}

/** Whether a failure came from the transport rather than the endpoint's answer. */
export function isTransportFailure(error) {
  if (failureClass(error) === "TRANSPORT" || failureClass(error) === "TIMEOUT") return true;
  const message = String(error?.message ?? "");
  return /fetch failed|could not be reached|connection dropped|socket hang up|ECONNRESET|ETIMEDOUT|EPIPE/i.test(
    message,
  );
}

/** Error codes a second attempt can plausibly turn into an answer. */
const RETRYABLE_CODES = new Set([
  "TRANSPORT",
  "TIMEOUT",
  "SERVER",
  "RATE_LIMIT",
  "THROTTLED",
  "EMPTY_RESPONSE",
]);

/**
 * Whether asking again could work.
 *
 * A 502 from the openresty in front of the gateway is the common one here: the
 * Go backend was restarting or the upstream account was unusable, and the same
 * request a second later usually succeeds. Retrying is only allowed before the
 * first chunk, so a partially streamed answer is never repeated.
 */
export function isRetryableFailure(error) {
  if (error === undefined || error === null) return false;
  if (isTransportFailure(error)) return true;

  if (RETRYABLE_CODES.has(failureClass(error))) return true;

  const status = failureStatus(error);
  if (status !== undefined && (status >= 500 || status === 429)) return true;

  const message = String(error?.message ?? "");
  return /answered 5\d\d|Bad Gateway|Service Unavailable|Gateway Timeout/i.test(message);
}

/**
 * Strip the tags a gateway puts around an HTML error page.
 *
 * Only real HTML element names are removed: a blanket `<[^>]+>` also eats
 * placeholders like `<private-host>`, which is exactly the part of an upstream
 * message that says where the failure happened.
 */
const HTML_TAGS =
  /<\/?(?:html|head|body|title|meta|link|script|style|div|span|p|br|hr|center|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|pre|code|strong|em|b|i|a|img|form|input|button)\b[^>]*>/gi;

export function plainText(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(HTML_TAGS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Name the endpoint that actually failed.
 *
 * The transport reports the connection's base URL, so the thrown message reads
 * "https://host/v1 could not be reached" even though the request went to
 * /v1/chat/completions. That sends people looking at the wrong thing.
 */
export function describeStreamFailure(error, emitted, attempts) {
  const retryNote = attempts > 0 ? `，已重试 ${attempts} 次` : "";
  const midStream = emitted ? "，回复中途断开" : "";
  const status = failureStatus(error);
  const said = plainText(error?.message ?? error);

  if (status !== undefined && status >= 500) {
    // sub2api answers this exact sentence for "my upstream failed", which in
    // practice means the account pool has nothing usable for this model — a
    // gateway-side condition the user can only act on by waiting or switching.
    // A 5xx whose body is a network failure from something upstream: a proxy
    // that could not reach an internal host, for instance. The host is usually
    // redacted by whoever produced the message, so only the class is usable.
    const upstreamNetwork = /connect-timeout|UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|acp-proxy/i.test(
      said,
    );
    const upstreamDown = /Upstream service temporarily unavailable/i.test(said);
    // Only claim "internal network" when the text says so: the body is passed
    // through from whatever produced it, and guessing the cause from a timeout
    // alone sends people looking in the wrong place.
    const mentionsPrivate = /<private-host>|\b(?:10|127)\.\d+\.\d+\.\d+\b|\b192\.168\.\d+\.\d+\b|\b172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+\b/i.test(
      said,
    );
    const what = upstreamNetwork
      ? mentionsPrivate
        ? "中转站上游的某个代理连不上它的目标（连接超时），目标看起来是内网地址；这通常是 VPN / 内网链路或对端服务的问题，不是插件本身"
        : "中转站上游的某个代理连不上它的目标（连接超时）；这条错误是上游原文透传，具体是哪个组件要看网关日志里该请求的 account_id"
      : upstreamDown
      ? "中转站的上游暂时不可用（502）；这通常是该模型此刻没有可用账号，或上游账号返回了 5xx，不是插件本身的问题"
      : status === 502
        ? "中转站的网关返回 502，后端当时不可用（重启或上游账号异常）"
        : status === 504
          ? "中转站的网关返回 504，上游超时"
          : `中转站的网关返回 ${status}`;
    return new Sub2ApiError(
      `${what}${retryNote}${midStream}。可稍后重试或换一个模型；原始信息：${said}`,
      { code: failureClass(error) || "SERVER", status, cause: error },
    );
  }

  if (isTransportFailure(error)) {
    return new Sub2ApiError(
      `与中转站的连接中断（/chat/completions${retryNote}${midStream}）；如果这条会话很长，可能是等待首字超时，可在插件配置里调大 streamIdleTimeoutMs。原始信息：${said}`,
      { code: failureClass(error) || "TRANSPORT", cause: error },
    );
  }

  return error;
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
