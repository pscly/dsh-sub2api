/**
 * The browser-facing API.
 *
 * The panel cannot call sub2api directly: the control plane lives on another
 * origin (CORS), the session token must never reach page scripts, and the pay
 * centre needs a CSRF handshake. Everything therefore goes through these
 * routes on the host.
 *
 * Every route refuses non-loopback callers. That is the only thing standing
 * between a token-bearing local HTTP surface and another process on the same
 * network, so it is applied by {@link defineRoute} rather than per handler.
 * @module dsh-sub2api/routes
 */

import { ROUTE_PREFIX } from "./constants.js";
import { buildRechargeLink, createRechargeOrder, describeOrderStatus, fetchOrderStatus } from "./pay.js";
import { loginOrRegister } from "./sub2api/auth.js";
import { provisionAccount } from "./sub2api/provision.js";
import { sessionFromAuth } from "./sub2api/session.js";
import {
  Sub2ApiError,
  isLoopbackRequest,
  maskSecret,
  readJsonBody,
  writeJson,
} from "./util.js";

/**
 * @param {object} deps
 * @param {import("./sub2api/api.js").Sub2ApiApi} deps.api
 * @param {import("./sub2api/session.js").SessionStore} deps.session
 * @param {import("./sub2api/catalog.js").ModelCatalog} deps.catalog
 * @param {() => any} deps.cfg resolved configuration, re-read per request
 * @param {() => any} deps.hostname
 * @param {(apiKey: string) => Promise<number>} deps.refreshCatalog
 * @param {{info: Function, warn: Function}} deps.logger
 * @returns {Array<{kind: "exact", path: string, handler: Function}>}
 */
