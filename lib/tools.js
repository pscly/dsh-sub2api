/**
 * Agent-facing tools.
 *
 * These are deliberately read-only: the model may report the account's state,
 * but it must never spend the user's balance or rotate a key on its own. A user
 * who asks "我还有多少额度" gets an answer without opening the panel.
 * @module dsh-sub2api/tools
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { maskSecret } from "./util.js";

/**
 * @param {object} deps
 * @param {import("./sub2api/api.js").Sub2ApiApi} deps.api
 * @param {import("./sub2api/session.js").SessionStore} deps.session
 * @param {import("./sub2api/catalog.js").ModelCatalog} deps.catalog
 * @param {() => any} deps.cfg
 * @returns {any[]}
 */
export function buildTools(deps) {
  return [statusTool(deps), modelsTool(deps)];
}

/** Whether the account is wired up, and what it currently holds. */
function statusTool(deps) {
  return defineTool({
    name: "sub2api_status",
    description:
      "查看 Sub2API（sub.pscly.cc 中转站）在本机的接入状态：是否已登录、账号邮箱、余额、API 密钥是否已保存（只返回掩码）、订阅进度、已同步的模型数量。不会返回任何明文密钥。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          message: { type: "string", required: true },
          loggedIn: { type: "boolean" },
          email: { type: "string" },
          balance: { type: "number" },
          hasKey: { type: "boolean" },
          keyMasked: { type: "string" },
          modelCount: { type: "number" },
          apiBase: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: String(value.message ?? "") }],
    },
    async execute() {
      const stored = await deps.session.read();
      const apiKey = await deps.session.apiKey();
      await deps.catalog.load();

      if (stored === undefined) {
        return {
          ok: false,
          message: `尚未登录 Sub2API。请让用户在 DSH 的 设置 → Sub2API 面板用一个邮箱和密码完成登录或注册（插件会自动创建名为 dsh 的密钥）。站点：${deps.cfg().apiBase}`,
          loggedIn: false,
          hasKey: false,
          modelCount: deps.catalog.visible().length,
          apiBase: deps.cfg().apiBase,
        };
      }

      const token = await deps.session.accessToken().catch(() => undefined);
      const profile = token === undefined ? undefined : await safe(() => deps.api.profile(token));
      const balance = typeof profile?.balance === "number" ? profile.balance : undefined;
      const email = String(profile?.email ?? stored.email ?? "");

      const parts = [`已登录 ${email || "（未知邮箱）"}`];
      parts.push(balance === undefined ? "余额未知" : `余额 $${balance.toFixed(2)}`);
      parts.push(typeof apiKey === "string" && apiKey !== "" ? `密钥 ${maskSecret(apiKey)}` : "尚未创建密钥");
      parts.push(`已同步 ${deps.catalog.visible().length} 个模型`);

      return {
        ok: true,
        message: parts.join("，"),
        loggedIn: true,
        email,
        ...(balance === undefined ? {} : { balance }),
        hasKey: typeof apiKey === "string" && apiKey !== "",
        keyMasked: maskSecret(apiKey),
        modelCount: deps.catalog.visible().length,
        apiBase: deps.cfg().apiBase,
      };
    },
  });
}

/** The upstream catalog, so the model can recommend an id instead of guessing. */
function modelsTool(deps) {
  return defineTool({
    name: "sub2api_models",
    description:
      "列出 Sub2API 中转站当前可用的模型 id（来自上游 /v1/models，与模型选择器一致）。需要先登录。返回 id、显示名、上下文窗口与是否支持图片。",
    parameters: {
      limit: {
        type: "number",
        description: "最多返回多少个模型，默认 50",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          message: { type: "string", required: true },
          count: { type: "number" },
          models: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                contextWindow: { type: "number" },
                vision: { type: "boolean" },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: "text", text: String(value.message ?? "") }],
    },
    async execute(args) {
      const limit = Math.max(1, Math.min(200, Number(args?.limit) || 50));
      await deps.catalog.load();
      const models = deps.catalog.visible().slice(0, limit);

      if (models.length === 0) {
        return {
          ok: false,
          message: "还没有同步到任何模型。请在 设置 → Sub2API 面板登录后点「刷新模型」。",
          count: 0,
          models: [],
        };
      }

      return {
        ok: true,
        message: `共 ${deps.catalog.visible().length} 个模型，前 ${models.length} 个：\n${models
          .map((model) => {
            const extras = [];
            if (model.contextWindow !== undefined) extras.push(`${model.contextWindow} tokens`);
            if (model.vision === true) extras.push("图片");
            return `- ${model.id}${extras.length > 0 ? `（${extras.join("，")}）` : ""}`;
          })
          .join("\n")}`,
        count: models.length,
        models: models.map((model) => ({
          id: model.id,
          name: model.name,
          ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
          ...(model.vision === true ? { vision: true } : {}),
        })),
      };
    },
  });
}

/** Run one optional read, mapping a failure to `undefined`. */
async function safe(run) {
  try {
    return await run();
  } catch {
    return undefined;
  }
}
