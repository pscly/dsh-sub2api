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
import { readFileSync } from "node:fs";
import { resolveConfig } from "./config.js";
import { Sub2ApiAdapter } from "./adapter.js";
import { makeRoutes } from "./routes.js";
import { Sub2ApiApi } from "./sub2api/api.js";
import { ModelCatalog } from "./sub2api/catalog.js";
import { PanelStore } from "./panel-store.js";
import { applyCommands } from "./commands.js";
import { SessionStore } from "./sub2api/session.js";

export { Config } from "./schema.js";

/** Stable Cordis plugin name. */
export const name = PLUGIN_NAME;

/**
 * Nothing is a hard requirement.
 *
 * The panel is the part a user needs when something is wrong, so it must mount
 * even when the LLM seam is missing or a provider registration is rejected.
 * The provider route is installed later, once `llm` is actually available.
 */
export const inject = [];

/**
 * The running build's version, read from the package next to the module.
 *
 * The panel shows it, because "which version am I looking at" is otherwise
 * unanswerable from a screenshot — and a fix that shipped ten minutes ago is
 * indistinguishable from one that never arrived.
 */
export const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "unknown";
  }
})();

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

  /** Panel-owned state: the model allowlist and per-model capacity fixes. */
  const panel = new PanelStore({
    path: () => cfg().panelPath,
    legacyPath: () => cfg().selectionPath,
    logger,
  });

  /**
   * Tell the host the catalog changed.
   *
   * The model picker rebuilds itself from `llm/adapters-updated` (and the
   * credential events), not from our HTTP routes. Without this a session that
   * opened before the first sync keeps showing an empty provider until the page
   * is reloaded. `replace()` on the registration handle is the documented way
   * to publish that event.
   */
  const announceCatalog = () => {
    try {
      adapterHandle?.replace?.([PROVIDER]);
    } catch {
      // A disposed registration is not an error worth failing a refresh over.
    }
  };

  const catalog = new ModelCatalog({
    api,
    cachePath: () => cfg().modelsCachePath,
    visibleModels: () => cfg().visibleModels,
    selection: () => panel.visible(),
    contextOverride: (id) => panel.contextOverride(id),
    contextWindow: () => cfg().contextWindow,
    defaultContextWindow: () => cfg().defaultContextWindow,
    reasoningModels: () => cfg().reasoningModels,
    defaultReasoningEffort: () => cfg().defaultReasoningEffort,
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
    transportRetries: () => cfg().retries,
    logger,
  });

  const deps = { api, session, catalog, adapter, cfg, logger };

  // 1) Provider directory + adapter, installed once the LLM seam exists.
  //
  //    This is deliberately a nested injection rather than a top-level
  //    `inject`: a rejected registration (a duplicate route from a second
  //    install, an older host without the directory API) must not take the
  //    panel down with it. Without the panel the user cannot even see why.
  /** @type {{replace?: (providers: string[]) => void} | undefined} */
  let adapterHandle;
  const mountProvider = (llmCtx) => {
    llmCtx.effect(() => {
      try {
        const providers = llmCtx.llm.registerConfigurableProviders([
          {
            provider: PROVIDER,
            displayName: "Sub2API",
            settingsNs: SETTINGS_NS,
            settingsPath: [],
          },
        ]);
        const adapters = llmCtx.llm.registerAdapter([PROVIDER], adapter);
        adapterHandle = adapters;
        return () => {
          adapterHandle = undefined;
          adapters?.();
          providers?.();
        };
      } catch (error) {
        logger.warn(
          `[sub2api] provider 注册失败，面板仍可用：${error instanceof Error ? error.message : error}`,
        );
        return () => {};
      }
    }, "sub2api: provider");
  };

  // `ctx.inject` is the modern way to wait for a service; older hosts only have
  // `ctx.get`, and a missing method here would abort apply and take the panel
  // down with it.
  if (typeof ctx.inject === "function") {
    ctx.inject(["llm"], mountProvider);
  } else if (optional(ctx, "llm") !== undefined) {
    mountProvider(ctx);
  } else {
    logger.warn("[sub2api] 宿主没有 llm 服务，provider 未注册（面板仍可用）");
  }

  // 2) Model discovery for the Models page's probe button.
  const mountDiscovery = (llmCtx) => llmCtx.effect(() => {
    if (typeof llmCtx.llm.registerModelDiscovery !== "function") return () => {};
    const dispose = llmCtx.llm.registerModelDiscovery(SETTINGS_NS, async (request, signal) => {
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

  if (typeof ctx.inject === "function") ctx.inject(["llm"], mountDiscovery);
  else if (optional(ctx, "llm") !== undefined) mountDiscovery(ctx);

  // 3) Browser routes.
  ctx.effect(() => {
    const webServer = optional(ctx, "webServer");
    if (webServer === undefined || typeof webServer.register !== "function") {
      logger.warn("[sub2api] 宿主没有 webServer 服务，面板路由未注册（设置页会显示 404）");
      return () => {};
    }
    const routes = makeRoutes({
      ...deps,
      cfg,
      panel,
      version: VERSION,
      announceCatalog,
      hostname: () => "dsh",
      refreshCatalog: async (key) => {
        const count = await catalog.refresh(key);
        announceCatalog();
        return count;
      },
    });
    const disposers = routes.map((route) => webServer.register(route));
    logger.info(`[sub2api] 面板路由已注册：${routes.length} 条（v${VERSION}）`);
    return () => disposers.forEach((dispose) => dispose?.());
  }, "sub2api: routes");

  // 4) Slash command for the terminal surface, where the panel does not exist.
  ctx.effect(() => {
    const dispose = applyCommands(ctx, { api, session, catalog, cfg });
    return () => dispose?.();
  }, "sub2api: command");

  // 5) Agent tools: read-only status so the model can answer "how much is left".
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

  // 6) Warm the catalog so the first picker open is not empty.
  ctx.effect(() => {
    void catalog.load().then(() => catalog.ensureFresh()).catch(() => {});
    return () => {};
  }, "sub2api: warm");

  // 7) Agent guidance, so the model knows the panel exists.
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
