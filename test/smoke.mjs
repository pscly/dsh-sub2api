/**
 * End-to-end smoke test against fake services.
 *
 * Deliberately runs the *real* plugin entry, the real routes and the real
 * adapter; only the two remote services and the host seams are fake. That is
 * the closest thing to "it works" without installing the plugin into a profile.
 */

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { apply } from "../lib/index.js";
import {
  createFakeCredentials,
  createFakeHost,
  startFakePayCenter,
  startFakeSub2Api,
  startRouteHarness,
} from "./fake-world.mjs";

const results = [];
function pass(label, detail = "") {
  results.push({ ok: true, label, detail });
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label, error) {
  results.push({ ok: false, label, detail: String(error?.message ?? error) });
  console.log(`  ✗ ${label} — ${String(error?.message ?? error)}`);
}

async function json(base, path, body) {
  const init = { method: body === undefined ? "GET" : "POST", headers: {} };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(base + path, init);
  const payload = await response.json();
  if (payload.ok !== true) throw new Error(`${path}: ${payload.error ?? "failed"}`);
  return payload.data;
}

let lastChatBody;
const sub2api = startFakeSub2Api({ onChatBody: (body) => { lastChatBody = body; } });
const sub2apiBase = await sub2api.listen();
const payCenter = startFakePayCenter({ sub2apiBase });
const payBase = await payCenter.listen();

const host = createFakeHost();
const credentials = createFakeCredentials();
host.services.set("credentials", credentials);

// Keep every byte the plugin writes inside the temp dir: the smoke test must
// not leave a catalog cache in the real $DSH_HOME.
const cachePath = join(tmpdir(), `dsh-sub2api-smoke-${process.pid}.json`);
apply(host.ctx, { apiBase: sub2apiBase, payBase, keyName: "dsh", modelsCachePath: cachePath });

const harness = await startRouteHarness(host.registered.routes);

console.log("\n[1] 注册表");
try {
  assert.equal(host.registered.providers.length, 1, "应当注册一个 provider 目录项");
  assert.equal(host.registered.providers[0].provider, "sub2api");
  assert.equal(host.registered.adapters.length, 1, "应当注册一个适配器");
  assert.deepEqual(host.registered.adapters[0].providers, ["sub2api"]);
  assert.ok(host.registered.routes.length >= 10, `路由数量 ${host.registered.routes.length}`);
  pass("provider / adapter / routes 均已注册", `${host.registered.routes.length} 条路由`);
} catch (error) {
  fail("注册表", error);
}

console.log("\n[2] 未登录状态");
try {
  const state = await json(harness.base, "/api/sub2api/status");
  assert.equal(state.loggedIn, false);
  assert.equal(state.hasKey, false);
  pass("status 返回未登录", `apiBase=${state.apiBase}`);
} catch (error) {
  fail("未登录状态", error);
}

console.log("\n[3] 注册 + 自动开通");
let stateAfterAuth;
try {
  const data = await json(harness.base, "/api/sub2api/auth", {
    email: "tester@example.com",
    password: "secret-123",
  });
  assert.equal(data.mode, "register", "新邮箱应当走注册");
  assert.equal(data.ready, true, `开通未完成：${JSON.stringify(data.steps)}`);

  const keyStep = data.steps.find((step) => step.id === "key");
  assert.ok(keyStep?.ok, "密钥步骤应当成功");
  const credentialStep = data.steps.find((step) => step.id === "credential");
  assert.ok(credentialStep?.ok, "凭据写入应当成功");
  const catalogStep = data.steps.find((step) => step.id === "catalog");
  assert.equal(catalogStep?.ok, false, "零余额账号拉不到模型");
  assert.equal(catalogStep?.tone, "warn", "零余额应当是提示而不是错误");
  assert.equal(data.ready, true, "零余额不应阻止开通");

  const createdKey = sub2api.keys[0];
  assert.equal(createdKey.name, "dsh", "密钥名称必须是 dsh");
  assert.ok(credentials._refs.get("SUB2API_API_KEY"), "凭据库应当存有密钥");
  stateAfterAuth = data.state;
  pass("注册后自动建 dsh 密钥并写入凭据", `${sub2api.keys.length} 个密钥`);
  assert.equal(stateAfterAuth.models.models.length, 0, "零余额时模型为空");
  assert.equal(stateAfterAuth.models.needsRecharge, true, "应当标记为需要充值");
  pass("零余额被识别为需要充值，而不是静默为空");
} catch (error) {
  fail("注册 + 自动开通", error);
}

console.log("\n[4] 状态与余额");
try {
  const state = await json(harness.base, "/api/sub2api/status");
  assert.equal(state.loggedIn, true);
  assert.equal(state.hasKey, true);
  assert.equal(state.email, "tester@example.com");
  assert.ok(state.keyMasked.includes("…"), `掩码异常：${state.keyMasked}`);
  assert.equal(state.profile.email, "tester@example.com");
  pass("状态完整", `余额 ${state.profile.balance}`);
} catch (error) {
  fail("状态与余额", error);
}

