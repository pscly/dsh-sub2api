/**
 * Boundary checks: the ways this plugin can be deployed into a host that is
 * missing a service, or into an installation whose transport dependency is
 * broken. None of them may take the whole plugin down.
 */

import assert from "node:assert/strict";
import { apply } from "../lib/index.js";
import { createFakeCredentials, createFakeHost } from "./fake-world.mjs";
import { Sub2ApiAdapter, loadTransport, mergeSampling } from "../lib/adapter.js";

const results = [];
function pass(label, detail = "") {
  results.push({ ok: true, label });
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label, error) {
  results.push({ ok: false, label, detail: String(error?.message ?? error) });
  console.log(`  ✗ ${label} — ${String(error?.message ?? error)}`);
}

console.log("\n[A] 无头环境：只有 llm，没有 webServer / tools / systemPrompt / credentials");
try {
  const host = createFakeHost();
  // Strip every optional service, leaving only the LLM seam a headless host has.
  host.services.delete("webServer");
  host.services.delete("tools");
  host.services.delete("systemPrompt");
  delete host.ctx.webServer;
  delete host.ctx.tools;
  delete host.ctx.systemPrompt;

  apply(host.ctx, { apiBase: "http://127.0.0.1:1", payBase: "http://127.0.0.1:1" });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(host.registered.providers.length, 1, "provider 目录项仍应注册");
  assert.equal(host.registered.adapters.length, 1, "适配器仍应注册");
  assert.equal(host.registered.routes.length, 0, "没有 webServer 时不应注册路由");
  assert.equal(host.registered.tools.length, 0, "没有 tools 时不应注册工具");
  pass("无头环境不抛错，只挂 provider + adapter");
} catch (error) {
  fail("无头环境", error);
}

console.log("\n[B] 缺少凭据服务时读取会话");
try {
  const host = createFakeHost();
  host.services.delete("credentials");
  apply(host.ctx, { apiBase: "http://127.0.0.1:1", payBase: "http://127.0.0.1:1" });
  const { adapter } = host.registered.adapters[0];
  const models = await adapter.listModels("sub2api");
  assert.deepEqual(models, [], "没有凭据服务时目录为空而不是抛错");
  pass("读取会话安全降级");
} catch (error) {
  fail("缺少凭据服务", error);
}

console.log("\n[C] 适配器在目录为空时的报错信息");
try {
  const host = createFakeHost();
  host.services.set("credentials", createFakeCredentials());
  apply(host.ctx, { apiBase: "http://127.0.0.1:1", payBase: "http://127.0.0.1:1", modelsCachePath: `${process.env.TMPDIR ?? "/tmp"}/dsh-sub2api-empty-${process.pid}.json` });
  const { adapter } = host.registered.adapters[0];
  assert.ok(adapter instanceof Sub2ApiAdapter);
  await assert.rejects(
    async () => {
      for await (const _chunk of adapter.stream({ provider: "sub2api", model: "x", messages: [] })) {
        // no chunks expected
      }
    },
    (error) => {
      assert.match(String(error.message), /模型/);
      return true;
    },
  );
  pass("空目录时给出可操作提示");
} catch (error) {
  fail("空目录提示", error);
}

console.log("\n[D] 传输层缺失时的报错信息");
try {
  const module = await loadTransport();
  assert.equal(typeof module.OpenAiLlmService, "function", "依赖应当可用（未安装时此断言会失败）");
  pass("复用层可加载", "OpenAiLlmService 已就绪");
} catch (error) {
  fail("复用层可加载", error);
}

console.log("\n[E] 采样合并");
try {
  const merged = mergeSampling(
    { temperature: 0.3, maxTokens: 1000 },
    { temperature: 0.9, topP: 0.8 },
    { temperature: 0.1, maxTokens: undefined },
  );
  assert.equal(merged.temperature, 0.1, "请求里的值最优先");
  assert.equal(merged.maxTokens, 1000, "未指定的字段不应被 undefined 覆盖");
  assert.equal(merged.topP, 0.8, "模型的默认值保留");
  pass("merged", JSON.stringify(merged));
} catch (error) {
  fail("采样合并", error);
}

console.log("\n[F] 模型目录解析：多种上游形状");
try {
  const { normalizeModels } = await import("../lib/sub2api/catalog.js");
  const shapes = [
    { object: "list", data: [{ id: "a" }] },
    [{ id: "b" }],
    { models: [{ id: "c" }] },
    { data: { data: [{ id: "d" }] } },
  ];
  const ids = shapes.map((shape) => normalizeModels(shape).map((model) => model.id).join(","));
  assert.deepEqual(ids, ["a", "b", "c", "d"]);
  assert.equal(normalizeModels({ data: [{ id: "dup" }, { id: "dup" }] }).length, 1, "去重");
  pass("四种形状都能解析", ids.join(" | "));
} catch (error) {
  fail("模型目录解析", error);
}

