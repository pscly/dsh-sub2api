/**
 * Recharge hand-off to the pay centre.
 *
 * The pay centre is a separate Laravel service. It only renders the embedded
 * recharge form when the caller proves who the user is: a `user_id` plus a
 * sub2api access token, which it validates by calling
 * `GET {sub2api}/api/v1/user/profile`. A bare link therefore answers 403 — that
 * is the whole reason this module exists instead of the settings page simply
 * opening a URL.
 *
 * Two levels are offered:
 *  - {@link buildRechargeLink}: hand the user a signed-in URL and let the pay
 *    page collect the amount. No CSRF handling, no local state.
 *  - {@link createRechargeOrder}: pick the amount here, then walk the CSRF
 *    handshake (`GET` for the cookie, `X-XSRF-TOKEN` on the `POST`) so the user
 *    lands directly on the checkout page and the panel knows the order number
 *    to poll.
 * @module dsh-sub2api/pay
 */

import { Sub2ApiError } from "./util.js";

const EMBEDDED_PATH = "/embedded/sub-recharge";

/**
 * The URL that makes the embedded recharge page work.
 * @param {object} deps
 * @param {string} deps.payBase
 * @param {number|string} deps.userId
 * @param {string} deps.token sub2api access token
 * @param {"light"|"dark"} [deps.theme]
 * @param {string} [deps.lang]
 * @param {string} [deps.srcHost]
 * @param {string} [deps.srcUrl]
 * @returns {string}
 */
export function buildRechargeLink(deps) {
  const url = new URL(`${deps.payBase}${EMBEDDED_PATH}`);
  url.searchParams.set("user_id", String(deps.userId));
  url.searchParams.set("token", deps.token);
  url.searchParams.set("ui_mode", "embedded");
  url.searchParams.set("lang", deps.lang ?? "zh");
  url.searchParams.set("theme", deps.theme ?? "light");
  if (deps.srcHost) url.searchParams.set("src_host", deps.srcHost);
  if (deps.srcUrl) url.searchParams.set("src_url", deps.srcUrl);
  return url.toString();
}

/**
 * Create an order for a chosen amount and return the checkout URL.
 *
 * The pay centre is a server-rendered form guarded by Laravel's CSRF check, so
 * the handshake is: `GET` the form (which also validates the token and returns
 * 403 when it is stale), keep the cookies, then `POST` the amount back with
 * `X-XSRF-TOKEN`. `redirect: "manual"` exposes the `Location` header instead of
 * silently following it.
 *
 * @param {object} deps
 * @param {string} deps.payBase
 * @param {number|string} deps.userId
 * @param {string} deps.token
 * @param {number} deps.amountYuan positive, two decimals at most
 * @param {string} [deps.srcUrl] where the pay page sends the user back
 * @param {"light"|"dark"} [deps.theme]
 * @param {number} [deps.timeoutMs]
 * @param {typeof fetch} [deps.fetchImpl]
 * @returns {Promise<{checkoutUrl: string, orderNo: string, expires: number, checkoutToken: string}>}
 */
export async function createRechargeOrder(deps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 20000;
  const amountYuan = Number(deps.amountYuan);

  if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
    throw new Sub2ApiError("请输入大于 0 的充值金额", { code: "invalid_amount" });
  }
  if (amountYuan > 100000) {
    throw new Sub2ApiError("单笔充值金额过大", { code: "invalid_amount" });
  }

  const link = buildRechargeLink({
    payBase: deps.payBase,
    userId: deps.userId,
    token: deps.token,
    theme: deps.theme,
    srcUrl: deps.srcUrl,
  });

  // 1) The form page: it both validates the token and hands out the CSRF cookie.
  const form = await call(fetchImpl, link, { method: "GET", timeoutMs });
  if (!form.ok) {
    throw new Sub2ApiError(await payFailureMessage(form, "打开充值页失败"), {
      status: form.status,
      code: "pay_rejected",
    });
  }

  const cookies = form.headers.getSetCookie?.() ?? [];
  const cookieHeader = cookies.map((entry) => entry.split(";")[0]).join("; ");
  const xsrfRaw = cookies.find((entry) => entry.startsWith("XSRF-TOKEN="));
  if (!xsrfRaw) {
    throw new Sub2ApiError("充值页没有下发 CSRF 凭证", { code: "pay_no_csrf" });
  }
  const xsrf = decodeURIComponent(xsrfRaw.split(";")[0].slice("XSRF-TOKEN=".length));

  // 2) The order: same endpoint, form-encoded, manual redirect.
  const body = new URLSearchParams({
    user_id: String(deps.userId),
    token: deps.token,
    amount_yuan: amountYuan.toFixed(2),
    ui_mode: "embedded",
    lang: "zh",
    theme: deps.theme ?? "light",
  });
  if (deps.srcUrl) body.set("src_url", deps.srcUrl);

  const created = await call(fetchImpl, `${deps.payBase}${EMBEDDED_PATH}`, {
    method: "POST",
    timeoutMs,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-XSRF-TOKEN": xsrf,
      ...(cookieHeader === "" ? {} : { Cookie: cookieHeader }),
    },
    body: body.toString(),
    redirect: "manual",
  });

  const location = created.headers.get("location");
  if (!location) {
    throw new Sub2ApiError(await payFailureMessage(created, "生成充值订单失败"), {
      status: created.status,
      code: "pay_no_order",
    });
  }

  const checkout = new URL(location, deps.payBase);
  const orderNo = checkout.pathname.split("/").filter(Boolean).pop() ?? "";
  if (orderNo === "") {
    throw new Sub2ApiError("充值页返回的订单地址无法解析", { code: "pay_bad_order" });
  }

  return {
    checkoutUrl: checkout.toString(),
    orderNo,
    expires: Number(checkout.searchParams.get("expires")) || 0,
    checkoutToken: checkout.searchParams.get("token") ?? "",
  };
}

