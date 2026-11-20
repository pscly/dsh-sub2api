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
  // No credential service still means no throw; the built-in remains so the
  // picker is not empty while the plugin reports the real problem elsewhere.
  assert.deepEqual(models.map((m) => m.id), ["deepseek-flash"], "没有凭据服务时只保留内置模型");
  pass("读取会话安全降级");
} catch (error) {
  fail("缺少凭据服务", error);
}

console.log("\n[C] 上游一个模型都没有时，内置 deepseek-flash 仍然可用");
try {
  const host = createFakeHost();
  host.services.set("credentials", createFakeCredentials());
  apply(host.ctx, { apiBase: "http://127.0.0.1:1", payBase: "http://127.0.0.1:1", modelsCachePath: `${process.env.TMPDIR ?? "/tmp"}/dsh-sub2api-empty-${process.pid}.json` });
  const { adapter } = host.registered.adapters[0];
  assert.ok(adapter instanceof Sub2ApiAdapter);

  // The picker must not be empty just because the upstream refused to list
  // (a zero-balance account gets 403 INSUFFICIENT_BALANCE from /v1/models).
  const models = await adapter.listModels();
  assert.equal(models.length, 1, `应恰好剩下内置模型，实际 ${JSON.stringify(models.map((m) => m.id))}`);
  assert.equal(models[0].id, "deepseek-flash");
  const resolved = await adapter.resolveModel("sub2api", "deepseek-flash");
  assert.ok(
    (resolved?.context?.contextWindow ?? 0) >= 1048576,
    `内置模型的容量要够开新会话，实际 ${JSON.stringify(resolved?.context)}`,
  );

  // The request itself now goes out instead of being rejected locally; this
  // endpoint answers nothing, so the failure is a transport one.
  await assert.rejects(
    async () => {
      for await (const _chunk of adapter.stream({ provider: "sub2api", model: "deepseek-flash", messages: [] })) {
        // no chunks expected
      }
    },
    (error) => {
      assert.doesNotMatch(String(error.message), /没有可用模型|尚未同步/);
      return true;
    },
  );
  pass("空目录仍提供 deepseek-flash");
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

console.log("\n[J] 每个模型都必须有上下文窗口");
try {
  const { ModelCatalog, knownContext } = await import("../lib/sub2api/catalog.js");
  const { DEFAULT_CONTEXT_WINDOW } = await import("../lib/constants.js");

  // Measured on the gateway: 1,048,576 tokens.
  assert.equal(knownContext("deepseek/deepseek-v4.1-flash"), 1048576);
  assert.equal(knownContext("glm-5.2"), undefined);

  // The gateway's /v1/models carries no context at all, so these come from the
  // measured table; without it every one of them advertised 128k.
  assert.equal(knownContext("deepseek-v4.1-flash"), 1048576, "deepseek 实测值");
  assert.equal(knownContext("gpt-6-sol"), 950272, "gpt-6 实测值");
  assert.equal(knownContext("gpt-6.2-astra"), 524288, "同族不同代要各测各的");
  assert.equal(knownContext("muse-video"), 262144);

  const catalog = new ModelCatalog({
    api: { gatewayModels: async () => ({ data: [] }) },
    cachePath: () => "/tmp/ctx-check.json",
    visibleModels: () => [],
    selection: () => [],
    contextWindow: () => undefined,
    defaultContextWindow: () => undefined,
    apiKey: async () => undefined,
    logger: { info() {}, warn() {} },
  });

  // An upstream that discloses nothing, which is the case that broke switching.
  catalog.models = [
    { id: "deepseek/deepseek-v4.1-flash", name: "deepseek-v4.1-flash" },
    { id: "mystery-model", name: "mystery-model" },
    { id: "declared", name: "declared", contextWindow: 32000 },
  ];

  const visible = catalog.visible();
  assert.ok(visible.every((m) => typeof m.contextWindow === "number" && m.contextWindow > 0), "每个模型都要有容量");
  // Upstream order first, then the built-in every install ships with.
  assert.deepEqual(visible.map((m) => m.contextSource), ["known", "default", "upstream", "known"]);
  assert.equal(visible[0].contextWindow, 1048576);
  assert.equal(visible[1].contextWindow, DEFAULT_CONTEXT_WINDOW);
  assert.equal(visible[2].contextWindow, 32000);
  assert.equal(visible[3].id, "deepseek-flash", "内置模型必须始终在列表里");
  assert.equal(visible[3].builtin, true);
  assert.equal(visible[3].contextWindow, 1048576);

  const llm = catalog.llmModels();
  assert.ok(llm.every((m) => typeof m.contextWindow === "number"), "交给传输层的配置也要带容量");

  // A forced global value replaces all three.
  const forced = new ModelCatalog({
    api: {}, cachePath: () => "/tmp/ctx-check.json", visibleModels: () => ["declared"],
    selection: () => [], contextWindow: () => 64000, defaultContextWindow: () => undefined,
    apiKey: async () => undefined, logger: {},
  });
  forced.models = [{ id: "declared", name: "declared", contextWindow: 32000 }];
  assert.equal(forced.visible()[0].contextWindow, 64000);
  assert.equal(forced.visible()[0].contextSource, "config");
  assert.equal(forced.visible().length, 2, "白名单只选一个模型时，内置模型仍然保留");
  assert.equal(forced.visible()[1].contextWindow, 64000, "强制容量同样作用于内置模型");

  // The host asks the adapter for these facts; an empty answer is what the
  // compaction error complained about.
  const { Sub2ApiAdapter } = await import("../lib/adapter.js");
  const adapter = new Sub2ApiAdapter({
    ctx: { get: () => undefined },
    catalog,
    apiBase: () => "http://127.0.0.1:1",
    apiKeyEnv: () => "K",
    timeoutMs: () => 1000,
    idleTimeoutMs: () => 1000,
  });
  const resolved = await adapter.resolveModel("sub2api", "mystery-model");
  assert.equal(resolved.context?.contextWindow, DEFAULT_CONTEXT_WINDOW, "resolveModel 必须给出容量");

  pass("容量回退链 config → upstream → 实测 → 默认");
} catch (error) {
  fail("上下文窗口", error);
}

console.log("\n[K] /sub2api 命令");
try {
  const { commandDefinition } = await import("../lib/commands.js");
  const { createFakeCredentials } = await import("./fake-world.mjs");
  const { SessionStore } = await import("../lib/sub2api/session.js");
  const { ModelCatalog } = await import("../lib/sub2api/catalog.js");

  const credentials = createFakeCredentials();
  const session = new SessionStore({
    credentials: () => credentials,
    api: { refresh: async () => ({ access_token: "t", expires_in: 3600 }) },
    apiKeyEnv: () => "SUB2API_API_KEY",
  });

  const catalog = new ModelCatalog({
    api: {}, cachePath: () => "/tmp/cmd-models.json", visibleModels: () => [],
    selection: () => [], contextWindow: () => undefined, defaultContextWindow: () => undefined,
    apiKey: async () => undefined, logger: {},
  });
  catalog.models = [{ id: "glm-5.2", name: "glm-5.2", contextWindow: 200000 }];

  const definition = commandDefinition({
    api: {}, session, catalog, cfg: () => ({ apiBase: "https://x", payBase: "https://y" }),
  });
  assert.equal(definition.name, "sub2api");

  const notLogged = await definition.handler({ rawInput: "" });
  assert.equal(notLogged.kind, "success");
  assert.match(notLogged.text, /尚未登录/);

  const help = await definition.handler({ rawInput: "help" });
  assert.match(help.text, /用法/);

  await credentials.set("SUB2API_API_KEY", "sk-abcdef1234567890");
  await session.write({ accessToken: "t", expiresAt: Date.now() + 3600_000, user: { id: 1 }, email: "a@b.c" });

  const models = await definition.handler({ rawInput: "models" });
  assert.match(models.text, /glm-5.2/);
  assert.match(models.text, /200k/);
  pass("命令覆盖 未登录 / help / models");
} catch (error) {
  fail("命令", error);
}

console.log("\n[L] provider 注册失败时面板仍然挂载");
try {
  const host = createFakeHost();
  host.services.set("credentials", createFakeCredentials());
  // A second install, or a host that rejects the route, must not remove the
  // panel: without it the user cannot even see what went wrong.
  host.ctx.llm.fail = true;

  apply(host.ctx, { apiBase: "http://127.0.0.1:1", payBase: "http://127.0.0.1:1" });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(host.registered.providers.length, 0, "注册确实失败了");
  assert.ok(host.registered.routes.length > 0, "路由仍应注册");
  const status = host.registered.routes.find((route) => route.path.endsWith("/status"));
  assert.ok(status, "status 路由必须在");
  pass("注册失败不拖垮面板", `${host.registered.routes.length} 条路由`);
} catch (error) {
  fail("provider 注册失败降级", error);
}

console.log("\n[M] webServer 晚于插件注册时，路由仍要挂上");
try {
  const host = createFakeHost();
  host.services.set("credentials", createFakeCredentials());
  // The real host registers `webServer` from a plugin that loads after this
  // one; sampling it once during apply is what produced a 404 panel.
  host.services.delete("webServer");

  apply(host.ctx, { apiBase: "http://127.0.0.1:1", payBase: "http://127.0.0.1:1" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(host.registered.routes.length, 0, "服务还没出现时不应注册");

  host.provide("webServer", host.ctx.webServer);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(host.registered.routes.length > 0, "服务出现后必须补注册");
  pass("等待 webServer 后再挂路由", `${host.registered.routes.length} 条`);
} catch (error) {
  fail("延迟注册 webServer", error);
}

console.log("\n[N] 安装后把默认模型换成 sub2api/deepseek-flash（只做一次）");
try {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "sub2api-default-"));
  const panelPath = join(dir, "panel.json");

  const makeHost = (current) => {
    const saved = [];
    const host = createFakeHost();
    host.services.set("credentials", createFakeCredentials());
    host.services.set("agentDefaultModel", {
      currentSelection: () => current,
      saveSelection: async (next) => { saved.push(next); },
    });
    apply(host.ctx, {
      apiBase: "http://127.0.0.1:1",
      payBase: "http://127.0.0.1:1",
      panelPath,
      modelsCachePath: join(dir, "models.json"),
    });
    return { host, saved };
  };

  const first = makeHost({ provider: "deepseek", model: "deepseek-chat" });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(first.saved, [{ provider: "sub2api", model: "deepseek-flash" }], "首次安装应切换默认模型");

  // The flag is on disk, so a restart must not fight a deliberate choice.
  const second = makeHost({ provider: "anthropic", model: "claude" });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(second.saved, [], "同一次安装内不应反复改写用户的选择");

  const third = makeHost({ provider: "sub2api", model: "deepseek-flash" });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(third.saved, [], "已经是 sub2api 时无需写入");
  pass("默认模型只切换一次", "首次写入，之后不再打扰");
} catch (error) {
  fail("默认模型切换", error);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
