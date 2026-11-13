window.__ModuleLoader__.load({
  id: "dsh-sub2api",
  factory: (require) => {
    const react = require("react");
    var module = { exports: {} };
    var exports = module.exports;
    const h = react.createElement;
    const { useCallback, useEffect, useRef, useState } = react;

    // ---------------------------------------------------------------- api

    const PREFIX = "/api/sub2api";

    class ApiError extends Error {}

    async function call(path, options) {
      const init = { method: options?.method ?? "GET", headers: {} };
      if (options?.body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(options.body);
      }
      let response;
      try {
        response = await fetch(PREFIX + path, init);
      } catch (error) {
        throw new ApiError("网络请求失败：" + String(error && error.message ? error.message : error));
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new ApiError("HTTP " + response.status + "：响应不是 JSON");
      }
      if (!payload || payload.ok !== true) {
        throw new ApiError(payload && payload.error ? payload.error : "HTTP " + response.status);
      }
      return payload.data;
    }

    // -------------------------------------------------------------- theme

    const T = {
      card: {
        border: "0.5px solid var(--dsw-alias-border-l3, #d8dbe0)",
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        background: "var(--dsw-alias-bg-layer-1, transparent)",
      },
      head: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
      title: { fontSize: 14, fontWeight: 500, lineHeight: "22px", margin: 0 },
      hint: { fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-tertiary, #8a8f98)" },
      label: { fontSize: 13, fontWeight: 500, lineHeight: "20px" },
      row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
      input: {
        flex: "1 1 180px",
        minWidth: 140,
        height: 34,
        padding: "0 10px",
        borderRadius: 8,
        border: "0.5px solid var(--dsw-alias-border-l3, #d8dbe0)",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #111)",
        fontSize: 13,
        outline: "none",
      },
      button: {
        height: 34,
        padding: "0 14px",
        borderRadius: 8,
        border: "0.5px solid var(--dsw-alias-border-l3, #d8dbe0)",
        background: "var(--dsw-alias-bg-layer-2, #f4f5f7)",
        color: "var(--dsw-alias-label-primary, #111)",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
      },
      primary: {
        height: 34,
        padding: "0 16px",
        borderRadius: 8,
        border: "none",
        background: "var(--dsw-alias-state-business-primary, #2563eb)",
        color: "#fff",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
      },
      chip: {
        height: 30,
        minWidth: 52,
        padding: "0 10px",
        borderRadius: 999,
        border: "0.5px solid var(--dsw-alias-border-l3, #d8dbe0)",
        background: "transparent",
        color: "var(--dsw-alias-label-primary, #111)",
        fontSize: 13,
        cursor: "pointer",
      },
      chipOn: {
        height: 30,
        minWidth: 52,
        padding: "0 10px",
        borderRadius: 999,
        border: "0.5px solid var(--dsw-alias-state-business-primary, #2563eb)",
        background: "var(--dsw-alias-state-business-primary, #2563eb)",
        color: "#fff",
        fontSize: 13,
        cursor: "pointer",
      },
      ok: { color: "var(--dsw-alias-state-success-primary, #16a34a)" },
      bad: { color: "var(--dsw-alias-state-error-primary, #dc2626)" },
      mono: { fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
    };

    function Button(props) {
      const { variant, children, ...rest } = props;
      return h("button", { style: variant === "primary" ? T.primary : T.button, ...rest }, children);
    }

    function Card(props) {
      return h(
        "div",
        { style: T.card },
        props.title
          ? h("div", { style: T.head }, h("h4", { style: T.title }, props.title), props.aside ?? null)
          : null,
        props.children,
      );
    }

    function Field(props) {
      return h("label", { style: { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 180px" } },
        h("span", { style: T.label }, props.label),
        props.children,
      );
    }

    function money(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return "—";
      return "$" + n.toFixed(2);
    }

    // ---------------------------------------------------------- account

    function ProvisionReport({ steps }) {
      if (!Array.isArray(steps) || steps.length === 0) return null;
      const failed = steps.filter((step) => !step.ok);
      if (failed.length === 0) return null;
      return h("div", {
        style: {
          marginTop: 10,
          padding: 10,
          borderRadius: 12,
          background: "var(--dsw-alias-bg-layer-2, #f4f5f7)",
        },
      },
        h("div", { style: { ...T.label, color: "var(--dsw-alias-state-error-primary, #dc2626)" } }, "开通未完全成功"),
        failed.map((step) =>
          h("div", { key: step.id, style: { ...T.hint, marginTop: 4 } },
            `${step.label}：${step.error || "失败"}`),
        ),
      );
    }

    function AccountCard({ state, busy, onAuth, onLogout, steps }) {
      const [email, setEmail] = useState("");
      const [password, setPassword] = useState("");
      const [promo, setPromo] = useState("");
      const [showPromo, setShowPromo] = useState(false);
      const [error, setError] = useState("");

      const submit = useCallback(async () => {
        setError("");
        try {
          await onAuth({ email, password, promoCode: promo.trim(), allowRegister: true });
          setPassword("");
          setPromo("");
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }, [email, password, promo, onAuth]);

      if (state.loggedIn) {
        const user = state.user || {};
        return h(Card, {
          title: "账户",
          aside: h("span", { style: T.hint }, state.apiBase),
        },
          h("div", { style: T.row },
            h("span", { style: { fontSize: 14, fontWeight: 500 } }, state.email || user.email || "已登录"),
            h("span", { style: T.hint }, "余额 "),
            h("span", { style: { fontSize: 14, fontWeight: 500 } }, money(state.profile && state.profile.balance)),
            h("span", { style: { flex: 1 } }),
            h(Button, { onClick: onLogout, disabled: busy }, "退出登录"),
          ),
          state.subscriptions && Array.isArray(state.subscriptions.subscriptions) && state.subscriptions.subscriptions.length > 0
            ? h("div", { style: { ...T.hint, marginTop: 8 } },
                state.subscriptions.subscriptions
                  .map((s) => `${s.group_name || "订阅"}（剩余 ${s.days_remaining ?? "?"} 天）`)
                  .join("；"))
            : null,
          h(ProvisionReport, { steps }),
        );
      }

      return h(Card, { title: "登录 / 注册", aside: h("span", { style: T.hint }, state.apiBase) },
        h("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
          h(Field, { label: "邮箱" },
            h("input", {
              style: T.input,
              type: "email",
              autoComplete: "username",
              placeholder: "you@example.com",
              value: email,
              onChange: (e) => setEmail(e.target.value),
            }),
          ),
          h(Field, { label: "密码" },
            h("input", {
              style: T.input,
              type: "password",
              autoComplete: "current-password",
              placeholder: "至少 6 位",
              value: password,
              onChange: (e) => setPassword(e.target.value),
              onKeyDown: (e) => { if (e.key === "Enter") submit(); },
            }),
          ),
        ),
        h("div", { style: { ...T.row, marginTop: 10 } },
          h(Button, { variant: "primary", onClick: submit, disabled: busy || !email || password.length < 6 },
            busy ? "处理中…" : "继续"),
          h(Button, { onClick: () => setShowPromo((v) => !v) }, showPromo ? "收起优惠码" : "有优惠码"),
          showPromo
            ? h("input", {
                style: { ...T.input, flex: "0 1 200px" },
                placeholder: "优惠码（可选）",
                value: promo,
                onChange: (e) => setPromo(e.target.value),
              })
            : null,
        ),
        h("div", { style: { ...T.hint, marginTop: 8 } },
          "没有账号会直接注册，注册成功即自动创建名为 ", h("code", { style: T.mono }, state.keyName || "dsh"), " 的密钥并同步上游模型。"),
        error ? h("div", { style: { ...T.bad, fontSize: 13, marginTop: 8 } }, error) : null,
        h(ProvisionReport, { steps }),
      );
    }

    // -------------------------------------------------------------- key

    function KeyCard({ state, busy, onCreate, onReveal }) {
      const [revealed, setRevealed] = useState("");
      const [copied, setCopied] = useState(false);

      const reveal = async () => {
        try {
          const data = await onReveal();
          setRevealed(data.key);
        } catch (e) {
          setRevealed("");
        }
      };

      const copy = async () => {
        try {
          // `setRevealed` is async, so the value must come from the response,
          // not from the state this closure captured.
          const text = revealed || (await onReveal()).key;
          setRevealed(text);
          if (text) await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard may be blocked; the value is still shown once revealed.
        }
      };

      return h(Card, { title: "API 密钥" },
        h("div", { style: T.row },
          h("code", { style: { ...T.mono, padding: "4px 8px", borderRadius: 6, background: "var(--dsw-alias-bg-layer-2, #f4f5f7)" } },
            revealed || state.keyMasked || "尚未创建"),
          h(Button, { onClick: copy, disabled: !state.loggedIn }, copied ? "已复制" : "复制"),
          h(Button, { onClick: onCreate, disabled: busy || !state.loggedIn }, state.hasKey ? "重建密钥" : "一键创建"),
        ),
        h("div", { style: { ...T.hint, marginTop: 8 } },
          "密钥名称固定为 ", h("code", { style: T.mono }, state.keyName || "dsh"),
          "，保存在本机凭据库；页面只显示掩码，点「复制」才会临时取回明文。"),
      );
    }

    // --------------------------------------------------------- recharge

    const PRESETS = [10, 20, 50, 100];

    function RechargeCard({ state, busy, onRecharge, onPoll, onRefresh }) {
      const [amount, setAmount] = useState(20);
      const [custom, setCustom] = useState("");
      const [order, setOrder] = useState(null);
      const [status, setStatus] = useState(null);
      const [error, setError] = useState("");
      const timer = useRef(null);

      const value = custom !== "" ? Number(custom) : amount;
      const credit = Number.isFinite(value) ? value * 2 : 0;

      useEffect(() => {
        if (!order) return undefined;
        timer.current = setInterval(async () => {
          try {
            const result = await onPoll(order.orderNo);
            setStatus(result);
            if (result.tone === "done" || result.tone === "error") {
              clearInterval(timer.current);
              timer.current = null;
              if (result.tone === "done") await onRefresh();
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            clearInterval(timer.current);
            timer.current = null;
          }
        }, 5000);
        return () => { if (timer.current) clearInterval(timer.current); };
      }, [order, onPoll, onRefresh]);

      const start = async () => {
        setError("");
        // Reserve the tab on the click itself: a window opened after an await
        // is treated as a popup and blocked by most browsers.
        const tab = window.open("", "_blank");
        try {
          const data = await onRecharge(value);
          const target = data.checkoutUrl || data.url;
          if (tab) tab.location.href = target;
          else window.open(target, "_blank", "noopener");
          if (data.orderNo) setOrder(data);
        } catch (e) {
          if (tab) tab.close();
          setError(e instanceof Error ? e.message : String(e));
        }
      };

      return h(Card, { title: "余额与充值" },
        h("div", { style: { ...T.row, marginBottom: 10 } },
          h("span", { style: T.label }, "当前余额"),
          h("span", { style: { fontSize: 18, fontWeight: 600 } }, money(state.profile && state.profile.balance)),
          h("span", { style: T.hint }, "到账比例 1 元 = 2.00 美元额度"),
        ),
        h("div", { style: { ...T.row, marginBottom: 10 } },
          PRESETS.map((preset) =>
            h("button", {
              key: preset,
              style: custom === "" && amount === preset ? T.chipOn : T.chip,
              onClick: () => { setAmount(preset); setCustom(""); },
            }, "¥" + preset),
          ),
          h("input", {
            style: { ...T.input, flex: "0 1 120px", minWidth: 90 },
            placeholder: "自定义",
            inputMode: "decimal",
            value: custom,
            onChange: (e) => setCustom(e.target.value.replace(/[^0-9.]/g, "")),
          }),
        ),
        h("div", { style: { ...T.row, marginBottom: 10 } },
          h("span", { style: T.hint }, "预计到账"),
          h("span", { style: { fontSize: 14, fontWeight: 500 } }, money(credit)),
          h("span", { style: { flex: 1 } }),
          h(Button, {
            variant: "primary",
            onClick: start,
            disabled: busy || !state.loggedIn || !Number.isFinite(value) || value <= 0,
          }, "去支付"),
          h(Button, { onClick: onRefresh, disabled: !state.loggedIn }, "刷新余额"),
        ),
        h("div", { style: T.hint },
          "点「去支付」会在新标签页打开支付页。付款后需管理员人工核账，通常几分钟内到账；订单 30 分钟内有效。"),
        order
          ? h("div", { style: { marginTop: 10, padding: 10, borderRadius: 12, background: "var(--dsw-alias-bg-layer-2, #f4f5f7)" } },
              h("div", { style: T.label }, "订单 " + order.orderNo),
              h("div", {
                style: {
                  ...T.hint,
                  marginTop: 4,
                  ...(status && status.tone === "done" ? T.ok : {}),
                  ...(status && status.tone === "error" ? T.bad : {}),
                },
              }, status ? status.text : "已打开支付页，等待付款…"),
              status && status.detail ? h("div", { style: { ...T.hint, marginTop: 2 } }, status.detail) : null,
            )
          : null,
        error ? h("div", { style: { ...T.bad, fontSize: 13, marginTop: 8 } }, error) : null,
      );
    }

    // ------------------------------------------------------------ models

    function ModelsCard({ state, busy, onRefreshModels }) {
      const models = state.models || { models: [], fetchedAt: 0, stale: false };
      const [open, setOpen] = useState(false);
      const list = models.models || [];

      return h(Card, { title: "模型",
        aside: h("span", { style: T.hint },
          `${list.length} 个 · ${models.fetchedAt ? new Date(models.fetchedAt).toLocaleTimeString() : "未同步"}`),
      },
        h("div", { style: T.row },
          h(Button, { onClick: onRefreshModels, disabled: busy || !state.loggedIn }, "刷新模型"),
          h(Button, { onClick: () => setOpen((v) => !v), disabled: list.length === 0 }, open ? "收起列表" : "查看列表"),
          models.stale ? h("span", { style: T.hint }, "缓存已过期") : null,
        ),
        open
          ? h("div", { style: { marginTop: 10, maxHeight: 220, overflow: "auto" } },
              list.map((model) =>
                h("div", { key: model.id, style: { display: "flex", gap: 8, padding: "4px 0", alignItems: "baseline" } },
                  h("code", { style: { ...T.mono, flex: "1 1 auto" } }, model.id),
                  model.contextWindow ? h("span", { style: T.hint }, Math.round(model.contextWindow / 1000) + "k") : null,
                  model.vision ? h("span", { style: T.hint }, "图片") : null,
                ),
              ))
          : null,
        h("div", { style: { ...T.hint, marginTop: 8 } },
          "目录来自上游 /v1/models，登录后自动同步，10 分钟内不重复拉取。"),
      );
    }

    // ------------------------------------------------------------- root

    function Section() {
      const [state, setState] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [steps, setSteps] = useState(null);

      const refresh = useCallback(async () => {
        try {
          const data = await call("/status");
          setState(data);
          setError("");
          return data;
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          return null;
        }
      }, []);

      useEffect(() => { refresh(); }, [refresh]);

      const wrap = useCallback(async (fn) => {
        setBusy(true);
        setError("");
        try {
          return await fn();
        } finally {
          setBusy(false);
        }
      }, []);

      const onAuth = useCallback((input) => wrap(async () => {
        const data = await call("/auth", { method: "POST", body: input });
        setState(data.state);
        setSteps(data.steps ?? null);
        return data;
      }), [wrap]);

      const onLogout = useCallback(() => wrap(async () => {
        const data = await call("/logout", { method: "POST", body: {} });
        setState(data.state);
      }), [wrap]);

      // A second press rotates the key instead of leaving a pile of them.
      const onCreateKey = useCallback(() => wrap(async () => {
        const force = !!(state && state.hasKey);
        const data = await call("/key", { method: "POST", body: force ? { force: true } : {} });
        setState(data.state);
      }), [wrap, state]);

      const onReveal = useCallback(() => call("/key/reveal", { method: "POST", body: {} }), []);

      const onRefreshModels = useCallback(() => wrap(async () => {
        await call("/models/refresh", { method: "POST", body: {} });
        await refresh();
      }), [wrap, refresh]);

      const onRecharge = useCallback(async (amountYuan) => {
        try {
          return await call("/recharge", { method: "POST", body: { amountYuan } });
        } catch (e) {
          // Level 1 fallback: open the signed-in page and let it collect the amount.
          const link = await call("/recharge/link", { method: "POST", body: {} });
          return { url: link.url, orderNo: null };
        }
      }, []);

      const onPoll = useCallback((orderNo) => call("/recharge/status", { method: "POST", body: { orderNo } }), []);

      const onRefresh = useCallback(() => refresh(), [refresh]);

      if (state === null) {
        return h("div", { style: { padding: 16 } },
          h("div", { style: T.label }, "Sub2API"),
          error ? h("div", { style: { ...T.bad, fontSize: 13, marginTop: 6 } }, error) : h("div", { style: T.hint }, "加载中…"));
      }

      return h("div", { style: { padding: "4px 0 16px" } },
        h(AccountCard, { state, busy, onAuth, onLogout, steps }),
        h(KeyCard, { state, busy, onCreate: onCreateKey, onReveal }),
        h(RechargeCard, { state, busy, onRecharge, onPoll, onRefresh }),
        h(ModelsCard, { state, busy, onRefreshModels }),
        error ? h("div", { style: { ...T.bad, fontSize: 13 } }, error) : null,
      );
    }

    // ---------------------------------------------------------- sidebar

    function SidebarCard() {
      const [state, setState] = useState(null);

      useEffect(() => {
        let cancelled = false;
        const load = async () => {
          if (document.visibilityState === "hidden") return;
          try {
            const data = await call("/status");
            if (!cancelled) setState(data);
          } catch {
            // Keep the last figure on a transient failure.
          }
        };
        load();
        const timer = setInterval(load, 30000);
        return () => { cancelled = true; clearInterval(timer); };
      }, []);

      if (!state || !state.loggedIn) return null;
      const balance = state.profile ? Number(state.profile.balance) : NaN;

      return h("div", {
        style: {
          padding: "8px 10px",
          borderRadius: 12,
          border: "0.5px solid var(--dsw-alias-border-l3, #d8dbe0)",
          fontSize: 12,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        },
      },
        h("div", { style: { fontWeight: 500 } }, "Sub2API"),
        h("div", { style: Number.isFinite(balance) && balance <= 0 ? T.bad : T.hint },
          Number.isFinite(balance) ? "余额 " + money(balance) : "已登录"),
      );
    }

    // ----------------------------------------------------------- plugin

    const inject = ["slots"];

    function apply(ctx) {
      try {
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            { name: "settings.section", id: "sub2api", order: 300, label: () => "Sub2API" },
            Section,
          ),
        );
      } catch (error) {
        console.warn("[dsh-sub2api] 设置页注册失败：", error);
      }
      try {
        ctx.slots.inject("sidebar.footer.action", () =>
          ctx.slots.register({ name: "sidebar.footer.action", id: "sub2api-quota" }, SidebarCard),
        );
      } catch {
        // The sidebar slot is optional.
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.Section = Section;
    return module.exports;
  },
});