/**
 * Read one order's progress. The pay centre signs this URL too, so the caller
 * must pass back the `expires`/`token` pair it received at creation.
 * @param {object} deps
 * @param {string} deps.payBase
 * @param {string} deps.orderNo
 * @param {number} deps.expires
 * @param {string} deps.checkoutToken
 * @param {number} [deps.timeoutMs]
 * @param {typeof fetch} [deps.fetchImpl]
 * @returns {Promise<{status?: string, delivery_status?: string, is_expired?: boolean, message?: string, notice?: string}>}
 */
export async function fetchOrderStatus(deps) {
  const url = new URL(`${deps.payBase}/checkout/${encodeURIComponent(deps.orderNo)}/status`);
  url.searchParams.set("expires", String(deps.expires));
  url.searchParams.set("token", deps.checkoutToken);

  const response = await call(deps.fetchImpl ?? fetch, url.toString(), {
    method: "GET",
    timeoutMs: deps.timeoutMs ?? 15000,
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Sub2ApiError(`查询订单状态失败（HTTP ${response.status}）`, {
      status: response.status,
      code: "pay_status_failed",
    });
  }

  const payload = await response.json().catch(() => undefined);
  const data = payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
  return data && typeof data === "object" ? data : {};
}

/**
 * Turn the pay centre's status payload into the one line a user should read.
 * @param {{status?: string, delivery_status?: string, is_expired?: boolean, message?: string, notice?: string}} data
 * @returns {{tone: "pending"|"progress"|"done"|"error", text: string, detail?: string}}
 */
export function describeOrderStatus(data) {
  const status = String(data?.status ?? "").toLowerCase();
  const delivery = String(data?.delivery_status ?? "").toLowerCase();

  if (data?.is_expired === true || status === "expired") {
    return { tone: "error", text: "订单已过期，请重新发起", detail: data?.notice ?? undefined };
  }
  if (status === "rejected") {
    return { tone: "error", text: "订单未通过", detail: data?.notice ?? "请联系客服" };
  }
  if (status === "approved" && delivery === "succeeded") {
    return { tone: "done", text: "已到账", detail: data?.notice ?? "余额已更新" };
  }
  if (status === "approved") {
    return { tone: "progress", text: "已确认收款，正在入账", detail: data?.message ?? undefined };
  }
  if (status === "pending" && data?.payment_notified_at) {
    return { tone: "progress", text: "已提交支付通知，正在确认到账", detail: data?.message ?? undefined };
  }
  return { tone: "pending", text: "等待付款", detail: data?.message ?? undefined };
}

/** One fetch with a deadline, normalized into a Response. */
async function call(fetchImpl, url, init) {
  const { timeoutMs = 20000, ...rest } = init;
  try {
    return await fetchImpl(url, { ...rest, signal: AbortSignal.timeout(Math.max(1, timeoutMs)) });
  } catch (error) {
    throw new Sub2ApiError(`支付服务不可达：${error instanceof Error ? error.message : String(error)}`, {
      code: "pay_unreachable",
      cause: error,
    });
  }
}

/**
 * Extract a human-readable reason from a pay-centre error page. The service
 * answers HTML (Laravel's error view), so the visible text is the only clue.
 */
async function payFailureMessage(response, fallback) {
  const text = await response.text().catch(() => "");
  const visible = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // The pay centre spells the site name its own way; accept either, because the
  // two services are deployed separately and their wording can drift.
  const known = visible.match(
    /(缺少 (?:Psapi|Sub2API) 用户上下文|(?:Psapi|Sub2API) 用户校验失败[^ ]*|(?:Psapi|Sub2API) 用户身份不匹配)/,
  );
  if (known) return known[0];
  if (response.status === 403) return `${fallback}：登录状态已失效（403）`;
  if (response.status === 419) return `${fallback}：支付页会话过期（419）`;
  return `${fallback}（HTTP ${response.status}）`;
}
