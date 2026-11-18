window.__ModuleLoader__.load({
  id: "dsh-sub2api",
  factory: (require) => {
    const react = require("react");
    var module = { exports: {} };
    var exports = module.exports;
    const h = react.createElement;
    const { Component, useCallback, useEffect, useMemo, useRef, useState } = react;

    // ---------------------------------------------------------------- api

    const PREFIX = "/api/sub2api";

    class ApiError extends Error {
      constructor(message, code) {
        super(message);
        this.code = code;
      }
    }

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
        // A 404 here means the host half of the plugin never mounted: the
        // browser bundle loads independently, so the panel renders while every
        // route is missing. Say that instead of "响应不是 JSON".
        if (response.status === 404) {
          throw new ApiError(
            "插件后端没有加载：/api/sub2api 返回 404。请确认插件已启用，然后重启 DSH。",
            "host_missing",
          );
        }
        throw new ApiError(
          "HTTP " + response.status + "：响应不是 JSON（可能是网关或代理返回了错误页）",
          "not_json",
        );
      }
      if (!payload || payload.ok !== true) {
        throw new ApiError(
          payload && payload.error ? payload.error : "HTTP " + response.status,
          payload && payload.code,
        );
      }
      return payload.data;
    }

    // -------------------------------------------------------------- store

    /**
     * One shared view of the account, polled once.
     *
     * The panel and the balance badge are mounted in different slots and would
     * otherwise each poll `/status`; they also must never disagree about the
     * balance. A single store with subscribers gives both, and keeps polling
     * running while either surface is visible.
     */
    const statusStore = {
      state: null,
      error: "",
      inflight: null,
      timer: null,
      listeners: new Set(),

      subscribe(fn) {
        this.listeners.add(fn);
        return () => { this.listeners.delete(fn); };
      },

      emit() {
        for (const fn of [...this.listeners]) {
          try { fn(); } catch { /* a broken subscriber must not stop the others */ }
        }
      },

      /** Read the account, sharing one request between concurrent callers. */
      async refresh() {
        if (this.inflight) return this.inflight;
        this.inflight = (async () => {
          try {
            this.state = await call("/status");
            this.error = "";
          } catch (e) {
            this.error = e instanceof Error ? e.message : String(e);
          } finally {
            this.inflight = null;
            this.emit();
          }
        })();
        return this.inflight;
      },

      /** Refresh on a slow cadence while any surface is mounted and visible. */
      startPolling() {
        if (this.timer !== null) return;
        this.timer = setInterval(() => {
          if (document.visibilityState !== "hidden") this.refresh();
        }, 45000);
      },

      stopPolling() {
        if (this.timer === null) return;
        clearInterval(this.timer);
        this.timer = null;
      },

      /** Apply a response the caller already has, so the UI updates instantly. */
      accept(next) {
        if (next === undefined) return;
        this.state = next;
        this.error = "";
        this.emit();
      },
    };

    /** Subscribe a component to the shared store, with the initial read. */
    function useStatus() {
      const [snapshot, setSnapshot] = useState(() => ({
        state: statusStore.state,
        error: statusStore.error,
      }));

      useEffect(() => {
        const unsubscribe = statusStore.subscribe(() => {
          setSnapshot({ state: statusStore.state, error: statusStore.error });
        });
        statusStore.refresh();
        statusStore.startPolling();
        return () => {
          unsubscribe();
          if (statusStore.listeners.size === 0) statusStore.stopPolling();
        };
      }, []);

      return snapshot;
    }

    // -------------------------------------------------------------- theme

    const C = {
      text: "var(--dsw-alias-label-primary, #111827)",
      muted: "var(--dsw-alias-label-tertiary, #8b929c)",
      second: "var(--dsw-alias-label-secondary, #5b6472)",
      line: "var(--dsw-alias-border-l3, rgba(0,0,0,0.10))",
      surface: "var(--dsw-alias-bg-layer-1, #ffffff)",
      sunken: "var(--dsw-alias-bg-layer-2, #f6f7f9)",
      base: "var(--dsw-alias-bg-base, #ffffff)",
      accent: "var(--dsw-alias-state-business-primary, #2563eb)",
      ok: "var(--dsw-alias-state-success-primary, #15803d)",
      // DSH names it `warn`, not `warning`: the wrong name silently falls back
      // to this light-mode amber and reads badly on a dark surface.
      warn: "var(--dsw-alias-state-warn-primary, #b45309)",
      bad: "var(--dsw-alias-state-error-primary, #dc2626)",
    };

    /**
     * Focus rings for keyboard users.
     *
     * Everything here is inline styles, which cannot express `:focus-visible`,
     * so a single scoped stylesheet carries the rule and the roots opt in with
     * `data-sub2api`.
     */
    const FOCUS_CSS = [
      "[data-sub2api] :focus-visible{outline:2px solid " + C.accent + ";outline-offset:2px;border-radius:8px}",
      "[data-sub2api] input:focus-visible{outline-offset:1px}",
      "[data-sub2api] button:focus:not(:focus-visible){outline:none}",
      // A neutral overlay reads correctly on both light and dark surfaces,
      // which `filter: brightness()` does not.
      "[data-sub2api] [data-sub2api-btn]:not(:disabled):hover{box-shadow:inset 0 0 0 999px rgba(127,127,127,.09)}",
      "[data-sub2api] [data-sub2api-btn]:not(:disabled):active{box-shadow:inset 0 0 0 999px rgba(127,127,127,.16)}",
      "[data-sub2api] [data-sub2api-row]:hover{background:rgba(127,127,127,.055)}",
      "@media (prefers-reduced-motion: reduce){[data-sub2api] *{transition:none!important;animation:none!important}}",
    ].join("");

    function installFocusStyles(doc) {
      const id = "sub2api-focus";
      if (!doc || typeof doc.getElementById !== "function") return;
      if (doc.getElementById(id)) return;
      const style = doc.createElement("style");
      style.id = id;
      style.textContent = FOCUS_CSS;
      (doc.head || doc.documentElement).appendChild(style);
    }

    const T = {
      card: {
        border: "0.5px solid " + C.line,
        borderRadius: 16,
        background: C.surface,
        marginBottom: 12,
        overflow: "hidden",
      },
      head: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "13px 18px 11px",
        borderBottom: "0.5px solid " + C.line,
      },
      title: { margin: 0, fontSize: 14, fontWeight: 600, lineHeight: "22px", color: C.text },
      body: { padding: "16px 18px" },
      meta: { marginLeft: "auto", fontSize: 12, lineHeight: "18px", color: C.muted },
      label: { fontSize: 13, fontWeight: 500, lineHeight: "20px", color: C.second },
      hint: { fontSize: 12, lineHeight: "18px", color: C.muted },
      small: { fontSize: 12.5, lineHeight: "19px", color: C.second },
      row: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
      mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 },
      kv: { display: "flex", gap: 8, alignItems: "baseline", padding: "3px 0", fontSize: 12.5 },
      kvKey: { width: 68, flex: "0 0 68px", color: C.muted },
    };

    function Button({ variant = "default", size = "md", style, children, ...rest }) {
      const base = {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: size === "sm" ? 30 : 36,
        padding: size === "sm" ? "0 12px" : "0 16px",
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 500,
        cursor: rest.disabled ? "not-allowed" : "pointer",
        opacity: rest.disabled ? 0.5 : 1,
        transition: "background 120ms ease, border-color 120ms ease",
        whiteSpace: "nowrap",
        border: "0.5px solid " + C.line,
        background: C.sunken,
        color: C.text,
      };
      const variants = {
        primary: { border: "1px solid transparent", background: C.accent, color: "#fff" },
        ghost: { border: "0.5px solid transparent", background: "transparent", color: C.second },
        // Destructive: rebuilding the key revokes the one in use.
        danger: { border: "1px solid " + C.bad, background: "transparent", color: C.bad },
      };
      return h("button", {
        "data-sub2api-btn": "",
        style: { ...base, ...(variants[variant] || {}), ...style },
        ...rest,
      }, children);
    }

    function Card({ title, meta, children, id, aside }) {
      return h("section", { id, style: T.card },
        title
          ? h("div", { style: T.head },
              h("h3", { style: T.title }, title),
              meta ? h("span", { style: T.meta }, meta) : null,
              aside ?? null)
          : null,
        h("div", { style: T.body }, children),
      );
    }

    function TextField({ label, hint, trailing, style, ...rest }) {
      const [focused, setFocused] = useState(false);
      return h("label", { style: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0, ...style } },
        label ? h("span", { style: T.label }, label) : null,
        h("div", {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 38,
            padding: "0 4px 0 12px",
            borderRadius: 10,
            border: "0.5px solid " + (focused ? C.accent : C.line),
            boxShadow: focused ? "0 0 0 3px color-mix(in srgb, " + C.accent + " 14%, transparent)" : "none",
            background: C.base,
            transition: "border-color 120ms ease, box-shadow 120ms ease",
          },
        },
          h("input", {
            ...rest,
            onFocus: () => setFocused(true),
            onBlur: () => setFocused(false),
            style: {
              flex: 1,
              minWidth: 0,
              height: "100%",
              border: "none",
              outline: "none",
              background: "transparent",
              color: C.text,
              fontSize: 13.5,
            },
          }),
          trailing ?? null,
        ),
        hint ? h("span", { style: T.hint }, hint) : null,
      );
    }

    function Alert({ tone = "error", title, children, action }) {
      const palette = {
        error: { fg: C.bad, bg: "color-mix(in srgb, " + C.bad + " 8%, transparent)" },
        warn: { fg: C.warn, bg: "color-mix(in srgb, " + C.warn + " 9%, transparent)" },
        info: { fg: C.accent, bg: "color-mix(in srgb, " + C.accent + " 8%, transparent)" },
        ok: { fg: C.ok, bg: "color-mix(in srgb, " + C.ok + " 8%, transparent)" },
      }[tone];
      return h("div", {
        style: {
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          padding: "10px 12px",
          borderRadius: 12,
          background: palette.bg,
          color: palette.fg,
          fontSize: 12.5,
          lineHeight: "19px",
        },
      },
        h("div", { style: { flex: 1, minWidth: 0 } },
          title ? h("div", { style: { fontWeight: 600, marginBottom: 2 } }, title) : null,
          children),
        action ?? null,
      );
    }

    function Divider() {
      return h("div", { style: { height: 1, background: C.line, margin: "14px 0" } });
    }

    function Row({ label, children }) {
      return h("div", { style: T.kv },
        h("span", { style: T.kvKey }, label),
        h("span", { style: { flex: 1, minWidth: 0, color: C.text } }, children));
    }

    /** Every amount is quoted in yuan: the site treats one quota unit as one yuan. */
    function money(value) {
      const n = Number(value);
      return Number.isFinite(n) ? "¥" + n.toFixed(2) : "—";
    }

    function asText(value) {
      if (typeof value === "string") return value;
      if (value === null || value === undefined) return "";
      if (typeof value === "object") {
        if (typeof value.message === "string") return value.message;
        try {
          return JSON.stringify(value);
        } catch {
          return "";
        }
      }
      return String(value);
    }

    /** Progress values arrive either as 0..1 or 0..100 depending on the endpoint. */
    function pct(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.min(100, n <= 1 ? n * 100 : n));
    }

    function Bar({ label, value }) {
      const p = pct(value);
      if (p === null) return null;
      const tone = p >= 90 ? C.bad : p >= 70 ? C.warn : C.accent;
      return h("div", { style: { marginTop: 6 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.muted } },
          h("span", null, label),
          h("span", null, Math.round(p) + "%")),
        h("div", {
          role: "progressbar",
          "aria-label": label + "用量",
          "aria-valuenow": Math.round(p),
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          style: { height: 6, borderRadius: 999, background: C.sunken, marginTop: 4, overflow: "hidden" },
        },
          h("div", {
            style: { width: p + "%", height: "100%", background: tone, borderRadius: 999, transition: "width 240ms ease" },
          })),
      );
    }

    // ------------------------------------------------------------- error

    /** A render failure must not take the whole settings page down. */
    class Boundary extends Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      render() {
        if (this.state.error) {
          return h(Alert, { tone: "error", title: "Psapi 面板渲染失败" },
            asText(this.state.error) || "未知错误",
            h("div", { style: { ...T.hint, marginTop: 6 } }, "把这段信息发给我即可定位。"));
        }
        return this.props.children;
      }
    }

    // ---------------------------------------------------------- account

    function ProvisionReport({ steps, ready }) {
      if (!Array.isArray(steps)) return null;
      const notable = steps.filter((s) => !s.ok && s.tone !== "warn");
      if (notable.length === 0) return null;
      return h("div", { style: { marginTop: 12, display: "flex", flexDirection: "column", gap: 6 } },
        h("div", { style: { ...T.hint, fontWeight: 600, color: C.warn } },
          ready === false ? "开通未完成" : "部分步骤未完成"),
        notable.map((s) =>
          h(Alert, { key: s.id, tone: "error", title: s.label }, asText(s.error) || "失败")),
      );
    }

    function PasswordInput({ value, onChange, placeholder, autoComplete, onEnter }) {
      const [visible, setVisible] = useState(false);
      return h(TextField, {
        label: "密码",
        type: visible ? "text" : "password",
        value,
        placeholder,
        autoComplete,
        onChange: (e) => onChange(e.target.value),
        onKeyDown: (e) => { if (e.key === "Enter" && onEnter) onEnter(); },
        trailing: h(Button, {
          variant: "ghost",
          size: "sm",
          type: "button",
          onClick: () => setVisible((v) => !v),
          style: { height: 30, padding: "0 10px", fontSize: 12, color: C.muted },
        }, visible ? "隐藏" : "显示"),
      });
    }

    // -------------------------------------------------------------- toast

    /**
     * Short confirmations.
     *
     * Actions used to change a number somewhere on the page with no
     * acknowledgement, which is how a working plugin still feels unresponsive.
     */
    const toastStore = {
      items: [],
      nextId: 1,
      listeners: new Set(),
      push(text, tone = "ok") {
        const item = { id: this.nextId++, text, tone };
        this.items = [...this.items, item];
        this.emit();
        setTimeout(() => this.dismiss(item.id), 2600);
      },
      dismiss(id) {
        this.items = this.items.filter((item) => item.id !== id);
        this.emit();
      },
      subscribe(fn) {
        this.listeners.add(fn);
        return () => { this.listeners.delete(fn); };
      },
      emit() {
        for (const fn of [...this.listeners]) {
          try { fn(); } catch { /* ignore */ }
        }
      },
    };

    function useToasts() {
      const [items, setItems] = useState(toastStore.items);
      useEffect(() => toastStore.subscribe(() => setItems(toastStore.items)), []);
      return items;
    }

    function Toasts({ items }) {
      if (items.length === 0) return null;
      const worst = items.some((item) => item.tone === "error") ? "assertive" : "polite";
      return h("div", {
        role: "status",
        "aria-live": worst,
        "aria-atomic": "false",
        style: {
          position: "sticky",
          top: 0,
          zIndex: 5,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          alignItems: "flex-end",
          marginBottom: 8,
          pointerEvents: "none",
        },
      },
        items.map((item) =>
          h("div", {
            key: item.id,
            style: {
              pointerEvents: "auto",
              padding: "7px 12px",
              borderRadius: 999,
              fontSize: 12.5,
              background: item.tone === "error" ? "color-mix(in srgb, " + C.bad + " 12%, " + C.surface + ")" : "color-mix(in srgb, " + C.ok + " 12%, " + C.surface + ")",
              color: item.tone === "error" ? C.bad : C.ok,
              border: "0.5px solid " + C.line,
              boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
            },
          }, item.text)),
      );
    }

    // ----------------------------------------------------------- section

    /**
     * Which blocks the user left open, remembered per browser.
     *
     * The panel is reopened often and every block resets to the same default
     * otherwise, which means scrolling past the ones you never look at.
     */
    const OPEN_KEY = "dsh-sub2api:sections";
    const DEFAULT_OPEN = { models: true, recharge: false, account: false, key: false, diagnose: false };

    function readOpenSections() {
      try {
        const raw = window.localStorage.getItem(OPEN_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === "object" ? { ...DEFAULT_OPEN, ...parsed } : DEFAULT_OPEN;
      } catch {
        return DEFAULT_OPEN;
      }
    }

    /** A titled block that can be folded away, so the page stays scannable. */
    function Collapsible({ title, meta, open, onToggle, children, id }) {
      return h("section", { id, style: T.card },
        h("button", {
          type: "button",
          onClick: onToggle,
          "aria-expanded": open,
          style: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            padding: "13px 18px",
            border: "none",
            borderBottom: open ? "0.5px solid " + C.line : "none",
            background: "transparent",
            cursor: "pointer",
            textAlign: "left",
            color: "inherit",
          },
        },
          h("span", {
            style: {
              display: "inline-block",
              width: 0,
              height: 0,
              borderLeft: "5px solid " + C.muted,
              borderTop: "4px solid transparent",
              borderBottom: "4px solid transparent",
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform 120ms ease",
              flex: "0 0 auto",
            },
          }),
          h("h3", { style: T.title }, title),
          meta ? h("span", { style: T.meta }, meta) : null,
        ),
        open ? h("div", { style: T.body }, children) : null,
      );
    }

    // ------------------------------------------------------------ header

    /** The one line that answers "is this thing connected and funded". */
    function StatusHeader({ state, onOpenRecharge, onRefresh, refreshing }) {
      const profile = state.profile || {};
      const balance = Number(profile.balance);
      const known = Number.isFinite(balance);
      const low = known && balance <= 0;
      const models = state.models?.models?.length ?? 0;
      const pending = state.models?.needsRecharge === true;
      const dot = !state.loggedIn ? C.muted : low ? C.bad : known && balance < 5 ? C.warn : C.ok;

      return h("div", {
        style: {
          ...T.card,
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        },
      },
        h("span", {
          style: { width: 8, height: 8, borderRadius: 999, background: dot, flex: "0 0 8px" },
        }),
        h("div", { style: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 } },
          h("span", { style: { fontSize: 13.5, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis" } },
            state.loggedIn ? (state.email || "已连接") : "未连接 Psapi"),
          h("span", { style: T.hint },
            state.loggedIn
              ? models > 0
                ? `${models} 个模型可用`
                : pending
                  ? "余额为 0，充值后才能同步模型"
                  : "尚未同步模型"
              : "在下方填写邮箱和密码"),
        ),
        h("div", {
          style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
        },
          state.loggedIn
            ? h("span", {
                style: {
                  fontSize: 19,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  color: low ? C.bad : C.text,
                },
              }, known ? money(balance) : "—")
            : null,
          state.loggedIn
            ? h(Button, {
                size: "sm",
                onClick: onRefresh,
                disabled: refreshing,
                title: "重新读取余额与模型",
              }, refreshing ? "刷新中…" : "刷新")
            : null,
          state.loggedIn
            ? h(Button, { size: "sm", variant: low ? "primary" : "default", onClick: onOpenRecharge },
                low ? "去充值" : "充值")
            : null,
        ),
      );
    }

    // ----------------------------------------------------------- account

    function LoginCard({ busy, onAuth }) {
      const [email, setEmail] = useState("");
      const [password, setPassword] = useState("");
      const [promo, setPromo] = useState("");
      const [showPromo, setShowPromo] = useState(false);
      const [error, setError] = useState("");

      const submit = useCallback(async () => {
        setError("");
        try {
          await onAuth({ email: email.trim(), password, promoCode: promo.trim(), allowRegister: true });
          setPassword("");
          setPromo("");
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }, [email, password, promo, onAuth]);

      return h(Card, { title: "登录或注册" },
        h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
          h(TextField, {
            label: "邮箱",
            type: "email",
            autoComplete: "username",
            placeholder: "you@example.com",
            value: email,
            onChange: (e) => setEmail(e.target.value),
            onKeyDown: (e) => { if (e.key === "Enter") submit(); },
          }),
          h(PasswordInput, {
            value: password,
            onChange: setPassword,
            placeholder: "至少 6 位",
            autoComplete: "current-password",
            onEnter: submit,
          }),
          showPromo
            ? h(TextField, {
                label: "优惠码（可选）",
                placeholder: "注册时填写",
                value: promo,
                onChange: (e) => setPromo(e.target.value),
              })
            : null,
          h(Button, {
            variant: "primary",
            onClick: submit,
            disabled: busy || !email || password.length < 6,
            style: { width: "100%", height: 38 },
          }, busy ? "处理中…" : "继续"),
          error ? h(Alert, { tone: "error" }, error) : null,
          h(Divider),
          h("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
            h("span", { style: T.hint }, "没有账号会自动注册，并创建密钥 dsh。"),
            h(Button, {
              variant: "ghost",
              size: "sm",
              onClick: () => setShowPromo((v) => !v),
              style: { marginLeft: "auto" },
            }, showPromo ? "取消优惠码" : "有优惠码"),
          ),
        ),
      );
    }

    function AccountDetail({ state, steps, ready, pending, onLogout }) {
      const profile = state.profile || {};
      const usage = state.usage || {};
      const subs = Array.isArray(state.subscriptions?.subscriptions) ? state.subscriptions.subscriptions : [];
      const cost = (key) => {
        const value = Number(usage[key]);
        return Number.isFinite(value) ? money(value) : null;
      };
      const today = cost("today_cost") ?? cost("todayCost") ?? cost("cost_today");
      const total = cost("total_cost") ?? cost("month_cost") ?? cost("cost_month");
      const requests = usage.total_requests ?? usage.request_count;

      return h("div", null,
        h(Row, { label: "账号" }, state.email || "已登录"),
        h(Row, { label: "余额" }, money(profile.balance)),

        today || total || Number.isFinite(Number(requests))
          ? h(Row, { label: "用量" },
              [today ? `今日 ${today}` : null, total ? `累计 ${total}` : null,
               Number.isFinite(Number(requests)) ? `${requests} 次` : null]
                .filter(Boolean).join(" · "))
          : null,
        subs.length > 0
          ? h("div", { style: { marginTop: 10 } },
              subs.map((entry, index) =>
                h("div", { key: index, style: { marginBottom: 8 } },
                  h("div", { style: { ...T.small, fontWeight: 500 } },
                    `${entry.group_name || "订阅"}${entry.days_remaining !== null && entry.days_remaining !== undefined ? ` · 剩余 ${entry.days_remaining} 天` : ""}`),
                  h(Bar, { label: "日", value: entry.daily_progress }),
                  h(Bar, { label: "周", value: entry.weekly_progress }),
                  h(Bar, { label: "月", value: entry.monthly_progress }),
                )))
          : null,
        h(ProvisionReport, { steps, ready }),
        h("div", { style: { marginTop: 12 } },
          h(Button, { onClick: onLogout, disabled: pending.logout }, pending.logout ? "退出中…" : "退出登录")),
      );
    }

    // --------------------------------------------------------------- key

    function KeyDetail({ state, pending, onCreate, onReveal }) {
      const [revealed, setRevealed] = useState("");
      const [confirming, setConfirming] = useState(false);
      const hideTimer = useRef(null);

      useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

      const copy = async () => {
        try {
          const text = revealed || (await onReveal()).key;
          setRevealed(text);
          if (text) await navigator.clipboard.writeText(text);
          toastStore.push("密钥已复制");
          // Put the mask back: a plaintext key left on screen is a screenshot away
          // from leaking, and the clipboard already has it.
          if (hideTimer.current) clearTimeout(hideTimer.current);
          hideTimer.current = setTimeout(() => setRevealed(""), 8000);
        } catch {
          toastStore.push("复制失败，请手动选择", "error");
        }
      };

      // Rebuilding revokes the key DSH is using right now, so it takes two clicks.
      const rebuild = async () => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        await onCreate();
      };

      return h("div", null,
        h("div", { style: T.row },
          h("code", {
            style: {
              ...T.mono,
              flex: "1 1 220px",
              minWidth: 0,
              padding: "8px 10px",
              borderRadius: 10,
              background: C.sunken,
              color: C.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          }, revealed || state.keyMasked || "尚未创建"),
          h(Button, { onClick: copy, disabled: !state.hasKey }, "复制"),
          h(Button, {
            onClick: rebuild,
            disabled: pending.key,
            variant: confirming && state.hasKey ? "danger" : "default",
            title: confirming ? "再点一次将作废旧密钥" : undefined,
          },
            pending.key
              ? "处理中…"
              : !state.hasKey
                ? "创建"
                : confirming
                  ? "确认重建"
                  : "重建"),
          confirming
            ? h(Button, { variant: "ghost", onClick: () => setConfirming(false) }, "取消")
            : null,
        ),
        h("div", { style: { ...T.hint, marginTop: 10 } },
          "密钥固定命名为 ", h("code", { style: T.mono }, state.keyName || "dsh"),
          "，存在本机凭据库；页面只显示掩码。"),
      );
    }

    // ----------------------------------------------------------- recharge

    const PRESETS = [10, 20, 50, 100];

    /** How long the pay centre keeps an unpaid order open. */
    const ORDER_TTL_MS = 30 * 60 * 1000;

    function mmss(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const m = Math.floor(total / 60);
      const sec = total % 60;
      return `${m}:${String(sec).padStart(2, "0")}`;
    }

    function RechargeDetail({ state, pending, onRecharge, onPoll, onRefresh, onRedeem }) {
      const [amount, setAmount] = useState(20);
      const [custom, setCustom] = useState("");
      const [order, setOrder] = useState(null);
      const [status, setStatus] = useState(null);
      const [code, setCode] = useState("");
      const [showRedeem, setShowRedeem] = useState(false);
      const [opening, setOpening] = useState(false);
      const [now, setNow] = useState(() => Date.now());
      const timer = useRef(null);

      const multiplier = Number(state.rechargeMultiplier) > 0 ? Number(state.rechargeMultiplier) : 2;
      const value = custom !== "" ? Number(custom) : amount;
      const credit = Number.isFinite(value) ? value * multiplier : 0;

      // An order expires in 30 minutes; showing the clock beats leaving the user
      // staring at "等待付款…" that will never resolve.
      useEffect(() => {
        if (!order) return undefined;
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(tick);
      }, [order]);

      const expiresAt = order && order.createdAt ? order.createdAt + ORDER_TTL_MS : null;
      const leftMs = expiresAt === null ? null : expiresAt - now;
      const expired = leftMs !== null && leftMs <= 0;

      useEffect(() => {
        if (!order || expired) return undefined;
        timer.current = setInterval(async () => {
          try {
            const result = await onPoll(order.orderNo);
            setStatus(result);
            if (result.tone === "done" || result.tone === "error") {
              clearInterval(timer.current);
              timer.current = null;
              if (result.tone === "done") {
                toastStore.push(result.text || "已到账");
                await onRefresh();
              }
            }
          } catch (e) {
            clearInterval(timer.current);
            timer.current = null;
            toastStore.push(
              "查询订单失败：" + (e instanceof Error ? e.message : String(e)) + "；可点「刷新」看余额",
              "error",
            );
          }
        }, 5000);
        return () => { if (timer.current) clearInterval(timer.current); };
      }, [order, onPoll, onRefresh, expired]);

      const start = async () => {
        if (opening) return;
        const tab = window.open("", "_blank");
        setOpening(true);
        try {
          const data = await onRecharge(value);
          const target = data.checkoutUrl || data.url;
          if (tab) tab.location.href = target;
          else window.open(target, "_blank", "noopener");
          if (data.orderNo) setOrder({ ...data, createdAt: Date.now() });
        } catch (e) {
          if (tab) tab.close();
          toastStore.push(e instanceof Error ? e.message : String(e), "error");
        } finally {
          setOpening(false);
        }
      };

      const reopen = () => {
        const target = order && (order.checkoutUrl || order.url);
        if (target) window.open(target, "_blank", "noopener");
        else toastStore.push("没有可用的支付链接，请重新下单", "error");
      };

      const redeem = async () => {
        try {
          const result = await onRedeem(code.trim());
          setCode("");
          setShowRedeem(false);
          toastStore.push(result?.profile ? `已兑换，余额 ${money(result.profile.balance)}` : "兑换成功");
          await onRefresh();
        } catch (e) {
          toastStore.push(e instanceof Error ? e.message : String(e), "error");
        }
      };

      return h("div", null,
        h("div", { style: { ...T.row, marginBottom: 10 } },
          h("span", { style: T.small }, `1 元 = ${multiplier.toFixed(2)} 元额度`),
          h("span", { style: { ...T.hint, marginLeft: "auto" } }, "到账后余额自动更新"),
        ),
        h("div", { style: { ...T.row, marginBottom: 10 } },
          PRESETS.map((preset) =>
            h(Button, {
              key: preset,
              size: "sm",
              variant: custom === "" && amount === preset ? "primary" : "default",
              onClick: () => { setAmount(preset); setCustom(""); },
              style: { minWidth: 58, borderRadius: 999 },
            }, "¥" + preset),
          ),
          h(TextField, {
            placeholder: "自定义",
            inputMode: "decimal",
            value: custom,
            onChange: (e) => setCustom(e.target.value.replace(/[^0-9.]/g, "")),
            style: { flex: "0 1 110px", minWidth: 92 },
          }),
        ),
        h("div", { style: { ...T.row } },
          h("span", { style: T.small }, "预计到账"),
          h("span", { style: { fontSize: 15, fontWeight: 600, color: C.text } }, money(credit)),
          h("div", { style: { marginLeft: "auto", display: "flex", gap: 8 } },
            h(Button, {
              variant: "primary",
              onClick: start,
              disabled: !state.loggedIn || !Number.isFinite(value) || value <= 0 || opening,
            }, opening ? "正在下单…" : "去支付"),
          ),
        ),
        order
          ? h("div", { style: { marginTop: 12 } },
              h(Alert, {
                tone: expired
                  ? "warn"
                  : status
                    ? status.tone === "done" ? "ok" : status.tone === "error" ? "error" : "info"
                    : "info",
                title: "订单 " + order.orderNo + (leftMs !== null && !expired ? ` · 剩余 ${mmss(leftMs)}` : ""),
                action: h(Button, {
                  size: "sm",
                  onClick: reopen,
                  style: { color: "inherit", borderColor: "currentColor", background: "transparent" },
                }, expired ? "重新下单" : "重新打开支付页"),
              },
                expired
                  ? "订单已过 30 分钟有效期，没有支付的话已经作废，重新下单即可。"
                  : status
                    ? status.text
                    : "已打开支付页，等待付款…到账后余额会自动更新，这页不用守着。"))
          : null,
        h("div", { style: { marginTop: 12, display: "flex", gap: 8, alignItems: "center" } },
          h(Button, {
            variant: "ghost",
            size: "sm",
            onClick: () => setShowRedeem((v) => !v),
          }, showRedeem ? "收起兑换码" : "有兑换码？"),
          showRedeem
            ? h("div", { style: { flex: 1, display: "flex", gap: 8 } },
                h(TextField, {
                  placeholder: "兑换码",
                  value: code,
                  onChange: (e) => setCode(e.target.value),
                  onKeyDown: (e) => { if (e.key === "Enter" && code.trim()) redeem(); },
                }),
                h(Button, { onClick: redeem, disabled: !code.trim() }, "兑换"),
              )
            : null,
        ),
      );
    }

    // ------------------------------------------------------------ models

    function contextBadge(model) {
      if (!model || !model.contextWindow) return null;
      const k = Math.round(Number(model.contextWindow) / 1000);
      const source = model.contextSource;
      const label = source === "default" ? "默认" : source === "known" ? "实测" : source === "panel" ? "手填" : null;
      return h("span", {
        style: {
          fontSize: 11.5,
          color: source === "default" ? C.warn : C.muted,
          whiteSpace: "nowrap",
        },
      }, k + "k" + (label ? " · " + label : ""));
    }

    function ModelRow({ model, shown, checked, onToggle, onSaveContext }) {
      const [editing, setEditing] = useState(false);
      const [draft, setDraft] = useState("");
      const current = shown.find((m) => m.id === model.id) ?? model;
      const effective = current.contextWindow ? Math.round(Number(current.contextWindow) / 1000) : null;

      const submit = async () => {
        const value = draft.trim() === "" ? null : Number(draft) * 1000;
        try {
          await onSaveContext(model.id, value);
          toastStore.push(value === null ? "已恢复上游容量" : "容量已保存");
        } catch (e) {
          toastStore.push(e instanceof Error ? e.message : String(e), "error");
        }
        setEditing(false);
        setDraft("");
      };

      return h("div", {
        "data-sub2api-row": "",
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 12px",
          borderTop: "0.5px solid " + C.line,
          fontSize: 13,
          transition: "background 120ms ease",
        },
      },
        h("input", {
          type: "checkbox",
          checked,
          onChange: () => onToggle(model.id),
          "aria-label": `${model.id} 是否显示在对话中`,
        }),
        h("code", {
          style: { ...T.mono, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
        }, model.id),
        editing
          ? h("span", { style: { display: "flex", gap: 6, alignItems: "center" } },
              h("input", {
                type: "number",
                min: 1,
                step: 1,
                placeholder: effective === null ? "" : String(effective),
                value: draft,
                onChange: (e) => setDraft(e.target.value),
                onKeyDown: (e) => { if (e.key === "Enter") submit(); },
                style: {
                  width: 64, height: 26, padding: "0 6px", borderRadius: 8,
                  border: "0.5px solid " + C.line, background: C.base, color: C.text, fontSize: 12,
                },
              }),
              h("span", { style: T.hint }, "k"),
              h(Button, { size: "sm", variant: "primary", onClick: submit, style: { height: 26 } }, "存"),
              h(Button, { size: "sm", onClick: () => { setEditing(false); setDraft(""); }, style: { height: 26 } }, "取消"),
            )
          : h("button", {
              type: "button",
              onClick: () => { setEditing(true); setDraft(effective === null ? "" : String(effective)); },
              title: "点击修改这个模型的上下文窗口",
              style: {
                border: "none", background: "transparent", padding: "2px 4px", cursor: "pointer",
                color: current.contextSource === "default" ? C.warn : C.muted, fontSize: 11.5,
              },
            }, contextBadge(current) ?? "设置"),
        Array.isArray(current.reasoningEfforts)
          ? h("span", { style: { ...T.hint, whiteSpace: "nowrap" } }, "思考 " + current.reasoningEfforts.length + " 档")
          : null,
        shown.some((m) => m.id === model.id && m.vision) ? h("span", { style: T.hint }, "图片") : null,
      );
    }

    function ModelsDetail({ state, pending, onRefreshModels, onSaveVisible, onSaveContext, onGoRecharge }) {
      const models = state.models || { models: [], all: [], allowed: [], fetchedAt: 0, stale: false, error: null };
      const shown = models.models || [];
      const everything = models.all || [];
      const allowed = models.allowed || [];
      const showingAll = allowed.length === 0;

      const [draft, setDraft] = useState(null);
      const [saving, setSaving] = useState(false);
      const [query, setQuery] = useState("");
      const [expanded, setExpanded] = useState(false);

      const checked = draft ?? (showingAll ? everything.map((m) => m.id) : allowed);
      const isOn = (id) => checked.includes(id);
      const dirty = draft !== null;

      const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (q === "") return everything;
        return everything.filter((m) =>
          m.id.toLowerCase().includes(q) || String(m.displayName ?? "").toLowerCase().includes(q),
        );
      }, [everything, query]);

      const toggle = (id) => {
        setDraft(isOn(id) ? checked.filter((x) => x !== id) : [...checked, id]);
      };

      const save = async () => {
        setSaving(true);
        try {
          const ids = checked.length === everything.length ? [] : checked;
          await onSaveVisible(ids);
          setDraft(null);
          toastStore.push(ids.length === 0 ? "已显示全部模型" : `对话里将显示 ${ids.length} 个模型`);
        } catch (e) {
          toastStore.push(e instanceof Error ? e.message : String(e), "error");
        } finally {
          setSaving(false);
        }
      };

      const reason = models.error?.message ?? "";

      if (models.needsRecharge) {
        return h("div", null,
          h(Alert, {
            tone: "warn",
            title: "余额不足，暂时拿不到模型列表",
            action: h(Button, {
              size: "sm",
              onClick: onGoRecharge,
              style: { color: "inherit", borderColor: "currentColor", background: "transparent" },
            }, "去充值"),
          },
            "Psapi 在余额为 0 时会拒绝 /v1/models；充值到账后自动同步。"));
      }

      if (everything.length === 0) {
        return h("div", null,
          reason
            ? h(Alert, { tone: "error", title: "同步失败" }, reason)
            : h("div", { style: T.hint }, "还没有模型。点「刷新模型」从上游同步。"),
          h("div", { style: { marginTop: 10 } },
            h(Button, { onClick: onRefreshModels, disabled: pending.models },
              pending.models ? "同步中…" : "刷新模型")),
        );
      }

      return h("div", null,
        h("div", { style: { ...T.row, marginBottom: 10 } },
          h("span", { style: { ...T.small, fontWeight: 500 } },
            showingAll && !dirty ? `全部 ${everything.length} 个` : `已选 ${checked.length} / ${everything.length}`),
          h("div", { style: { marginLeft: "auto", display: "flex", gap: 8 } },
            h(Button, {
              size: "sm",
              onClick: async () => {
                try {
                  await onRefreshModels();
                } catch (e) {
                  toastStore.push(e instanceof Error ? e.message : String(e), "error");
                }
              },
              disabled: pending.models,
            }, pending.models ? "同步中…" : "刷新"),
            h(Button, { size: "sm", onClick: () => setExpanded((v) => !v) },
              expanded ? "收起" : "管理"),
          ),
        ),
        expanded
          ? h("div", null,
              everything.length > 4
                ? h("div", { style: { marginBottom: 8, display: "flex", gap: 8, alignItems: "center" } },
                    h(TextField, {
                      placeholder: "搜索模型 id 或名称",
                      value: query,
                      onChange: (e) => setQuery(e.target.value),
                      style: { flex: 1 },
                    }),
                    query.trim() === ""
                      ? null
                      : h("span", { style: { ...T.hint, whiteSpace: "nowrap" } },
                          `${filtered.length} / ${everything.length}`))
                : null,
              h("div", {
                style: { maxHeight: 300, overflow: "auto", border: "0.5px solid " + C.line, borderRadius: 12 },
              },
                filtered.length === 0
                  ? h("div", { style: { ...T.hint, padding: 12 } }, "没有匹配的模型")
                  : filtered.map((model) =>
                      h(ModelRow, {
                        key: model.id,
                        model,
                        shown,
                        checked: isOn(model.id),
                        onToggle: toggle,
                        onSaveContext,
                      })),
              ),
              h("div", { style: { ...T.row, marginTop: 10 } },
                h(Button, { size: "sm", onClick: () => setDraft(everything.map((m) => m.id)) }, "全选"),
                h(Button, { size: "sm", onClick: () => setDraft([]) }, "全不选"),
                dirty ? h(Button, { size: "sm", onClick: () => setDraft(null) }, "还原") : null,
                h("div", { style: { marginLeft: "auto" } },
                  h(Button, { variant: "primary", size: "sm", onClick: save, disabled: !dirty || saving },
                    saving ? "保存中…" : "保存选择")),
              ),
            )
          : h("div", { style: T.hint },
              `${shown.length} 个模型会出现在对话的选择器里；点「管理」可以增减或改上下文容量。`),
      );
    }

    // ---------------------------------------------------------- diagnose

    function DiagnoseDetail({ state, onDiagnose }) {
      const [result, setResult] = useState(null);
      const [busy, setBusy] = useState(false);

      const run = async () => {
        setBusy(true);
        try {
          setResult(await onDiagnose());
        } catch (e) {
          toastStore.push(e instanceof Error ? e.message : String(e), "error");
        } finally {
          setBusy(false);
        }
      };

      return h("div", null,
        h("div", { style: T.row },
          h(Button, { onClick: run, disabled: busy || !state.loggedIn }, busy ? "检查中…" : "运行诊断"),
          result
            ? h("span", { style: { ...T.hint, color: result.ok ? C.ok : C.warn } }, result.summary)
            : null,
        ),
        result
          ? h("div", { style: { marginTop: 12, border: "0.5px solid " + C.line, borderRadius: 12 } },
              result.checks.map((check) =>
                h("div", {
                  key: check.id,
                  style: {
                    display: "flex",
                    gap: 10,
                    alignItems: "baseline",
                    padding: "7px 12px",
                    borderTop: "0.5px solid " + C.line,
                    fontSize: 12.5,
                  },
                },
                  h("span", { style: { width: 6, height: 6, borderRadius: 999, flex: "0 0 6px", background: check.ok ? C.ok : C.warn, alignSelf: "center" } }),
                  h("span", { style: { width: 74, flex: "0 0 74px", color: C.muted } }, check.label),
                  h("span", { style: { flex: 1, minWidth: 0, color: check.ok ? C.text : C.warn } },
                    check.detail ?? (check.ok ? "正常" : "失败")),
                )))
          : h("div", { style: { ...T.hint, marginTop: 10 } },
              "依次检查登录、令牌、密钥、余额、密钥分组和模型目录，指出失败的那一项。"),
      );
    }

    // ------------------------------------------------------------- root

    function SectionInner() {
      const { state, error } = useStatus();
      const toasts = useToasts();
      const [pending, setPending] = useState({});
      const [steps, setSteps] = useState(null);
      const [ready, setReady] = useState(undefined);
      const [announcements, setAnnouncements] = useState([]);
      const [open, setOpen] = useState(readOpenSections);

      useEffect(() => {
        try {
          window.localStorage.setItem(OPEN_KEY, JSON.stringify(open));
        } catch {
          // Private mode or a full quota: folding still works, it just forgets.
        }
      }, [open]);

      const setBusy = (key, value) => setPending((prev) => ({ ...prev, [key]: value }));
      const run = useCallback(async (key, fn) => {
        setPending((prev) => ({ ...prev, [key]: true }));
        try {
          return await fn();
        } finally {
          setPending((prev) => ({ ...prev, [key]: false }));
        }
      }, []);

      useEffect(() => {
        let cancelled = false;
        call("/announcements")
          .then((data) => { if (!cancelled) setAnnouncements(Array.isArray(data.items) ? data.items : []); })
          .catch(() => {});
        return () => { cancelled = true; };
      }, [state && state.loggedIn]);

      // A recharge is the one thing worth unfolding automatically.
      const balance = state?.profile ? Number(state.profile.balance) : NaN;
      useEffect(() => {
        if (Number.isFinite(balance) && balance <= 0) {
          setOpen((prev) => (prev.models ? { ...prev, recharge: true } : prev));
        }
      }, [balance]);

      const onAuth = useCallback((input) => run("auth", async () => {
        const data = await call("/auth", { method: "POST", body: input });
        statusStore.accept(data.state);
        setSteps(data.steps ?? null);
        setReady(data.ready);
        toastStore.push(data.mode === "register" ? "注册成功，密钥已就绪" : "已登录");
        return data;
      }), [run]);

      const onLogout = useCallback(() => run("logout", async () => {
        const data = await call("/logout", { method: "POST", body: {} });
        statusStore.accept(data.state);
        setSteps(null);
        setReady(undefined);
        toastStore.push("已退出登录");
      }), [run]);

      const onCreateKey = useCallback(() => run("key", async () => {
        const force = !!statusStore.state?.hasKey;
        const data = await call("/key", { method: "POST", body: force ? { force: true } : {} });
        statusStore.accept(data.state);
        toastStore.push(force ? "密钥已重建" : "密钥已创建");
      }), [run]);

      const onReveal = useCallback(() => call("/key/reveal", { method: "POST", body: {} }), []);

      const onRefreshModels = useCallback(() => run("models", async () => {
        const result = await call("/models/refresh", { method: "POST", body: {} });
        await statusStore.refresh();
        if (result.error) toastStore.push(result.error.message || "同步失败", "error");
        else toastStore.push(`已同步 ${result.count} 个模型`);
        return result;
      }), [run]);

      const onSaveVisible = useCallback(async (ids) => {
        await call("/models/visible", { method: "POST", body: { ids } });
        await statusStore.refresh();
      }, []);

      const onSaveContext = useCallback(async (id, contextWindow) => {
        await call("/models/context", { method: "POST", body: { id, contextWindow } });
        await statusStore.refresh();
      }, []);

      const onDiagnose = useCallback(() => call("/diagnose"), []);

      const onRecharge = useCallback(async (amountYuan) => {
        try {
          return await call("/recharge", { method: "POST", body: { amountYuan } });
        } catch {
          const link = await call("/recharge/link", { method: "POST", body: {} });
          return { url: link.url, orderNo: null };
        }
      }, []);

      const onPoll = useCallback((orderNo) => call("/recharge/status", { method: "POST", body: { orderNo } }), []);
      const onRedeem = useCallback((code) => call("/redeem", { method: "POST", body: { code } }), []);
      const onRefresh = useCallback(() => statusStore.refresh(), []);

      const toggle = (key) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

      if (state === null) {
        const failure = error || "";
        if (failure) {
          return h("div", { style: { padding: "4px 0 18px" } },
            h(Card, { title: "Psapi" },
              h(Alert, { tone: "error", title: "面板无法连接插件后端" }, failure),
              h("div", { style: { ...T.hint, marginTop: 12 } },
                "常见原因：插件装上了但宿主那一半没有加载（版本不匹配、依赖缺失、或安装后没有重启）。"),
              h("div", { style: { ...T.hint, marginTop: 6 } },
                "排查：在 DSH 终端执行 ", h("code", { style: T.mono }, "dsh plugin list"),
                " 确认已安装；重启 DSH 后再打开这里。"),
              h("div", { style: { marginTop: 12 } },
                h(Button, { onClick: () => statusStore.refresh() }, "重试")),
            ),
          );
        }
        return h(Skeleton, null);
      }

      const unread = announcements.filter((item) => !item.is_read);

      if (!state.loggedIn) {
        return h("div", { style: { padding: "4px 0 18px" } },
          h(Toasts, { items: toasts }),
          h(LoginCard, { busy: pending.auth === true, onAuth }),
        );
      }

      const models = state.models || {};
      const shownCount = models.models?.length ?? 0;

      return h("div", { style: { padding: "4px 0 18px", position: "relative" } },
        h(Toasts, { items: toasts }),
        unread.length > 0
          ? h("div", { style: { marginBottom: 12 } },
              h(Alert, { tone: "info", title: unread[0].title ?? "站点公告" },
                asText(unread[0].content ?? unread[0].body ?? "").slice(0, 200)))
          : null,

        h(StatusHeader, {
          state,
          refreshing: pending.manualRefresh === true,
          onRefresh: () => run("manualRefresh", () => statusStore.refresh()),
          onOpenRecharge: () => {
            setOpen((prev) => ({ ...prev, recharge: true }));
            const target = document.getElementById("sub2api-recharge");
            if (target && typeof target.scrollIntoView === "function") {
              setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
            }
          },
        }),

        h(Collapsible, {
          id: "sub2api-models",
          title: "模型",
          meta: shownCount > 0 ? `${shownCount} 个在对话中可选` : "未同步",
          open: open.models,
          onToggle: () => toggle("models"),
        },
          h(ModelsDetail, {
            state,
            pending: { models: pending.models === true },
            onRefreshModels,
            onSaveVisible,
            onSaveContext,
            onGoRecharge: () => { setOpen((prev) => ({ ...prev, recharge: true })); },
          })),

        h(Collapsible, {
          id: "sub2api-recharge",
          title: "充值",
          meta: Number.isFinite(balance) ? `余额 ${money(balance)}` : null,
          open: open.recharge,
          onToggle: () => toggle("recharge"),
        },
          h(RechargeDetail, { state, pending, onRecharge, onPoll, onRefresh, onRedeem })),

        h(Collapsible, {
          title: "API 密钥",
          meta: state.hasKey ? state.keyMasked : "未创建",
          open: open.key,
          onToggle: () => toggle("key"),
        },
          h(KeyDetail, { state, pending, onCreate: onCreateKey, onReveal })),

        h(Collapsible, {
          title: "账户与用量",
          meta: state.email || null,
          open: open.account,
          onToggle: () => toggle("account"),
        },
          h(AccountDetail, { state, steps, ready, pending, onLogout })),

        h(Collapsible, {
          title: "诊断",
          meta: state.version ? "v" + state.version : null,
          open: open.diagnose,
          onToggle: () => toggle("diagnose"),
        },
          h(DiagnoseDetail, { state, onDiagnose })),

        error ? h(Alert, { tone: "error" }, error) : null,
      );
    }

    function Section() {
      useEffect(() => {
        installFocusStyles(typeof document === "undefined" ? undefined : document);
      }, []);
      return h("div", { "data-sub2api": "" }, h(Boundary, null, h(SectionInner, null)));
    }

    // ------------------------------------------------------------ badge

    /**
     * The always-visible balance pill in the chat input's trailing controls.
     *
     * It is the one number a user checks before sending a long request, so it
     * lives where the send button does rather than behind settings.
     */
    function BalanceBadge() {
      const { state } = useStatus();
      if (!state || !state.loggedIn) return null;

      const balance = state.profile ? Number(state.profile.balance) : NaN;
      const known = Number.isFinite(balance);
      const low = known && balance <= 0;
      const thin = known && balance > 0 && balance < 5;
      const dot = low ? C.bad : thin ? C.warn : C.ok;

      const models = state.models?.models?.length ?? 0;
      const pendingRecharge = state.models?.needsRecharge === true;
      const detail = [
        known ? `余额 ${money(balance)}` : "余额未知",
        state.email ? `账号 ${state.email}` : null,
        models > 0 ? `可用模型 ${models} 个` : pendingRecharge ? "充值后可同步模型" : "尚未同步模型",
        low ? "点击去充值" : "点击刷新",
      ].filter(Boolean).join("\n");

      const onClick = async () => {
        if (low) {
          try {
            const link = await call("/recharge/link", { method: "POST", body: {} });
            window.open(link.url, "_blank", "noopener");
            return;
          } catch {
            // Fall through to a refresh so a failure is not silent forever.
          }
        }
        statusStore.refresh();
      };

      return h("button", {
        type: "button",
        "data-sub2api": "",
        title: detail,
        "aria-label": `Psapi ${known ? "余额 " + money(balance) : "余额未知"}，点击${low ? "去充值" : "刷新"}`,
        onClick,
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 28,
          padding: "0 10px",
          borderRadius: 999,
          border: "0.5px solid " + C.line,
          background: "transparent",
          color: low ? C.bad : C.second,
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          cursor: "pointer",
          whiteSpace: "nowrap",
        },
      },
        h("span", { style: { width: 6, height: 6, borderRadius: 999, background: dot, flex: "0 0 6px" } }),
        h("span", null, known ? money(balance) : "余额"),
        low ? h("span", { style: { color: C.bad } }, "去充值") : null,
      );
    }

    // --------------------------------------------------------- skeleton

    /** Placeholder blocks while the first status read is in flight. */
    function Skeleton() {
      const bar = (width, height) =>
        h("div", {
          style: {
            width,
            height,
            borderRadius: 8,
            background: "color-mix(in srgb, " + C.muted + " 16%, transparent)",
          },
        });
      return h("div", { style: { padding: "4px 0 18px" } },
        h(Card, { title: "Psapi" },
          bar("40%", 14),
          h("div", { style: { height: 10 } }),
          bar("70%", 12),
          h("div", { style: { height: 10 } }),
          bar("55%", 12)),
      );
    }

    // ---------------------------------------------------------- sidebar

    function SidebarCard() {
      const { state } = useStatus();
      if (!state || !state.loggedIn) return null;
      const balance = state.profile ? Number(state.profile.balance) : NaN;
      const low = Number.isFinite(balance) && balance <= 0;

      return h("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderRadius: 12,
          border: "0.5px solid " + C.line,
          fontSize: 12,
          lineHeight: "18px",
        },
      },
        h("span", { style: { fontWeight: 600, color: C.text } }, "Psapi"),
        h("span", { style: { marginLeft: "auto", color: low ? C.bad : C.muted } },
          Number.isFinite(balance) ? (low ? "余额不足" : money(balance)) : "已登录"),
      );
    }

    // ----------------------------------------------------------- plugin

    const inject = ["slots"];

    function apply(ctx) {
      try {
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            { name: "settings.section", id: "sub2api", order: 300, label: () => "Psapi" },
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
      try {
        ctx.slots.inject("conversation.input.right", () =>
          ctx.slots.register(
            { name: "conversation.input.right", id: "sub2api-balance" },
            BalanceBadge,
          ),
        );
      } catch {
        // Older hosts without the chat composer slot keep the panel only.
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.Section = Section;
    exports.BalanceBadge = BalanceBadge;
    // Exposed for the load test: pure read/write of the remembered layout.
    exports.__sections = { readOpenSections, DEFAULT_OPEN, OPEN_KEY };
    return module.exports;
  },
});
