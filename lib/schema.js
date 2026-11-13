/**
 * The plugin's configuration schema.
 *
 * Exporting this is not cosmetic: the Models page only lists provider cards
 * whose settings namespace is schema-declared, and the settings page only
 * projects fields that a schema marks. A plugin without it registers a route
 * that no surface can configure.
 *
 * Every field is volatile, so a settings-page write updates the running plugin
 * in place — `resolveConfig` re-reads each field on use, which is what makes a
 * new `apiBase` apply to the next request without a restart.
 * @module dsh-sub2api/schema
 */

import z from "@deepseek-ai/schemastery";
import { API_KEY_REF, KEY_NAME } from "./constants.js";

const text = (fallback, description) =>
  z.string().default(fallback).description(description).volatile();

const count = (description) => z.natural().description(description).volatile();

export const Config = z.object({
  apiBase: text("https://sub.pscly.cc", "中转站地址；末尾的 /v1 会被自动去掉"),
  payBase: text("https://pay.pscly.cc", "充值中转站地址（独立服务）"),
  apiKeyEnv: text(API_KEY_REF, "存放 API Key 的凭据引用名"),
  keyName: text(KEY_NAME, "自动创建/复用的密钥名称"),
  groupId: count("强制指定密钥所属分组；留空则跟随账号的默认分组"),
  requestTimeoutMs: count("普通请求超时（毫秒）").default(300000),
  streamIdleTimeoutMs: count("流式请求空闲超时（毫秒）").default(300000),
  modelsCachePath: text("", "模型目录缓存路径；留空使用 $DSH_HOME/sub2api-models.json"),
  visibleModels: z.array(z.string()).description("只在这些模型 id 中显示；留空显示全部").volatile(),
  contextWindow: count("强制覆盖所有模型的上下文窗口；留空则逐模型解析"),
  defaultContextWindow: count("上游没有声明上下文窗口时使用的兜底值（默认 128000）"),
  rechargeMultiplier: z.natural().min(1).max(100).description("每 1 元到账多少额度，用于面板预估").volatile(),
  reasoningModels: z.array(z.string()).description("额外声明支持思考等级的模型 id 片段").volatile(),
  defaultReasoningEffort: text("", "默认思考等级（minimal/low/medium/high）；留空由上游决定"),
  showSidebarQuota: z.boolean().default(false).description("在侧边栏显示余额卡片").volatile(),
  autoProvision: z.boolean().default(true).description("登录后自动创建并保存密钥").volatile(),
  announceToAgent: z.boolean().default(true).description("向 agent 注入插件说明").volatile(),
});
