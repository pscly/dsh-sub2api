/**
 * Host entry: compose the provider route, the panel's HTTP surface and the
 * agent-facing tools.
 *
 * Registration order matters. The provider directory entry is what makes the
 * Models page render a card for this namespace; the adapter is what makes the
 * route answer; the routes are what the browser panel talks to. All three are
 * installed inside `ctx.effect` so a reload disposes them together.
 * @module dsh-sub2api
 */

import { PROVIDER, PLUGIN_NAME, SETTINGS_NS } from "./constants.js";
import { resolveConfig } from "./config.js";
import { Sub2ApiAdapter } from "./adapter.js";
import { makeRoutes } from "./routes.js";
import { Sub2ApiApi } from "./sub2api/api.js";
import { ModelCatalog } from "./sub2api/catalog.js";
import { SessionStore } from "./sub2api/session.js";

export { Config } from "./schema.js";

/** Stable Cordis plugin name. */
export const name = PLUGIN_NAME;

/** Services required before anything can mount. */
export const inject = ["llm"];

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 172;

const GUIDANCE =
  "本机已安装 dsh-sub2api 插件：它把 sub2api（sub.pscly.cc）中转站接入 DSH。用户在 设置 → Sub2API 用一个邮箱和密码完成登录或注册，插件会自动在该账号下创建名为 dsh 的 API 密钥、写入本机凭据库，并同步上游模型目录，模型随后出现在模型选择器的 Sub2API 分组里。余额、订阅进度与充值入口也在同一面板；充值走 pay.pscly.cc，点「去支付」会在新标签页打开。可用命令 /sub2api 查看状态。用户提到「sub2api / 中转站 / 我的网关 / 余额充值」时即指本插件。";

/**
 * Mount the provider, panel routes and tools.
 * @param {any} ctx host context
 * @param {any} rawConfig configuration row from the composition patch
 */
export function apply(ctx, rawConfig = {}) {
  const logger = {
    info: (message) => safeLog(ctx, "info", message),
    warn: (message) => safeLog(ctx, "warn", message),
  };

  /** Read the configuration fresh: the settings page may rewrite it in place. */
  const cfg = () => resolveConfig(rawConfig);

  const api = new Sub2ApiApi({
    apiBase: () => cfg().apiBase,
    timeoutMs: () => cfg().requestTimeoutMs,
  });

  const session = new SessionStore({
    credentials: () => optional(ctx, "credentials"),
    api,
    apiKeyEnv: () => cfg().apiKeyEnv,
  });

  const catalog = new ModelCatalog({
    api,
    cachePath: () => cfg().modelsCachePath,
    visibleModels: () => cfg().visibleModels,
    contextWindow: () => cfg().contextWindow,
    apiKey: () => session.apiKey(),
    logger,
  });

  const adapter = new Sub2ApiAdapter({
    ctx,
    catalog,
    apiBase: () => cfg().apiBase,
    apiKeyEnv: () => cfg().apiKeyEnv,
    timeoutMs: () => cfg().requestTimeoutMs,
    idleTimeoutMs: () => cfg().streamIdleTimeoutMs,
    logger,
  });

  const deps = { api, session, catalog, adapter, cfg, logger };

  // 1) Provider directory + adapter. The directory entry is what the Models
  //    page turns into a card for this namespace.
  ctx.effect(() => {
    const providers = ctx.llm.registerConfigurableProviders([
      {
        provider: PROVIDER,
        displayName: "Sub2API",
        settingsNs: SETTINGS_NS,
        settingsPath: [],
      },
    ]);
    const adapters = ctx.llm.registerAdapter([PROVIDER], adapter);
    return () => {
      adapters?.();
      providers?.();
    };
  }, "sub2api: provider");

  // 2) Model discovery for the Models page's probe button.
  ctx.effect(() => {
    if (typeof ctx.llm.registerModelDiscovery !== "function") return () => {};
    const dispose = ctx.llm.registerModelDiscovery(SETTINGS_NS, async (request, signal) => {
      // A draft probe carries its own one-shot key and endpoint; a configured
      // route falls back to the stored credential and this plugin's apiBase.
      const key = request?.apiKey ?? (await session.apiKey());
      if (!key) return [];
      const payload = await api.gatewayModels(key, signal, request?.baseURL);
      const { normalizeModels } = await import("./sub2api/catalog.js");
      return normalizeModels(payload).map((model) => ({
        id: model.id,
        ...(model.name === undefined ? {} : { name: model.name }),
        ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
        ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
        ...(model.vision === true ? { inputModalities: ["text", "image"] } : {}),
      }));
    });
    return () => dispose?.();
  }, "sub2api: discovery");

  // 3) Browser routes.
  ctx.effect(() => {
    const webServer = optional(ctx, "webServer");
    if (webServer === undefined || typeof webServer.register !== "function") return () => {};
    const routes = makeRoutes({
      ...deps,
      cfg,
      hostname: () => "dsh",
      refreshCatalog: (key) => catalog.refresh(key),
    });
    const disposers = routes.map((route) => webServer.register(route));
    return () => disposers.forEach((dispose) => dispose?.());
  }, "sub2api: routes");

  // 4) Agent tools: read-only status so the model can answer "how much is left".
  //    Imported lazily: a deployment without @deepseek-ai/dsh-tools still gets
  //    the provider and the panel, just no tools.
  ctx.effect(() => {
    let cancelled = false;
    let disposers = [];
    void import("./tools.js")
      .then((module) => {
        if (cancelled) return;
        const tools = optional(ctx, "tools");
        if (tools === undefined || typeof tools.register !== "function") return;
        disposers = module
          .buildTools({ api, session, catalog, cfg })
          .map((tool) => tools.register(tool));
      })
      .catch((error) => logger.warn(`[sub2api] 工具未注册：${describe(error)}`));
    return () => {
      cancelled = true;
      disposers.forEach((dispose) => dispose?.());
    };
  }, "sub2api: tools");

  // 5) Warm the catalog so the first picker open is not empty.
  ctx.effect(() => {
    void catalog.load().then(() => catalog.ensureFresh()).catch(() => {});
    return () => {};
  }, "sub2api: warm");

  // 6) Agent guidance, so the model knows the panel exists.
  ctx.effect(() => {
    if (cfg().announceToAgent !== true) return () => {};
    const systemPrompt = optional(ctx, "systemPrompt");
    if (systemPrompt === undefined || typeof systemPrompt.section !== "function") return () => {};
    return systemPrompt.section({
      name: "plugin:sub2api",
      order: SECTION_ORDER,
      text: GUIDANCE,
    });
  }, "sub2api: guidance");
}

/** A short message for a failed dynamic import. */
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Read an optional host service without letting its absence throw. */
function optional(ctx, serviceName) {
  try {
    return ctx.get?.(serviceName);
  } catch {
    return undefined;
  }
}

/** Log through the host logger when it exists, and never let logging break a mount. */
function safeLog(ctx, level, message) {
  try {
    const logger = ctx.logger;
    if (typeof logger?.[level] === "function") logger[level](message);
    else if (level === "warn") console.warn(message);
  } catch {
    // A logger failure must not affect the plugin.
  }
}