console.log("\n[G] 与 settings schema 的接线");
try {
  const { Config } = await import("../lib/schema.js");
  const { resolveConfig } = await import("../lib/config.js");

  // The loader hands `apply()` the schema-resolved object, whose fields are
  // Volatile references rather than plain values.
  const resolved = Config({ apiBase: "https://relay.example", requestTimeoutMs: 1234 });
  const cfg = resolveConfig(resolved);
  assert.equal(cfg.apiBase, "https://relay.example", "apiBase 应被读取");
  assert.equal(cfg.requestTimeoutMs, 1234, "timeout 应被读取");
  assert.equal(cfg.keyName, "dsh", "keyName 默认值");
  assert.ok(cfg.modelsCachePath.endsWith("sub2api-models.json"), "缓存路径默认值");
  assert.deepEqual(cfg.visibleModels, [], "可见模型默认空");

  // A plain object (programmatic composition) must resolve identically.
  const plain = resolveConfig({ apiBase: "https://relay.example/v1/", keyName: "custom" });
  assert.equal(plain.apiBase, "https://relay.example", "/v1 后缀应被去掉");
  assert.equal(plain.keyName, "custom");
  pass("Volatile 与普通对象都能解析");
} catch (error) {
  fail("schema 接线", error);
}

console.log("\n[H] 错误信息不再变成 [object Object]");
try {
  const { createServer } = await import("node:http");
  const { Sub2ApiApi } = await import("../lib/sub2api/api.js");
  const { describe } = await import("../lib/sub2api/provision.js");
  const { readableMessage } = await import("../lib/util.js");

  // The gateway answers key/permission faults in OpenAI's shape, which has no
  // top-level `message` -- casting `body.error` to a string is what produced
  // "[object Object]" in the panel.
  const shapes = [
    [{ error: { message: "API key is not assigned to a group", type: "permission_error" } }, 403, "API key is not assigned to a group"],
    [{ error: { type: "permission_error" } }, 403, "permission_error"],
    [{ code: "INSUFFICIENT_BALANCE", message: "Insufficient account balance" }, 403, "Insufficient account balance"],
    [{}, 500, "HTTP 500"],
  ];
  for (const [body, status, expected] of shapes) {
    assert.equal(readableMessage(body, status), expected, JSON.stringify(body));
  }

  const server = createServer((req, res) => {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "API key is not assigned to a group", type: "permission_error" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const api = new Sub2ApiApi({ apiBase: () => `http://127.0.0.1:${port}`, timeoutMs: () => 5000 });
  await assert.rejects(
    () => api.gatewayModels("sk-nope"),
    (error) => {
      assert.equal(error.message, "API key is not assigned to a group");
      assert.ok(!error.message.includes("[object Object]"));
      return true;
    },
  );
  await new Promise((resolve) => server.close(resolve));

  assert.equal(describe(new Error("boom")), "boom");
  assert.equal(describe({ message: "plain" }), "plain");
  assert.equal(describe({ code: 42 }), '{"code":42}');
  assert.ok(!describe({ weird: true }).includes("[object Object]"));
  pass("三种错误体都能读出可读文案");
} catch (error) {
  fail("错误信息可读性", error);
}

console.log("\n[I] 选组：不允许出现无分组密钥");
try {
  const { chooseGroup } = await import("../lib/sub2api/provision.js");
  const two = [
    { id: 21, name: "用户", platform: "openai", status: "active", is_exclusive: false },
    { id: 25, name: "jeykey", platform: "typesafe", status: "active", is_exclusive: false },
  ];
  assert.equal(chooseGroup({ groups: two, allowed: null }), 21, "多组时选 OpenAI 平台组");
  assert.equal(chooseGroup({ groups: two, allowed: [25] }), 25, "allowed 优先");
  assert.equal(chooseGroup({ groups: two, forced: 25, allowed: [21] }), 25, "forced 最优先");
  assert.equal(chooseGroup({ groups: [two[0]], allowed: null }), 21, "单组直接用");
  assert.equal(
    chooseGroup({ groups: [{ id: 9, status: "active", platform: "anthropic" }], allowed: null }),
    9,
    "没有 openai 组时退回唯一组",
  );
  assert.equal(chooseGroup({ groups: [], allowed: null }), undefined, "无组时 undefined");
  pass("选组不会留下无分组密钥");
} catch (error) {
  fail("选组", error);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