console.log("\n[5] 再次登录（同一账号复用密钥）");
try {
  const before = sub2api.keys.length;
  const data = await json(harness.base, "/api/sub2api/auth", {
    email: "tester@example.com",
    password: "secret-123",
  });
  assert.equal(data.mode, "login");
  assert.equal(sub2api.keys.length, before, "重复登录不应新建密钥");
  pass("复用了已有 dsh 密钥");
} catch (error) {
  fail("再次登录", error);
}

console.log("\n[6] 错误密码");
try {
  await json(harness.base, "/api/sub2api/auth", {
    email: "tester@example.com",
    password: "wrong-password",
  });
  fail("错误密码", new Error("应当失败却成功了"));
} catch (error) {
  assert.match(error.message, /密码/, `提示不准确：${error.message}`);
  pass("错误密码被拒绝", error.message);
}

console.log("\n[6.5] 充值后模型解禁");
try {
  const before = await json(harness.base, "/api/sub2api/models/refresh", {});
  assert.equal(before.count, 0, "零余额时仍应为 0");
  assert.equal(before.error?.code, "INSUFFICIENT_BALANCE", `错误码：${JSON.stringify(before.error)}`);

  await json(harness.base, "/api/sub2api/redeem", { code: "GIFT" });
  const after = await json(harness.base, "/api/sub2api/models/refresh", {});
  assert.equal(after.error, null, "有余额后不应再报错");
  assert.equal(after.count, 3, `同步数量 ${after.count}`);
  pass("余额到账后模型自动解禁", `${after.count} 个`);
} catch (error) {
  fail("充值后模型解禁", error);
}

console.log("\n[6.6] 模型可见性与选择器刷新");
try {
  // A successful sync must announce itself, or an open picker keeps the empty
  // directory it built before the first login.
  assert.ok(host.registered.replaced.length > 0, "同步后应当调用 replace() 通知选择器");

  const before = await json(harness.base, "/api/sub2api/models", undefined);
  assert.equal(before.all.length, 3, `全量 ${before.all.length}`);
  assert.deepEqual(before.allowed, [], "默认不限制");

  const only = await json(harness.base, "/api/sub2api/models/visible", { ids: ["glm-5.2"] });
  assert.deepEqual(only.models.allowed, ["glm-5.2"]);
  assert.equal(only.models.models.length, 1, "只显示勾选的模型");

  const { adapter } = host.registered.adapters[0];
  const listed = await adapter.listModels("sub2api");
  assert.equal(listed.length, 1, "选择器接口也只剩下勾选的那个");

  const all = await json(harness.base, "/api/sub2api/models/visible", { ids: [] });
  assert.equal(all.models.models.length, 3, "清空选择后恢复全部");

  await assert.rejects(
    () => json(harness.base, "/api/sub2api/models/visible", { ids: ["nope"] }),
    /不在当前目录/,
  );
  pass("可见模型可保存、可生效、可清空");
} catch (error) {
  fail("模型可见性", error);
}

console.log("\n[6.7] 单模型上下文手动修正");
try {
  const before = (await json(harness.base, "/api/sub2api/models")).models.find((m) => m.id === "glm-5.2");
  assert.equal(before.contextWindow, 200000, "上游声明的容量优先");

  const after = await json(harness.base, "/api/sub2api/models/context", {
    id: "glm-5.2",
    contextWindow: 64000,
  });
  const entry = after.models.models.find((m) => m.id === "glm-5.2");
  assert.equal(entry.contextWindow, 64000);
  assert.equal(entry.contextSource, "panel");

  const { adapter } = host.registered.adapters[0];
  const resolved = await adapter.resolveModel("sub2api", "glm-5.2");
  assert.equal(resolved.context.contextWindow, 64000, "resolveModel 使用手填值");

  await json(harness.base, "/api/sub2api/models/context", { id: "glm-5.2", contextWindow: null });
  const restored = (await json(harness.base, "/api/sub2api/models")).models.find((m) => m.id === "glm-5.2");
  assert.equal(restored.contextWindow, 200000, "清除后回到上游值");
  pass("手填容量可覆盖、可清除");
} catch (error) {
  fail("单模型上下文", error);
}

console.log("\n[6.8] 诊断");
try {
  const report = await json(harness.base, "/api/sub2api/diagnose");
  assert.ok(Array.isArray(report.checks) && report.checks.length >= 5, "应当有多项检查");
  assert.ok(report.checks.every((c) => typeof c.ok === "boolean" && c.label), "每项都要有结论");
  assert.equal(report.ok, true, `诊断未通过：${JSON.stringify(report.checks.filter((c) => !c.ok))}`);
  assert.ok(report.checks.some((c) => c.id === "catalog" && c.ok), "模型目录应当正常");
  pass("诊断跑通", report.summary);
} catch (error) {
  fail("诊断", error);
}