export function makeRoutes(deps) {
  const { api, session, catalog, cfg, logger, panel, announceCatalog, version } = deps;

  /** Orders created by this process, keyed by the pay centre's order number. */
  const orders = new Map();

  /** When the last automatic catalog sync ran, so a poll cannot storm the gateway. */
  let autoRefreshAt = 0;

  /**
   * Re-sync the catalog when the panel has a reason to believe it changed.
   *
   * A top-up is the usual trigger and it usually happens on another site, so
   * nothing here can observe it directly: the balance is the only signal. Once
   * it is positive and the catalog is still empty, the gate `/v1/models`
   * enforces is open, and the picker should fill without the user pressing
   * anything. A stale snapshot is refreshed on the same path.
   * @param {number} balance reported account balance, NaN when unknown
   */
  async function refreshCatalogIfNeeded(balance) {
    const now = Date.now();
    if (now - autoRefreshAt < 15000) return;
    if (catalog.inflight !== undefined) return;

    // Back off after a failure: a group with no models would otherwise be
    // retried on every poll, and the answer will not change within seconds.
    // A balance rejection is excluded — funding the account changes the answer
    // immediately, and that is exactly the case this path exists for.
    const blockedByBalance = catalog.lastError?.code === "INSUFFICIENT_BALANCE";
    const failedAt = catalog.lastError?.at;
    if (!blockedByBalance && typeof failedAt === "number" && now - failedAt < 120000) return;

    const empty = catalog.visible().length === 0;
    const funded = Number.isFinite(balance) && balance > 0;
    if (empty ? !funded : !catalog.stale) return;

    autoRefreshAt = now;
    try {
      await catalog.refresh();
      announceCatalog?.();
    } catch {
      // The failure is recorded on the catalog and shown by the panel.
    }
  }

  /** Assemble the panel's view of the world. */
  async function status() {
    const stored = await session.read();
    const apiKey = await session.apiKey();
    await catalog.load();

    // Balance first: it decides whether a model sync can succeed at all.
    let profile;
    if (stored !== undefined) {
      const token = await session.accessToken().catch(() => undefined);
      if (token !== undefined) profile = await safe(() => api.profile(token));
    }
    await refreshCatalogIfNeeded(Number(profile?.balance));

    /** @type {Record<string, unknown>} */
    const view = {
      apiBase: cfg().apiBase,
      payBase: cfg().payBase,
      keyName: cfg().keyName,
      loggedIn: stored !== undefined,
      email: stored?.email ?? stored?.user?.email ?? null,
      user: stored?.user ?? null,
      hasKey: typeof apiKey === "string" && apiKey !== "",
      keyMasked: maskSecret(apiKey),
      models: catalog.snapshot(),
      panel: panel.snapshot(),
      rechargeMultiplier: cfg().rechargeMultiplier,
      currency: "CNY",
      version: version ?? "unknown",
      showSidebarQuota: cfg().showSidebarQuota,
    };

    if (stored !== undefined) {
      const token = await session.accessToken().catch(() => undefined);
      if (token !== undefined) {
        const [subscriptions, usage] = await Promise.all([
          safe(() => api.subscriptionSummary(token)),
          safe(() => api.usageDashboardStats(token)),
        ]);
        view.subscriptions = subscriptions ?? null;
        view.usage = usage ?? null;
      }
      view.profile = profile ?? null;
    }
    return view;
  }

  return [
    defineRoute("GET", `${ROUTE_PREFIX}/status`, async () => status()),

    /**
     * One form, two outcomes: log in, or register when the address is new.
     * Provisioning runs before the response so the panel can render the final
     * state in a single round trip.
     */
    defineRoute("POST", `${ROUTE_PREFIX}/auth`, async (body) => {
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      const promoCode = String(body?.promoCode ?? "").trim();
      const allowRegister = body?.allowRegister !== false;

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new Sub2ApiError("请输入有效的邮箱地址", { code: "invalid_email" });
      }
      if (password.length < 6) {
        throw new Sub2ApiError("密码至少 6 位", { code: "invalid_password" });
      }

      const { mode, auth } = await loginOrRegister({ api, email, password, promoCode, allowRegister });
      const record = sessionFromAuth(auth, email);
      await session.write(record);

      const provisioned = await provisionAccount({
        api,
        accessToken: auth.access_token,
        keyName: cfg().keyName,
        groupId: cfg().groupId,
        saveApiKey: (key) => session.setApiKey(key),
        refreshCatalog: (key) => deps.refreshCatalog(key),
        logger,
      });

      logger.info?.(`[sub2api] ${mode === "register" ? "注册" : "登录"}成功：${email}`);
      return { mode, steps: provisioned.steps, ready: provisioned.ready, state: await status() };
    }),

    defineRoute("POST", `${ROUTE_PREFIX}/logout`, async () => {
      await session.clear();
      orders.clear();
      return { ok: true, state: await status() };
    }),

    /**
     * Create the key this plugin owns, or hand back the one that already
     * carries its name. `force` skips the reuse and rotates the secret, which
     * is what the panel's 「重建密钥」 button asks for.
     */
    defineRoute("POST", `${ROUTE_PREFIX}/key`, async (body) => {
      const token = await session.accessToken();
      const groupId = typeof body?.groupId === "number" ? body.groupId : cfg().groupId;
      const groups = await safe(() => api.groups(token));

      const listed = await safe(() => api.listKeys(token));
      const existing = (listed?.items ?? []).find(
        (entry) => entry?.name === cfg().keyName && entry.status !== "inactive",
      );

      if (existing && body?.force !== true && typeof existing.key === "string") {
        await session.setApiKey(existing.key);
        const models = await deps.refreshCatalog(existing.key).catch(() => 0);
        return {
          ok: true,
          reused: true,
          keyMasked: maskSecret(existing.key),
          groupId: existing.group_id ?? null,
          groups: Array.isArray(groups) ? groups : [],
          models,
          state: await status(),
        };
      }

      const created = await api.createKey(token, { name: cfg().keyName, groupId });
      if (typeof created?.key !== "string" || created.key === "") {
        throw new Sub2ApiError("服务器没有返回密钥值", { code: "key_missing" });
      }
      await session.setApiKey(created.key);

      // Rotate rather than accumulate: the old key is only removed once the new
      // one is safely stored.
      if (existing && body?.force === true && typeof existing.id === "number") {
        await safe(() => api.deleteKey(token, existing.id));
      }

      const models = await deps.refreshCatalog(created.key).catch(() => 0);

      return {
        ok: true,
        reused: false,
        keyMasked: maskSecret(created.key),
        groupId: created.group_id ?? groupId ?? null,
        groups: Array.isArray(groups) ? groups : [],
        models,
        state: await status(),
      };
    }),

    /** One-shot plaintext reveal for the copy button; loopback only, never cached. */
    defineRoute("POST", `${ROUTE_PREFIX}/key/reveal`, async () => {
      const apiKey = await session.apiKey();
      if (apiKey === undefined) throw new Sub2ApiError("还没有可用的密钥", { code: "no_api_key" });
      return { key: apiKey };
    }),

    /** Re-read the account snapshot without a full login. */
    defineRoute("GET", `${ROUTE_PREFIX}/profile`, async () => {
      const token = await session.accessToken();
      const [profile, groups, subscriptions, usage] = await Promise.all([
        safe(() => api.profile(token)),
        safe(() => api.groups(token)),
        safe(() => api.subscriptionSummary(token)),
        safe(() => api.usageDashboardStats(token)),
      ]);
      return { profile: profile ?? null, groups: groups ?? [], subscriptions: subscriptions ?? null, usage: usage ?? null };
    }),

    defineRoute("GET", `${ROUTE_PREFIX}/models`, async () => {
      await catalog.load();
      return catalog.snapshot();
    }),

    defineRoute("POST", `${ROUTE_PREFIX}/models/refresh`, async () => {
      let count = 0;
      let error;
      try {
        count = await catalog.refresh();
      } catch (failure) {
        // A refresh failure is data the panel shows, not an HTTP error: the
        // usual case is a zero-balance account, which is expected, not a fault.
        error = {
          code: failure instanceof Sub2ApiError ? failure.code : undefined,
          message: failure instanceof Error ? failure.message : String(failure),
          status: failure instanceof Sub2ApiError ? failure.status : undefined,
        };
      }
      if (error === undefined) announceCatalog?.();
      return { ok: error === undefined, count, error: error ?? null, models: catalog.snapshot() };
    }),

    /** Save which models the picker offers. An empty list restores "show all". */
    defineRoute("POST", `${ROUTE_PREFIX}/models/visible`, async (body) => {
      const ids = Array.isArray(body?.ids) ? body.ids.map((id) => String(id)) : [];
      const known = new Set(catalog.snapshot().all.map((model) => model.id));
      const unknown = ids.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new Sub2ApiError(`这些模型不在当前目录里：${unknown.slice(0, 3).join("、")}`, {
          code: "unknown_model",
        });
      }
      await panel.setVisible(ids);
      announceCatalog?.();
      return { ok: true, ids, models: catalog.snapshot() };
    }),

    /** Correct one model's capacity, or clear the correction with null. */
    defineRoute("POST", `${ROUTE_PREFIX}/models/context`, async (body) => {
      const id = String(body?.id ?? "").trim();
      if (id === "") throw new Sub2ApiError("缺少模型 id", { code: "invalid_model" });

      const known = catalog.snapshot().all.some((model) => model.id === id);
      if (!known) throw new Sub2ApiError(`未知模型：${id}`, { code: "unknown_model" });

      let value = body?.contextWindow;
      if (value === null || value === undefined || value === "") {
        value = null;
      } else {
        value = Number(value);
        if (!Number.isFinite(value) || value < 1000) {
          throw new Sub2ApiError("上下文窗口至少 1000 tokens", { code: "invalid_context" });
        }
      }

      await panel.setContextOverride(id, value);
      announceCatalog?.();
      return { ok: true, overrides: panel.contextOverrides(), models: catalog.snapshot() };
    }),

    /**
     * One checklist that names what is actually wrong, instead of leaving the
     * user to guess from three separate cards.
     */
    defineRoute("GET", `${ROUTE_PREFIX}/diagnose`, async () => {
      const checks = [];
      const add = (id, label, ok, detail, tone) => {
        const entry = { id, label, ok };
        if (detail !== undefined) entry.detail = detail;
        if (tone !== undefined) entry.tone = tone;
        checks.push(entry);
      };

      const stored = await session.read();
      add("login", "登录状态", stored !== undefined, stored?.email ?? "未登录");

      const token = stored === undefined ? undefined : await session.accessToken().catch(() => undefined);
      add("token", "访问令牌", typeof token === "string", token ? "有效" : "无法获取");

      const apiKey = await session.apiKey();
      add("key", "API 密钥", typeof apiKey === "string" && apiKey !== "", apiKey ? maskSecret(apiKey) : "未创建");

      if (token) {
        const profile = await safe(() => api.profile(token));
        const balance = Number(profile?.balance);
        add(
          "profile",
          "账号资料",
          profile !== undefined,
          profile === undefined ? "读取失败" : `余额 ¥${Number.isFinite(balance) ? balance.toFixed(2) : "?"}`,
        );
        add(
          "balance",
          "余额",
          Number.isFinite(balance) && balance > 0,
          Number.isFinite(balance) ? String(balance) : "未知",
          Number.isFinite(balance) && balance > 0 ? undefined : "warn",
        );
      }

      if (typeof apiKey === "string" && apiKey !== "") {
        const billing = await safe(() => api.gatewayBilling(apiKey));
        const ungrouped = billing === undefined;
        add(
          "group",
          "密钥分组",
          !ungrouped,
          ungrouped ? "网关拒绝了该密钥（可能未绑分组或已失效）" : "已绑定分组",
          ungrouped ? "warn" : undefined,
        );

        const models = await safe(() => catalog.refresh(apiKey));
        if (models === undefined) {
          const error = catalog.lastError;
          add("catalog", "模型目录", false, error?.message ?? "同步失败", "warn");
        } else {
          add("catalog", "模型目录", models > 0, `${models} 个模型`);
        }
      }

      const failing = checks.filter((check) => !check.ok);
      return {
        checks,
        ok: failing.length === 0,
        summary: failing.length === 0 ? "一切正常" : `${failing.length} 项需要处理`,
      };
    }),

    /** Recharge level 1: a signed-in URL the browser opens in a new tab. */
    defineRoute("POST", `${ROUTE_PREFIX}/recharge/link`, async (body) => {
      const stored = await session.read();
      const token = await session.accessToken();
      const userId = stored?.user?.id;
      if (userId === undefined || userId === null) {
        throw new Sub2ApiError("登录信息缺少用户 ID，请重新登录", { code: "no_user_id" });
      }
      const url = buildRechargeLink({
        payBase: cfg().payBase,
        userId,
        token,
        theme: body?.theme === "dark" ? "dark" : "light",
        lang: "zh",
        srcHost: "dsh",
      });
      return { url };
    }),

    /** Recharge level 2: choose the amount here and land straight on checkout. */
    defineRoute("POST", `${ROUTE_PREFIX}/recharge`, async (body) => {
      const stored = await session.read();
      const token = await session.accessToken();
      const userId = stored?.user?.id;
      if (userId === undefined || userId === null) {
        throw new Sub2ApiError("登录信息缺少用户 ID，请重新登录", { code: "no_user_id" });
      }

      const order = await createRechargeOrder({
        payBase: cfg().payBase,
        userId,
        token,
        amountYuan: Number(body?.amountYuan),
        theme: body?.theme === "dark" ? "dark" : "light",
        timeoutMs: cfg().requestTimeoutMs,
      });

      orders.set(order.orderNo, {
        expires: order.expires,
        checkoutToken: order.checkoutToken,
        createdAt: Date.now(),
      });
      // 30 minutes is the pay centre's own order lifetime; anything older is noise.
      for (const [key, value] of orders) {
        if (Date.now() - value.createdAt > 40 * 60 * 1000) orders.delete(key);
      }

      return {
        checkoutUrl: order.checkoutUrl,
        orderNo: order.orderNo,
        multiplier: cfg().rechargeMultiplier,
      };
    }),

    defineRoute("POST", `${ROUTE_PREFIX}/recharge/status`, async (body) => {
      const orderNo = String(body?.orderNo ?? "");
      const known = orders.get(orderNo);
      if (known === undefined) {
        throw new Sub2ApiError("订单不存在或已过期", { code: "order_gone" });
      }
      const data = await fetchOrderStatus({
        payBase: cfg().payBase,
        orderNo,
        expires: known.expires,
        checkoutToken: known.checkoutToken,
        timeoutMs: cfg().requestTimeoutMs,
      });
      const status = describeOrderStatus(data);
      if (status.tone === "done") {
        // The order is settled; stop tracking it and let the panel refresh.
        orders.delete(orderNo);
        const token = await session.accessToken().catch(() => undefined);
        const profile = token ? await safe(() => api.profile(token)) : undefined;
        // Money just landed, which is what unblocks `/v1/models` on a fresh
        // account, so try the catalog now instead of waiting for the TTL.
        let models;
        try {
          models = { count: await catalog.refresh() };
        } catch (failure) {
          models = {
            count: 0,
            error: failure instanceof Error ? failure.message : String(failure),
          };
        }
        return { ...status, raw: data, profile: profile ?? null, models };
      }
      if (status.tone === "error") orders.delete(orderNo);
      return { ...status, raw: data };
    }),

    defineRoute("POST", `${ROUTE_PREFIX}/redeem`, async (body) => {
      const code = String(body?.code ?? "").trim();
      if (code === "") throw new Sub2ApiError("请输入兑换码", { code: "invalid_code" });
      const token = await session.accessToken();
      const result = await api.redeem(token, code);
      const profile = await safe(() => api.profile(token));
      return { ok: true, result, profile: profile ?? null };
    }),

    defineRoute("GET", `${ROUTE_PREFIX}/announcements`, async () => {
      const token = await session.accessToken().catch(() => undefined);
      if (token === undefined) return { items: [] };
      const items = await safe(() => api.announcements(token));
      return { items: Array.isArray(items) ? items : [] };
    }),
  ];
}

/**
 * Wrap one route with the method guard, the loopback guard and error
 * translation. Keeping this in one place is what stops a new route from
 * shipping without the check.
 */
function defineRoute(method, path, handler) {
  return {
    kind: "exact",
    path,
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { ok: false, error: "forbidden: loopback-only" });
        return;
      }
      if ((req.method ?? "GET").toUpperCase() !== method) {
        writeJson(res, 405, { ok: false, error: `method not allowed: ${req.method}` });
        return;
      }

      let body;
      if (method !== "GET") {
        body = await readJsonBody(req);
        if (body === undefined) {
          writeJson(res, 400, { ok: false, error: "invalid JSON body" });
          return;
        }
      }

      try {
        writeJson(res, 200, { ok: true, data: await handler(body ?? {}, req) });
      } catch (error) {
        if (error instanceof Sub2ApiError) {
          writeJson(res, error.status && error.status >= 400 ? error.status : 400, {
            ok: false,
            error: error.message,
            code: error.code,
          });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        writeJson(res, 500, { ok: false, error: message });
      }
    },
  };
}

/** Run one optional read, mapping a failure to `undefined` instead of rejecting. */
async function safe(run) {
  try {
    return await run();
  } catch {
    return undefined;
  }
}
