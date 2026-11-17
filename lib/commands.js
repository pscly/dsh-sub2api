/**
 * `/sub2api` — the account's state without opening the panel.
 *
 * A command runs on the host and answers with text, so it works in the
 * terminal client too, where the settings page has no surface.
 * @module dsh-sub2api/commands
 */

import { maskSecret } from "./util.js";

const HELP = [
  "用法：/sub2api [status|models|balance|recharge]",
  "  status    账号、密钥、余额与模型数量（默认）",
  "  models    列出对话里可选的模型",
  "  balance   只看余额与订阅",
  "  recharge  给出充值入口",
].join("\n");

/**
 * @param {object} deps
 * @param {import("./sub2api/api.js").Sub2ApiApi} deps.api
 * @param {import("./sub2api/session.js").SessionStore} deps.session
 * @param {import("./sub2api/catalog.js").ModelCatalog} deps.catalog
 * @param {() => any} deps.cfg
 * @returns {{name: string, description: string, input: {hint: string}, handler: Function}}
 */
export function commandDefinition(deps) {
  return {
    name: "sub2api",
    description: "Psapi 中转站：账号、密钥、余额与可用模型",
    input: { hint: "[status|models|balance|recharge]" },
    handler: async (invocation) => {
      const verb = String(invocation?.rawInput ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      try {
        if (verb === "help" || verb === "-h" || verb === "--help") {
          return { kind: "success", text: HELP };
        }
        if (verb === "recharge") return { kind: "success", text: await rechargeText(deps) };
        if (verb === "models") return { kind: "success", text: await modelsText(deps) };
        if (verb === "balance") return { kind: "success", text: await balanceText(deps) };
        return { kind: "success", text: await statusText(deps) };
      } catch (error) {
        return {
          kind: "error",
          text: `Psapi：${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

/**
 * Register the command when the host has a command runtime.
 * @param {any} ctx
 * @param {object} deps
 */
export function applyCommands(ctx, deps) {
  const commands = safeGet(ctx, "commands");
  if (commands === undefined || typeof commands.register !== "function") return undefined;
  return commands.register(commandDefinition(deps));
}

async function statusText(deps) {
  const session = await deps.session.read();
  const apiKey = await deps.session.apiKey();
  await deps.catalog.load();

  if (session === undefined) {
    return [
      "Psapi：尚未登录。",
      `在 DSH 的 设置 → Psapi 里用一个邮箱和密码登录或注册即可（${deps.cfg().apiBase}）。`,
    ].join("\n");
  }

  const token = await deps.session.accessToken().catch(() => undefined);
  const profile = token ? await safe(() => deps.api.profile(token)) : undefined;
  const models = deps.catalog.visible();

  const lines = [
    `Psapi · ${deps.cfg().apiBase}`,
    `账号　　　${profile?.email ?? session.email ?? "已登录"}`,
    `余额　　　${money(profile?.balance)}`,
    `密钥　　　${apiKey ? maskSecret(apiKey) : "尚未创建"}`,
    `模型　　　${models.length} 个可选（上游共 ${deps.catalog.models.length}）`,
  ];

  const catalogError = deps.catalog.lastError;
  if (catalogError) lines.push(`模型状态　${catalogError.message}`);

  const subscription = token ? await safe(() => deps.api.subscriptionSummary(token)) : undefined;
  const active = subscription?.subscriptions;
  if (Array.isArray(active) && active.length > 0) {
    lines.push(
      `订阅　　　${active
        .map((entry) => `${entry.group_name || "订阅"}（剩余 ${entry.days_remaining ?? "?"} 天）`)
        .join("、")}`,
    );
  }
  lines.push("", "更多：/sub2api models · /sub2api balance · /sub2api recharge");
  return lines.join("\n");
}

async function balanceText(deps) {
  const token = await deps.session.accessToken();
  const [profile, subscription] = await Promise.all([
    deps.api.profile(token).catch(() => undefined),
    deps.api.subscriptionSummary(token).catch(() => undefined),
  ]);
  const lines = [`余额　${money(profile?.balance)}`];
  const active = subscription?.subscriptions;
  if (Array.isArray(active) && active.length > 0) {
    for (const entry of active) {
      lines.push(`${entry.group_name || "订阅"}　剩余 ${entry.days_remaining ?? "?"} 天`);
      if (entry.daily_progress !== null && entry.daily_progress !== undefined) {
        lines.push(`　日用量 ${percent(entry.daily_progress)}　周 ${percent(entry.weekly_progress)}　月 ${percent(entry.monthly_progress)}`);
      }
    }
  }
  return lines.join("\n");
}

async function modelsText(deps) {
  await deps.catalog.load();
  const models = deps.catalog.visible();
  if (models.length === 0) {
    const reason = deps.catalog.lastError?.message;
    return reason
      ? `没有可用模型：${reason}`
      : "没有可用模型。登录后在 设置 → Psapi 里点「刷新模型」。";
  }
  const lines = models.map((model) => {
    const bits = [`${Math.round((model.contextWindow ?? 0) / 1000)}k`];
    if (model.vision) bits.push("图片");
    if (model.contextSource === "default") bits.push("默认容量");
    return `- ${model.id}　${bits.join(" · ")}`;
  });
  return [`共 ${models.length} 个模型：`, ...lines].join("\n");
}

async function rechargeText(deps) {
  const session = await deps.session.read();
  const userId = session?.user?.id;
  const token = await deps.session.accessToken().catch(() => undefined);
  if (!session || !token || userId === undefined) {
    return "尚未登录，无法生成充值入口。";
  }
  // The panel opens this in a tab; the command can only hand over the URL.
  const url = new URL(`${deps.cfg().payBase}/embedded/sub-recharge`);
  url.searchParams.set("user_id", String(userId));
  url.searchParams.set("token", token);
  url.searchParams.set("ui_mode", "embedded");
  url.searchParams.set("lang", "zh");
  return [
    "充值入口（在浏览器打开）：",
    url.toString(),
    "",
    "注意：链接里带着访问令牌，用完即可关闭；面板里的「去支付」会替你处理这些。",
  ].join("\n");
}

/** Quota is yuan-denominated: one unit equals one yuan on this gateway. */
function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `¥${n.toFixed(2)}` : "—";
}

function percent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : "—";
}

async function safe(run) {
  try {
    return await run();
  } catch {
    return undefined;
  }
}

function safeGet(ctx, name) {
  try {
    return ctx?.get?.(name);
  } catch {
    return undefined;
  }
}
