/**
 * A self-contained stand-in for the two remote services plus the host context.
 *
 * The smoke test runs the real plugin against this: a fake sub2api control
 * plane, a fake model gateway, a fake pay centre with the same CSRF handshake,
 * and an in-memory credential store. Nothing here touches the network.
 */

import { createServer } from "node:http";

/** Read one JSON body from a request. */
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") return {};
  const type = String(req.headers["content-type"] ?? "");
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(text);
}

/** The `{code,message,data}` envelope sub2api uses. */
function envelope(res, status, data) {
  sendJson(res, status, { code: status === 200 ? 0 : status, message: status === 200 ? "" : String(data?.message ?? ""), data: status === 200 ? data : undefined });
}

function sendHtml(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><body><p>${text}</p></body></html>`);
}

/**
 * Fake sub2api: auth, keys, groups, profile and the model gateway.
 * @param {{onKeyCreated?: (key: string) => void}} [hooks]
 */
export function startFakeSub2Api(hooks = {}) {
  const users = new Map(); // email -> {id, email, password, balance, allowed_groups}
  const keys = []; // {id, user_id, key, name, group_id, status}
  const groups = [
    { id: 1, name: "默认分组", status: "active", rate_multiplier: 1 },
    { id: 2, name: "高级分组", status: "active", rate_multiplier: 1.5 },
  ];
  let nextUserId = 100;
  let nextKeyId = 1;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = url.pathname;
    const body = req.method === "GET" ? {} : await readBody(req);
    const auth = String(req.headers.authorization ?? "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const user = [...users.values()].find((candidate) => candidate.token === token);

    if (path === "/api/v1/auth/login" && req.method === "POST") {
      const candidate = users.get(String(body.email ?? "").toLowerCase());
      if (!candidate || candidate.password !== body.password) {
        return sendJson(res, 401, { code: 401, message: "invalid credentials" });
      }
      return envelope(res, 200, issueTokens(candidate));
    }

    if (path === "/api/v1/auth/register" && req.method === "POST") {
      const email = String(body.email ?? "").toLowerCase();
      if (users.has(email)) {
        return sendJson(res, 400, { code: 400, message: "email already exists" });
      }
      const created = {
        id: nextUserId++,
        email,
        password: String(body.password ?? ""),
        balance: 0,
        allowed_groups: [1],
      };
      users.set(email, created);
      return envelope(res, 200, issueTokens(created));
    }

    if (path === "/api/v1/auth/refresh" && req.method === "POST") {
      const owner = [...users.values()].find((candidate) => candidate.refresh === body.refresh_token);
      if (!owner) return sendJson(res, 401, { code: 401, message: "invalid refresh token" });
      return envelope(res, 200, issueTokens(owner));
    }

    if (path === "/api/v1/auth/me" && req.method === "GET") {
      if (!user) return sendJson(res, 401, { code: 401, message: "unauthorized" });
      return envelope(res, 200, publicUser(user));
    }

    if (path === "/api/v1/user/profile" && req.method === "GET") {
      if (!user) return sendJson(res, 401, { code: 401, message: "unauthorized" });
      return envelope(res, 200, publicUser(user));
    }

    if (path === "/api/v1/groups/available" && req.method === "GET") {
      if (!user) return sendJson(res, 401, { code: 401, message: "unauthorized" });
      return envelope(res, 200, groups);
    }

    if (path === "/api/v1/keys" && req.method === "GET") {
      if (!user) return sendJson(res, 401, { code: 401, message: "unauthorized" });
      const mine = keys.filter((entry) => entry.user_id === user.id);
      return envelope(res, 200, { items: mine, total: mine.length, page: 1, page_size: 100 });
    }

    if (path === "/api/v1/keys" && req.method === "POST") {
      if (!user) return sendJson(res, 401, { code: 401, message: "unauthorized" });
      const record = {
        id: nextKeyId++,
        user_id: user.id,
        key: `sk-fake-${Math.random().toString(36).slice(2, 12)}`,
        name: String(body.name ?? ""),
        group_id: body.group_id ?? null,
        status: "active",
      };
      keys.push(record);
      hooks.onKeyCreated?.(record.key);
      return envelope(res, 200, record);
    }

    if (path.startsWith("/api/v1/keys/") && req.method === "DELETE") {
      if (!user) return sendJson(res, 401, { code: 401, message: "unauthorized" });
      const id = Number(path.split("/").pop());
      const index = keys.findIndex((entry) => entry.id === id && entry.user_id === user.id);
      if (index >= 0) keys.splice(index, 1);
      return envelope(res, 200, { message: "deleted" });
    }

    if (path === "/api/v1/subscriptions/summary" && req.method === "GET") {
      if (!user) return sendJson(res, 401, { code: 401, message: "unauthorized" });
      return envelope(res, 200, { active_count: 0, subscriptions: [] });
    }

    if (path === "/api/v1/usage/dashboard/stats" && req.method === "GET") {
      if (!user) return sendJson(res, 401, { code: 401, message: "unauthorized" });
      return envelope(res, 200, { total_cost: 0, total_requests: 0 });
    }

    if (path === "/api/v1/redeem" && req.method === "POST") {
      if (!user) return sendJson(res, 401, { code: 401, message: "unauthorized" });
      if (body.code !== "GIFT") return sendJson(res, 400, { code: 400, message: "invalid code" });
      user.balance += 5;
      return envelope(res, 200, { type: "balance", value: 5, new_balance: user.balance });
    }

    if (path === "/api/v1/announcements" && req.method === "GET") {
      if (!user) return sendJson(res, 401, { code: 401, message: "unauthorized" });
      return envelope(res, 200, [{ id: 1, title: "测试公告" }]);
    }

    // ---- model gateway ----

    if (path === "/v1/models" && req.method === "GET") {
      const key = keys.find((entry) => entry.key === token);
      if (!key) return sendJson(res, 401, { error: { message: "API_KEY_REQUIRED" } });
      // The real gateway gates the catalog on balance: a fresh account answers
      // 403 INSUFFICIENT_BALANCE until it is credited. The fake reproduces it,
      // because that gate is the whole reason the picker starts empty.
      const owner = [...users.values()].find((candidate) => candidate.id === key.user_id);
      if (owner && owner.balance <= 0) {
        return sendJson(res, 403, { code: "INSUFFICIENT_BALANCE", message: "Insufficient account balance" });
      }
      return sendJson(res, 200, {
        object: "list",
        data: [
          { id: "glm-5.2", object: "model", owned_by: "zhipu", context_length: 200000 },
          { id: "kimi-k3", object: "model", owned_by: "moonshot", context_length: 256000 },
          // The live gateway declares nothing; this one exercises the measured
          // table the same way, since upstream wins when it does declare.
          { id: "deepseek-v4.1-flash", object: "model", owned_by: "deepseek" },
          { id: "gpt-5.6-vision", object: "model", owned_by: "openai", capabilities: { vision: true } },
        ],
      });
    }

    if (path === "/v1/sub2api/billing" && req.method === "GET") {
      const key = keys.find((entry) => entry.key === token);
      if (!key) return sendJson(res, 401, { error: { message: "API_KEY_REQUIRED" } });
      return sendJson(res, 200, { balance: user?.balance ?? 0, quota: 0, quota_used: 0 });
    }

    if (path === "/v1/chat/completions" && req.method === "POST") {
      const key = keys.find((entry) => entry.key === token);
      if (!key) return sendJson(res, 401, { error: { message: "API_KEY_REQUIRED" } });
      hooks.onChatBody?.(body);

      // A model that refuses oversized prompts, the way every upstream does:
      // that rejection is how the plugin measures a context window.
      if (typeof hooks.contextLimit === "number") {
        let chars = 0;
        for (const message of Array.isArray(body?.messages) ? body.messages : []) {
          chars += typeof message?.content === "string" ? message.content.length : 0;
        }
        const tokens = Math.ceil(chars / 2);
        if (tokens > hooks.contextLimit) {
          return sendJson(res, 400, {
            error: {
              message: `This model's maximum context length is ${hooks.contextLimit} tokens; the prompt has ${tokens} tokens`,
              type: "invalid_request_error",
            },
          });
        }
      }

      // Simulate a dropped connection: the socket dies before any response,
      // which is exactly what the transport reports as TRANSPORT.
      if (hooks.dropChatTimes > 0) {
        hooks.dropChatTimes -= 1;
        // Destroying the response (not the request) makes the client observe a
        // socket error promptly; destroying the request leaves undici waiting.
        res.destroy();
        return undefined;
      }

      // The openresty in front of the gateway answers this while the Go backend
      // restarts, which is the second failure the plugin has to absorb.
      if (hooks.proxyTimeoutTimes > 0) {
        hooks.proxyTimeoutTimes -= 1;
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: { type: "upstream_error", message: "acp-proxy failure: connect-timeout UND_ERR_CONNECT_TIMEOUT <private-host>" },
        }));
        return undefined;
      }

      if (hooks.upstream502Times > 0) {
        hooks.upstream502Times -= 1;
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { type: "upstream_error", message: "Upstream service temporarily unavailable" } }));
        return undefined;
      }

      if (hooks.gateway502Times > 0) {
        hooks.gateway502Times -= 1;
        res.writeHead(502, { "Content-Type": "text/html" });
        res.end("<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>openresty</center></body></html>");
        return undefined;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const chunk = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
      chunk({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "你好" }, finish_reason: null }] });
      chunk({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "，世界" }, finish_reason: null }] });
      chunk({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
      res.write("data: [DONE]\n\n");
      res.end();
      return undefined;
    }

    return sendJson(res, 404, { code: 404, message: "not found" });
  });

  function issueTokens(candidate) {
    candidate.token = `tok-${Math.random().toString(36).slice(2, 10)}`;
    candidate.refresh = `ref-${Math.random().toString(36).slice(2, 10)}`;
    return {
      access_token: candidate.token,
      refresh_token: candidate.refresh,
      expires_in: 3600,
      user: publicUser(candidate),
    };
  }

  function publicUser(candidate) {
    return {
      id: candidate.id,
      email: candidate.email,
      username: candidate.email.split("@")[0],
      balance: candidate.balance,
      allowed_groups: candidate.allowed_groups,
    };
  }

  return {
    server,
    keys,
    users,
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address();
      return `http://127.0.0.1:${port}`;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Fake pay centre. Mirrors the real one's contract: the embedded page needs
 * `user_id` + `token` (validated against sub2api) and the POST needs the CSRF
 * cookie echoed in `X-XSRF-TOKEN`.
 * @param {{sub2apiBase: string}} options
 */
export function startFakePayCenter(options) {
  let counter = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = url.pathname;
    const body = req.method === "POST" ? await readBody(req) : {};

    if (path === "/embedded/sub-recharge" && req.method === "GET") {
      const userId = url.searchParams.get("user_id") ?? "";
      const token = url.searchParams.get("token") ?? "";
      if (userId === "" || token === "") return sendHtml(res, 403, "缺少 Sub2API 用户上下文");

      const verified = await fetch(`${options.sub2apiBase}/api/v1/user/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
      if (!verified || !verified.ok) return sendHtml(res, 403, "Sub2API 用户校验失败。");
      const payload = await verified.json();
      if (String(payload?.data?.id) !== userId) return sendHtml(res, 403, "Sub2API 用户身份不匹配。");

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": [
          `XSRF-TOKEN=cookie-${counter}; Path=/`,
          `pay_center_session=sess-${counter}; Path=/; HttpOnly`,
        ],
      });
      res.end("<html><body><form method=post>充值</form></body></html>");
      return undefined;
    }

    if (path === "/embedded/sub-recharge" && req.method === "POST") {
      const xsrf = String(req.headers["x-xsrf-token"] ?? "");
      if (xsrf === "") return sendHtml(res, 419, "Page Expired");
      const userId = String(body.user_id ?? "");
      const token = String(body.token ?? "");
      if (userId === "" || token === "") return sendHtml(res, 403, "缺少 Sub2API 用户上下文");
      const amount = Number(body.amount_yuan);
      if (!Number.isFinite(amount) || amount <= 0) return sendHtml(res, 302, "bad amount");

      const orderNo = `SUB${String(++counter).padStart(6, "0")}`;
      res.writeHead(302, {
        Location: `/checkout/${orderNo}?expires=${Math.floor(Date.now() / 1000) + 1800}&token=sign-${orderNo}`,
      });
      res.end();
      return undefined;
    }

    if (path.startsWith("/checkout/") && path.endsWith("/status") && req.method === "GET") {
      const orderNo = path.split("/")[2];
      if (url.searchParams.get("token") === "") return sendJson(res, 403, { ok: false });
      return sendJson(res, 200, {
        ok: true,
        data: { status: "approved", delivery_status: "succeeded", message: "已确认到账", notice: "余额已入账" },
      });
    }

    return sendJson(res, 404, { ok: false });
  });

  return {
    server,
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address();
      return `http://127.0.0.1:${port}`;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** An in-memory stand-in for the host credential service, shaped like `CredentialProvider`. */
export function createFakeCredentials() {
  const refs = new Map();
  const records = new Map();
  return {
    async resolve(ref) {
      const value = refs.get(String(ref));
      return value === undefined ? undefined : { value, source: "memory" };
    },
    async describe(ref) {
      return { configured: refs.has(String(ref)), writable: true };
    },
    async set(ref, value) {
      if (!value) throw new Error("empty credential");
      refs.set(String(ref), value);
    },
    async unset(ref) {
      refs.delete(String(ref));
    },
    async readRecord(key) {
      return records.get(String(key));
    },
    async describeRecord(key) {
      const record = records.get(String(key));
      return { configured: record !== undefined, kind: record?.kind, writable: true };
    },
    async listRecords() {
      return [...records.entries()].map(([key, record]) => ({ key, kind: record.kind }));
    },
    async modifyRecord(key, mutate) {
      const next = await mutate(records.get(String(key)));
      if (next !== undefined) records.set(String(key), next);
      return records.get(String(key));
    },
    async deleteRecord(key) {
      records.delete(String(key));
    },
    // test helpers
    _refs: refs,
    _records: records,
  };
}

/** A minimal host context: only the services this plugin touches. */
export function createFakeHost() {
  const services = new Map();
  const registered = { providers: [], adapters: [], routes: [], tools: [], sections: [], discoveries: [], replaced: [], pending: [] };
  const disposers = [];
  /** Injection callbacks waiting for a service that has not been provided yet. */
  const pendingInjections = [];

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get(name) {
      const service = services.get(name);
      if (service === undefined) throw new Error(`unknown service ${name}`);
      return service;
    },
    has(name) {
      return services.has(name);
    },
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === "function") disposers.push(dispose);
      return dispose;
    },
    /**
     * Nested injection: run the callback once every named service exists.
     *
     * A service registered by a later plugin is the normal case — the real host
     * mounts `webServer` after the plugin that needs it — so a pending callback
     * has to run when the service finally appears.
     */
    inject(names, run) {
      const attempt = () => {
        if (!names.every((name) => services.has(name))) return false;
        run(ctx);
        return true;
      };
      if (!attempt()) {
        registered.pending.push(names.join(","));
        pendingInjections.push(attempt);
      }
      return () => {};
    },
    llm: {
      registerConfigurableProviders(entries) {
        if (this?.fail) throw new Error("DUPLICATE_PROVIDER: sub2api already registered");
        registered.providers.push(...entries);
        return () => {};
      },
      registerAdapter(providers, adapter) {
        if (this?.fail) throw new Error("DUPLICATE_ADAPTER: sub2api already registered");
        // The real handle is callable and carries `replace`, whose only job is
        // to publish llm/adapters-updated so the picker refetches.
        registered.adapters.push({ providers, adapter });
        const handle = () => {};
        handle.replace = (next) => registered.replaced.push(next);
        return handle;
      },
      registerModelDiscovery(ns, discover) {
        registered.discoveries.push({ ns, discover });
        return () => {};
      },
    },
    webServer: {
      register(route) {
        registered.routes.push(route);
        return () => {};
      },
    },
    tools: {
      register(tool) {
        registered.tools.push(tool);
        return () => {};
      },
    },
    systemPrompt: {
      section(section) {
        registered.sections.push(section);
        return () => {};
      },
    },
  };

  // The plugin reaches for these through `ctx.get(name)`, so they must be
  // addressable exactly like a real host's services.
  services.set("webServer", ctx.webServer);
  services.set("tools", ctx.tools);
  services.set("systemPrompt", ctx.systemPrompt);
  services.set("llm", ctx.llm);

  /** Provide a service after apply, as a later-loading plugin would. */
  function provide(name, service) {
    services.set(name, service);
    for (const attempt of [...pendingInjections]) {
      if (attempt()) pendingInjections.splice(pendingInjections.indexOf(attempt), 1);
    }
  }

  return { ctx, services, registered, disposers, provide };
}

/** Serve the plugin's own routes so the test can drive them over HTTP. */
export async function startRouteHarness(routes) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const route = routes.find((candidate) => candidate.path === url.pathname);
    if (!route) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no route" }));
      return;
    }
    await route.handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