console.log("\n[7] 适配器：模型列表与流式对话");
try {
  const { adapter } = host.registered.adapters[0];
  const models = await adapter.listModels("sub2api");
  assert.equal(models.length, 3, `模型数量 ${models.length}`);
  assert.ok(models.every((model) => model.provider === "sub2api"));

  const chunks = [];
  for await (const chunk of adapter.stream({
    provider: "sub2api",
    model: "glm-5.2",
    messages: [{ role: "user", content: [{ type: "text", text: "你好" }] }],
  })) {
    chunks.push(chunk);
  }
  const text = chunks
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.text)
    .join("");
  assert.equal(text, "你好，世界", `流式文本："${text}"`);
  assert.ok(chunks.some((chunk) => chunk.type === "finish"), "缺少 finish 分片");
  pass("流式对话通过", `${chunks.length} 个分片`);
} catch (error) {
  fail("适配器", error);
}

console.log("\n[7.5] 思考等级");
try {
  const { adapter } = host.registered.adapters[0];

  // The picker only offers a thinking control when the adapter declares levels.
  const flash = await adapter.resolveModel("sub2api", "gpt-5.6-vision");
  assert.ok(flash.reasoning, "gpt-5 家族应当声明思考等级");
  assert.deepEqual(flash.reasoning.efforts.map((e) => e.id), ["minimal", "low", "medium", "high"]);

  const plain = await adapter.resolveModel("sub2api", "kimi-k3");
  assert.equal(plain.reasoning, undefined, "未声明的模型不给档位");

  lastChatBody = undefined;
  for await (const _chunk of adapter.stream({
    provider: "sub2api",
    model: "gpt-5.6-vision",
    reasoningEffort: "high",
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  })) {
    // drain
  }
  assert.equal(lastChatBody?.reasoning_effort, "high", `请求体：${JSON.stringify(lastChatBody)}`);
  pass("档位声明 + 请求体映射", "reasoning_effort=high");
} catch (error) {
  fail("思考等级", error);
}

console.log("\n[7.8] 额度单位与倍率");
try {
  const state = await json(harness.base, "/api/sub2api/status");
  assert.equal(state.rechargeMultiplier, 2, `倍率 ${state.rechargeMultiplier}`);
  assert.equal(state.currency, "CNY", "额度以人民币计价");
  assert.match(String(state.version), /^\d+\.\d+\.\d+/, `版本号：${state.version}`);

  const order = await json(harness.base, "/api/sub2api/recharge", { amountYuan: 10 });
  assert.equal(order.multiplier, 2, "下单响应也带倍率");
  pass("额度按人民币计价，倍率来自配置");
} catch (error) {
  fail("额度单位", error);
}

console.log("\n[8] 充值");
try {
  const order = await json(harness.base, "/api/sub2api/recharge", { amountYuan: 20 });
  assert.match(order.checkoutUrl, /\/checkout\/SUB/, `checkout 地址异常：${order.checkoutUrl}`);
  const status = await json(harness.base, "/api/sub2api/recharge/status", { orderNo: order.orderNo });
  assert.equal(status.tone, "done", `状态 ${JSON.stringify(status)}`);
  pass("下单并轮询到账", order.orderNo);
} catch (error) {
  fail("充值", error);
}

console.log("\n[9] 充值链接（一级降级路径）");
try {
  const link = await json(harness.base, "/api/sub2api/recharge/link", {});
  assert.match(link.url, /user_id=\d+/);
  assert.match(link.url, /token=tok-/);
  pass("生成带身份的重充链接");
} catch (error) {
  fail("充值链接", error);
}

console.log("\n[10] 兑换码");
try {
  const data = await json(harness.base, "/api/sub2api/redeem", { code: "GIFT" });
  assert.equal(data.result.new_balance, 10, "第二次兑换后余额应为 10");
  assert.equal(data.profile.balance, 10);
  pass("兑换码入账", `余额 ${data.profile.balance}`);
} catch (error) {
  fail("兑换码", error);
}

console.log("\n[11] 工具");
try {
  // Tools load through a dynamic import, so give that turn a moment to settle.
  for (let i = 0; i < 40 && host.registered.tools.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const status = host.registered.tools.find((tool) => tool.name === "sub2api_status");
  assert.ok(status, "缺少 sub2api_status 工具");
  const value = await status.execute({});
  assert.equal(value.loggedIn, true);
  assert.ok(value.message.includes("余额"), value.message);

  const modelsTool = host.registered.tools.find((tool) => tool.name === "sub2api_models");
  const listed = await modelsTool.execute({ limit: 2 });
  assert.equal(listed.models.length, 2);
  pass("工具可调用", value.message);
} catch (error) {
  fail("工具", error);
}

console.log("\n[12] 登出");
try {
  await json(harness.base, "/api/sub2api/logout", {});
  const state = await json(harness.base, "/api/sub2api/status");
  assert.equal(state.loggedIn, false);
  assert.equal(state.hasKey, false);
  assert.equal(credentials._refs.get("SUB2API_API_KEY"), undefined, "凭据应当被清除");
  pass("登出清理完整");
} catch (error) {
  fail("登出", error);
}

await rm(cachePath, { force: true });
await harness.close();
await sub2api.close();
await payCenter.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  for (const entry of failed) console.log(`失败：${entry.label} — ${entry.detail}`);
  process.exitCode = 1;
}
