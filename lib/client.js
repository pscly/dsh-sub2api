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
        throw new ApiError("HTTP " + response.status + "：响应不是 JSON");
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
      cardHead: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 18px 12px",
        borderBottom: "0.5px solid " + C.line,
      },
      cardTitle: { margin: 0, fontSize: 14, fontWeight: 600, lineHeight: "22px", color: C.text },
      cardBody: { padding: "16px 18px" },
      meta: { marginLeft: "auto", fontSize: 12, lineHeight: "18px", color: C.muted },
      label: { fontSize: 13, fontWeight: 500, lineHeight: "20px", color: C.second },
      hint: { fontSize: 12, lineHeight: "18px", color: C.muted },
      small: { fontSize: 12, lineHeight: "18px", color: C.second },
      row: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
      mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 },
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
        danger: { border: "0.5px solid " + C.line, background: "transparent", color: C.bad },
      };
      return h("button", { style: { ...base, ...(variants[variant] || {}), ...style }, ...rest }, children);
    }

    function Card({ title, meta, children, bodyStyle, id }) {
      return h("section", { id, style: T.card },
        title
          ? h("div", { style: T.cardHead },
              h("h3", { style: T.cardTitle }, title),
              meta ? h("span", { style: T.meta }, meta) : null)
          : null,
        h("div", { style: { ...T.cardBody, ...bodyStyle } }, children),
      );
    }

    /** A labelled input with an optional trailing control and a focus ring. */
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
            boxShadow: focused ? "0 0 0 3px " + "color-mix(in srgb, " + C.accent + " 14%, transparent)" : "none",
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

    function money(value) {
      const n = Number(value);
      return Number.isFinite(n) ? "$" + n.toFixed(2) : "—";
    }

    function Divider() {
      return h("div", { style: { height: 1, background: C.line, margin: "14px 0" } });
    }

    // ---------------------------------------------------------- account

    /** Never hand React an object: it would render "[object Object]". */
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
        const balance = state.profile ? state.profile.balance : undefined;
        return h(Card, {
          title: "账户",
          meta: state.apiBase,
        },
          h("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } },
            h("div", { style: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } },
              h("span", { style: { fontSize: 14, fontWeight: 600, color: C.text } },
                state.email || user.email || "已登录"),
              h("span", { style: T.hint }, "余额 " + money(balance)),
            ),
            h("div", { style: { marginLeft: "auto" } },
              h(Button, { onClick: onLogout, disabled: busy }, "退出登录")),
          ),
          Array.isArray(state.subscriptions?.subscriptions) && state.subscriptions.subscriptions.length > 0
            ? h("div", { style: { marginTop: 12 } },
                h(Alert, { tone: "info" },
                  state.subscriptions.subscriptions
                    .map((s) => `${s.group_name || "订阅"} · 剩余 ${s.days_remaining ?? "?"} 天`)
                    .join("　")))
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
          h(Button, { onClick: copy, disabled: !state.loggedIn || !state.hasKey },
            copied ? "已复制" : "复制"),
          h(Button, { onClick: onCreate, disabled: busy || !state.loggedIn },
            state.hasKey ? "重建密钥" : "一键创建"),
        ),
        h("div", { style: { ...T.hint, marginTop: 10 } },
          "密钥固定命名为 ", h("code", { style: T.mono }, state.keyName || "dsh"),
          "，保存在本机凭据库；页面只显示掩码，「复制」时才临时取回明文。"),
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

      return h(Card, {
        id: "sub2api-recharge",
        title: "余额与充值",
        meta: Number.isFinite(balance) ? "当前 " + money(balance) : null,
      },
        h("div", { style: { ...T.row, marginBottom: 12 } },
          h("span", { style: T.small }, "1 元 = 2.00 美元额度"),
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
        error ? h("div", { style: { marginTop: 10 } }, h(Alert, { tone: "error" }, error)) : null,
      );
    }

    // ------------------------------------------------------------ models

    /**
     * Show the capacity the host will actually use, and say where it came from:
     * a defaulted figure is the difference between "chat works" and "the model
     * cannot be switched to".
     */
    function contextBadge(model) {
      if (!model || !model.contextWindow) return null;
      const k = Math.round(Number(model.contextWindow) / 1000);
      const source = model.contextSource;
      const label = source === "default" ? "默认" : source === "known" ? "实测" : null;
      return h("span", {
        style: {
          fontSize: 11.5,
          color: source === "default" ? C.warn : C.muted,
          whiteSpace: "nowrap",
        },
      }, k + "k" + (label ? " · " + label : ""));
    }

    function ModelsCard({ state, busy, onRefreshModels, onReload, onGoRecharge }) {
      const models = state.models || { models: [], all: [], allowed: [], fetchedAt: 0, stale: false, error: null };
      const shown = models.models || [];
      const everything = models.all || [];
      const allowed = models.allowed || [];
      const showingAll = allowed.length === 0;

      const [open, setOpen] = useState(false);
      const [error, setError] = useState("");
      const [draft, setDraft] = useState(null); // null = untouched
      const [saving, setSaving] = useState(false);
      const [saved, setSaved] = useState(false);

      const checked = draft ?? (showingAll ? everything.map((m) => m.id) : allowed);
      const isOn = (id) => checked.includes(id);
      const dirty = draft !== null;

      const toggle = (id) => {
        const next = isOn(id) ? checked.filter((x) => x !== id) : [...checked, id];
        setDraft(next);
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
          // Every model selected is the same as no restriction.
          const ids = checked.length === everything.length ? [] : checked;
          await call("/models/visible", { method: "POST", body: { ids } });
          // Saving only changes the allowlist, so re-read the panel state
          // instead of asking the upstream for its catalog again.
          await onReload();
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
              h("div", {
                style: {
                  maxHeight: 260,
                  overflow: "auto",
                  border: "0.5px solid " + C.line,
                  borderRadius: 12,
                },
              },
                everything.map((model) =>
                  h("label", {
                    key: model.id,
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 12px",
                      borderTop: "0.5px solid " + C.line,
                      cursor: "pointer",
                      fontSize: 13,
                    },
                  },
                    h("input", {
                      type: "checkbox",
                      checked: isOn(model.id),
                      onChange: () => toggle(model.id),
                    }),
                    h("code", { style: { ...T.mono, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } }, model.id),
                    contextBadge(shown.find((m) => m.id === model.id) ?? model),
                    shown.some((m) => m.id === model.id && m.vision) ? h("span", { style: T.hint }, "图片") : null,
                  ),
                )),
              h("div", { style: { ...T.row, marginTop: 10 } },
                h(Button, { size: "sm", onClick: () => { setDraft(everything.map((m) => m.id)); setSaved(false); } }, "全选"),
                h(Button, { size: "sm", onClick: () => { setDraft([]); setSaved(false); } }, "全不选"),
                h(Button, { size: "sm", onClick: () => { setDraft(null); setSaved(false); } }, "还原"),
                h("div", { style: { marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" } },
                  saved ? h("span", { style: { ...T.hint, color: C.ok } }, "已保存") : null,
                  h(Button, {
                    variant: "primary",
                    size: "sm",
                    onClick: save,
                    disabled: !dirty || saving,
                  }, saving ? "保存中…" : "保存选择"),
                ),
              ),
            )
          : null,

        h("div", { style: { ...T.hint, marginTop: 10 } },
          everything.length === 0
            ? "目录来自上游 /v1/models，登录后自动同步。"
            : "勾选的模型会出现在对话的模型选择器里；全部勾选等于不做限制。"),
      );
    }

    // ------------------------------------------------------------- root

    function Section() {
      const [state, setState] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [steps, setSteps] = useState(null);
      const [ready, setReady] = useState(undefined);

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

      const onRecharge = useCallback(async (amountYuan) => {
        try {
          return await call("/recharge", { method: "POST", body: { amountYuan } });
        } catch {
          const link = await call("/recharge/link", { method: "POST", body: {} });
          return { url: link.url, orderNo: null };
        }
      }, []);

      const onPoll = useCallback((orderNo) => call("/recharge/status", { method: "POST", body: { orderNo } }), []);
      const onRefresh = useCallback(() => refresh(), [refresh]);

      if (state === null) {
        return h("div", { style: { padding: 18, color: C.muted, fontSize: 13 } },
          error ? h(Alert, { tone: "error" }, error) : "加载中…");
      }

      return h("div", { style: { padding: "4px 0 18px" } },
        h(AccountCard, { state, busy, steps, ready, onAuth, onLogout }),
        h(KeyCard, { state, busy, onCreate: onCreateKey, onReveal }),
        h(RechargeCard, { state, busy, onRecharge, onPoll, onRefresh }),
        h(ModelsCard, {
          state,
          busy,
          onRefreshModels,
          onReload: refresh,
          onGoRecharge: () => {
            const target = document.getElementById("sub2api-recharge");
            if (target && typeof target.scrollIntoView === "function") {
              target.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          },
        }),
        error ? h(Alert, { tone: "error" }, error) : null,
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
