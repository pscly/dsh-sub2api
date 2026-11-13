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
      warn: "var(--dsw-alias-state-warning-primary, #b45309)",
      bad: "var(--dsw-alias-state-error-primary, #dc2626)",
    };

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
      };
      return h("button", { style: { ...base, ...(variants[variant] || {}), ...style }, ...rest }, children);
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
        h("div", { style: { height: 4, borderRadius: 999, background: C.sunken, marginTop: 3, overflow: "hidden" } },
          h("div", { style: { width: p + "%", height: "100%", background: tone, borderRadius: 999 } })),
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
          return h(Alert, { tone: "error", title: "Sub2API 面板渲染失败" },
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

    function AccountCard({ state, busy, steps, ready, onAuth, onLogout }) {
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

      if (state.loggedIn) {
        const user = state.user || {};
        const profile = state.profile || {};
        const usage = state.usage || {};
        const subs = Array.isArray(state.subscriptions?.subscriptions) ? state.subscriptions.subscriptions : [];

        const cost = (key) => {
          const value = Number(usage[key]);
          return Number.isFinite(value) ? money(value) : null;
        };
        const today = cost("today_cost") ?? cost("todayCost") ?? cost("cost_today");
        const month = cost("total_cost") ?? cost("month_cost") ?? cost("cost_month");
        const requests = usage.total_requests ?? usage.request_count;

        return h(Card, {
          title: "账户",
          meta: state.apiBase,
          aside: h(Button, { onClick: onLogout, disabled: busy, size: "sm", style: { marginLeft: "auto" } }, "退出登录"),
        },
          h(Row, { label: "账号" }, state.email || user.email || "已登录"),
          h(Row, { label: "余额" },
            h("span", { style: { fontSize: 15, fontWeight: 600, color: Number(profile.balance) > 0 ? C.ok : C.warn } },
              money(profile.balance)),
            Number(profile.concurrency) > 0
              ? h("span", { style: { ...T.hint, marginLeft: 8 } }, `并发 ${profile.concurrency}`)
              : null),
          today || month || Number.isFinite(Number(requests))
            ? h(Row, { label: "用量" },
                [today ? `今日 ${today}` : null, month ? `累计 ${month}` : null,
                 Number.isFinite(Number(requests)) ? `${requests} 次请求` : null]
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
        );
      }

      return h(Card, { title: "登录或注册", meta: state.apiBase },
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
            h("span", { style: T.hint },
              "没有账号会自动注册，注册后立即创建密钥 ", h("code", { style: T.mono }, state.keyName || "dsh"), " 并同步模型。"),
            h(Button, {
              variant: "ghost",
              size: "sm",
              onClick: () => setShowPromo((v) => !v),
              style: { marginLeft: "auto" },
            }, showPromo ? "取消优惠码" : "填写优惠码"),
          ),
        ),
      );
    }

    // -------------------------------------------------------------- key

    function KeyCard({ state, busy, onCreate, onReveal }) {
      const [revealed, setRevealed] = useState("");
      const [copied, setCopied] = useState(false);

      const copy = async () => {
        try {
          const text = revealed || (await onReveal()).key;
          setRevealed(text);
          if (text) await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard may be blocked; the value is still rendered.
        }
      };

      return h(Card, { title: "API 密钥", meta: state.hasKey ? "已保存" : "未创建" },
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
          h(Button, { onClick: copy, disabled: !state.loggedIn || !state.hasKey }, copied ? "已复制" : "复制"),
          h(Button, { onClick: onCreate, disabled: busy || !state.loggedIn }, state.hasKey ? "重建密钥" : "一键创建"),
        ),
        h("div", { style: { ...T.hint, marginTop: 10 } },
          "密钥固定命名为 ", h("code", { style: T.mono }, state.keyName || "dsh"),
          "，保存在本机凭据库；页面只显示掩码，「复制」时才临时取回明文。"),
      );
    }

    // --------------------------------------------------------- recharge

    const PRESETS = [10, 20, 50, 100];

    function RechargeCard({ state, busy, onRecharge, onPoll, onRefresh, onRedeem }) {
      const [amount, setAmount] = useState(20);
      const [custom, setCustom] = useState("");
      const [order, setOrder] = useState(null);
      const [status, setStatus] = useState(null);
      const [error, setError] = useState("");
      const [code, setCode] = useState("");
      const [redeemMsg, setRedeemMsg] = useState("");
      const timer = useRef(null);

      const multiplier = Number(state.rechargeMultiplier) > 0 ? Number(state.rechargeMultiplier) : 2;
      const value = custom !== "" ? Number(custom) : amount;
      const credit = Number.isFinite(value) ? value * multiplier : 0;
      const balance = state.profile ? Number(state.profile.balance) : NaN;

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

      const redeem = async () => {
        setRedeemMsg("");
        setError("");
        try {
          const result = await onRedeem(code.trim());
          setCode("");
          setRedeemMsg(result?.profile ? `已兑换，当前余额 ${money(result.profile.balance)}` : "兑换成功");
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      };

      return h(Card, {
        id: "sub2api-recharge",
        title: "余额与充值",
        meta: Number.isFinite(balance) ? "当前 " + money(balance) : null,
      },
        h("div", { style: { ...T.row, marginBottom: 12 } },
          h("span", { style: T.small }, `1 元 = ${multiplier.toFixed(2)} 元额度`),
          h("span", { style: { ...T.hint, marginLeft: "auto" } },
            Number.isFinite(balance) && balance <= 0 ? "余额为 0 时无法拉取模型" : ""),
        ),
        h("div", { style: { ...T.row, marginBottom: 12 } },
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
            style: { flex: "0 1 120px", minWidth: 100 },
          }),
        ),
        h("div", { style: { ...T.row, marginBottom: 12 } },
          h("span", { style: T.small }, "预计到账"),
          h("span", { style: { fontSize: 15, fontWeight: 600, color: C.text } }, money(credit)),
          h("div", { style: { marginLeft: "auto", display: "flex", gap: 8 } },
            h(Button, { onClick: onRefresh, disabled: !state.loggedIn }, "刷新余额"),
            h(Button, {
              variant: "primary",
              onClick: start,
              disabled: busy || !state.loggedIn || !Number.isFinite(value) || value <= 0,
            }, "去支付"),
          ),
        ),
        h("div", { style: T.hint },
          "「去支付」会在新标签页打开支付页，到账后余额自动更新；订单 30 分钟内有效。"),
        order
          ? h("div", { style: { marginTop: 12 } },
              h(Alert, {
                tone: status ? (status.tone === "done" ? "ok" : status.tone === "error" ? "error" : "info") : "info",
                title: "订单 " + order.orderNo,
                action: status && status.tone === "done" ? null : h(Button, {
                  size: "sm",
                  variant: "ghost",
                  onClick: () => setOrder(null),
                  style: { color: "inherit" },
                }, "关闭"),
              }, status ? status.text : "已打开支付页，等待付款…"))
          : null,
        h(Divider),
        h("div", { style: T.row },
          h(TextField, {
            placeholder: "兑换码",
            value: code,
            onChange: (e) => setCode(e.target.value),
            onKeyDown: (e) => { if (e.key === "Enter" && code.trim()) redeem(); },
            style: { flex: "1 1 200px" },
          }),
          h(Button, { onClick: redeem, disabled: busy || !state.loggedIn || !code.trim() }, "兑换"),
        ),
        redeemMsg ? h("div", { style: { ...T.hint, color: C.ok, marginTop: 8 } }, redeemMsg) : null,
        error ? h("div", { style: { marginTop: 10 } }, h(Alert, { tone: "error" }, error)) : null,
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
        await onSaveContext(model.id, value);
        setEditing(false);
        setDraft("");
      };

      return h("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 12px",
          borderTop: "0.5px solid " + C.line,
          fontSize: 13,
        },
      },
        h("input", { type: "checkbox", checked: checked, onChange: () => onToggle(model.id) }),
        h("code", {
          style: { ...T.mono, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
        }, model.id),
        editing
          ? h("span", { style: { display: "flex", gap: 6, alignItems: "center" } },
              h("input", {
                type: "number",
                min: 1,
                step: 1,
                placeholder: effective === null ? "" : String(Math.round(effective / 1000)),
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
              onClick: () => { setEditing(true); setDraft(effective === null ? "" : String(Math.round(effective / 1000))); },
              title: "点击修改上下文窗口",
              style: {
                border: "none", background: "transparent", padding: "2px 4px", cursor: "pointer",
                color: current.contextSource === "default" ? C.warn : C.muted, fontSize: 11.5,
              },
            }, contextBadge(current) ?? "设置"),
        Array.isArray(current.reasoningEfforts)
          ? h("span", { style: { ...T.hint, whiteSpace: "nowrap" } },
              "思考 " + current.reasoningEfforts.length + " 档")
          : null,
        shown.some((m) => m.id === model.id && m.vision) ? h("span", { style: T.hint }, "图片") : null,
      );
    }

    function ModelsCard({ state, busy, onRefreshModels, onReload, onGoRecharge, onSaveVisible, onSaveContext }) {
      const models = state.models || { models: [], all: [], allowed: [], fetchedAt: 0, stale: false, error: null };
      const shown = models.models || [];
      const everything = models.all || [];
      const allowed = models.allowed || [];
      const showingAll = allowed.length === 0;

      const [open, setOpen] = useState(false);
      const [error, setError] = useState("");
      const [draft, setDraft] = useState(null);
      const [saving, setSaving] = useState(false);
      const [saved, setSaved] = useState(false);
      const [query, setQuery] = useState("");

      const checked = draft ?? (showingAll ? everything.map((m) => m.id) : allowed);
      const isOn = (id) => checked.includes(id);
      const dirty = draft !== null;

      const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q === "" ? everything : everything.filter((m) => m.id.toLowerCase().includes(q));
      }, [everything, query]);

      const toggle = (id) => {
        setDraft(isOn(id) ? checked.filter((x) => x !== id) : [...checked, id]);
        setSaved(false);
      };

      const refresh = async () => {
        setError("");
        try {
          const result = await onRefreshModels();
          if (result && result.error) setError(result.error.message || String(result.error));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      };

      const save = async () => {
        setSaving(true);
        setError("");
        setSaved(false);
        try {
          const ids = checked.length === everything.length ? [] : checked;
          await onSaveVisible(ids);
          setDraft(null);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setSaving(false);
        }
      };

      const reason = error || models.error?.message || "";

      return h(Card, {
        title: "模型",
        meta: everything.length > 0
          ? `对话里显示 ${showingAll && !dirty ? everything.length : checked.length} / ${everything.length}`
          : "0 个",
      },
        models.needsRecharge
          ? h("div", { style: { marginBottom: 12 } },
              h(Alert, {
                tone: "warn",
                title: "余额不足，暂时拿不到模型列表",
                action: h(Button, {
                  size: "sm",
                  onClick: onGoRecharge,
                  style: { color: "inherit", borderColor: "currentColor", background: "transparent" },
                }, "去充值"),
              },
                "Sub2API 在余额为 0 时会拒绝 /v1/models。充值到账后这里会自动同步，无需重新登录。"))
          : null,

        !models.needsRecharge && reason
          ? h("div", { style: { marginBottom: 12 } }, h(Alert, { tone: "error", title: "同步失败" }, reason))
          : null,

        h("div", { style: { ...T.row, marginBottom: everything.length > 0 ? 12 : 0 } },
          h(Button, { onClick: refresh, disabled: busy || !state.loggedIn }, busy ? "同步中…" : "刷新模型"),
          h(Button, { onClick: () => setOpen((v) => !v), disabled: everything.length === 0 },
            open ? "收起选择" : "选择模型"),
          models.stale && everything.length > 0 ? h("span", { style: T.hint }, "缓存已过期") : null,
        ),

        open && everything.length > 0
          ? h("div", null,
              everything.length > 8
                ? h("div", { style: { marginBottom: 8 } },
                    h(TextField, {
                      placeholder: "搜索模型",
                      value: query,
                      onChange: (e) => setQuery(e.target.value),
                    }))
                : null,
              h("div", {
                style: {
                  maxHeight: 300,
                  overflow: "auto",
                  border: "0.5px solid " + C.line,
                  borderRadius: 12,
                },
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
                h(Button, { size: "sm", onClick: () => { setDraft(everything.map((m) => m.id)); setSaved(false); } }, "全选"),
                h(Button, { size: "sm", onClick: () => { setDraft([]); setSaved(false); } }, "全不选"),
                h(Button, { size: "sm", onClick: () => { setDraft(null); setSaved(false); } }, "还原"),
                h("div", { style: { marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" } },
                  saved ? h("span", { style: { ...T.hint, color: C.ok } }, "已保存") : null,
                  h(Button, { variant: "primary", size: "sm", onClick: save, disabled: !dirty || saving },
                    saving ? "保存中…" : "保存选择"),
                ),
              ),
            )
          : null,

        h("div", { style: { ...T.hint, marginTop: 10 } },
          everything.length === 0
            ? "目录来自上游 /v1/models，登录后自动同步。"
            : "勾选的模型会出现在对话的模型选择器里；点容量数字可以手动改这个模型的上下文窗口。"),
      );
    }

    // ---------------------------------------------------------- diagnose

    function DiagnoseCard({ state, onDiagnose }) {
      const [result, setResult] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");

      const run = async () => {
        setBusy(true);
        setError("");
        try {
          setResult(await onDiagnose());
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      };

      return h(Card, {
        title: "诊断",
        meta: state.version ? "v" + state.version : null,
        aside: result
          ? h("span", { style: { ...T.meta, color: result.ok ? C.ok : C.warn } }, result.summary)
          : null,
      },
        h("div", { style: T.row },
          h(Button, { onClick: run, disabled: busy || !state.loggedIn }, busy ? "检查中…" : "运行诊断"),
        ),
        error ? h("div", { style: { marginTop: 10 } }, h(Alert, { tone: "error" }, error)) : null,
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
                  h("span", { style: { flex: 1, minWidth: 0, color: check.ok ? C.text : C.warn } }, check.detail ?? (check.ok ? "正常" : "失败")),
                )))
          : null,
        h("div", { style: { ...T.hint, marginTop: 10 } },
          "诊断会依次检查登录、令牌、密钥、余额、密钥分组和模型目录，把失败的那一项直接指出来。"),
      );
    }

    // ------------------------------------------------------------- root

    function SectionInner() {
      const [state, setState] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [steps, setSteps] = useState(null);
      const [ready, setReady] = useState(undefined);
      const [announcements, setAnnouncements] = useState([]);

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

      // A top-up usually happens on the payment site, so the panel has to
      // notice the new balance by itself: the host turns that into a model
      // sync, and this poll is what makes it appear without a manual refresh.
      useEffect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState !== "hidden") refresh();
        }, 45000);
        return () => clearInterval(timer);
      }, [refresh]);

      useEffect(() => {
        let cancelled = false;
        call("/announcements")
          .then((data) => { if (!cancelled) setAnnouncements(Array.isArray(data.items) ? data.items : []); })
          .catch(() => {});
        return () => { cancelled = true; };
      }, [state && state.loggedIn]);

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
        setReady(data.ready);
        return data;
      }), [wrap]);

      const onLogout = useCallback(() => wrap(async () => {
        const data = await call("/logout", { method: "POST", body: {} });
        setState(data.state);
        setSteps(null);
        setReady(undefined);
      }), [wrap]);

      const onCreateKey = useCallback(() => wrap(async () => {
        const force = !!(state && state.hasKey);
        const data = await call("/key", { method: "POST", body: force ? { force: true } : {} });
        setState(data.state);
      }), [wrap, state]);

      const onReveal = useCallback(() => call("/key/reveal", { method: "POST", body: {} }), []);

      const onRefreshModels = useCallback(() => wrap(async () => {
        const result = await call("/models/refresh", { method: "POST", body: {} });
        await refresh();
        return result;
      }), [wrap, refresh]);

      const onSaveVisible = useCallback((ids) => wrap(async () => {
        await call("/models/visible", { method: "POST", body: { ids } });
        await refresh();
      }), [wrap, refresh]);

      const onSaveContext = useCallback(async (id, contextWindow) => {
        await call("/models/context", { method: "POST", body: { id, contextWindow } });
        await refresh();
      }, [refresh]);

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
      const onRefresh = useCallback(() => refresh(), [refresh]);

      if (state === null) {
        if (error) {
          return h("div", { style: { padding: "4px 0 18px" } },
            h(Card, { title: "Sub2API" },
              h(Alert, { tone: "error", title: "面板无法连接插件后端" }, error),
              h("div", { style: { ...T.hint, marginTop: 12 } },
                "常见原因：插件装上了但宿主那一半没有加载（版本不匹配、依赖缺失、或安装后没有重启）。"),
              h("div", { style: { ...T.hint, marginTop: 6 } },
                "排查：在 DSH 终端执行 ", h("code", { style: T.mono }, "dsh plugin list"),
                " 确认已安装；重启 DSH 后再打开这里。"),
              h("div", { style: { marginTop: 12 } },
                h(Button, { onClick: () => refresh() }, "重试")),
            ),
          );
        }
        return h("div", { style: { padding: 18, color: C.muted, fontSize: 13 } }, "加载中…");
      }

      const unread = announcements.filter((item) => !item.is_read);

      return h("div", { style: { padding: "4px 0 18px" } },
        unread.length > 0
          ? h("div", { style: { marginBottom: 12 } },
              h(Alert, { tone: "info", title: unread[0].title ?? "站点公告" },
                asText(unread[0].content ?? unread[0].body ?? "").slice(0, 200)))
          : null,
        h(AccountCard, { state, busy, steps, ready, onAuth, onLogout }),
        h(KeyCard, { state, busy, onCreate: onCreateKey, onReveal }),
        h(RechargeCard, { state, busy, onRecharge, onPoll, onRefresh, onRedeem }),
        h(ModelsCard, {
          state,
          busy,
          onRefreshModels,
          onReload: refresh,
          onSaveVisible,
          onSaveContext,
          onGoRecharge: () => {
            const target = document.getElementById("sub2api-recharge");
            if (target && typeof target.scrollIntoView === "function") {
              target.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          },
        }),
        h(DiagnoseCard, { state, onDiagnose }),
        error ? h(Alert, { tone: "error" }, error) : null,
      );
    }

    function Section() {
      return h(Boundary, null, h(SectionInner, null));
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
        h("span", { style: { fontWeight: 600, color: C.text } }, "Sub2API"),
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
