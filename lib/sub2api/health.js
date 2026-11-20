/**
 * Which models the gateway can actually serve right now.
 *
 * A sub2api catalogue is not a promise: the group lists models that no
 * configured account can serve, so choosing one fails with 502 or 404 only when
 * the user presses send. A one-token request answers the same question in about
 * a tenth of a second and costs a handful of tokens, which is cheap enough to
 * run whenever the catalogue refreshes.
 *
 * @module dsh-sub2api/sub2api/health
 */

import { Sub2ApiError } from "../util.js";

/**
 * Models a chat completion cannot judge: image and video generators never
 * answer one, and probing them only wastes the sweep's time budget.
 */
const NON_CHAT = /(?:^|[-_/])(?:image|video|embed|embedding|tts|speech|whisper|rerank)(?:$|[-_/])/i;

/** A model the gateway could not route at all. */
const DEAD = /not supported by any configured account|isn't included|model_not_found|must be called via/i;

/**
 * @typedef {object} HealthResult
 * @property {boolean} ok
 * @property {number} [status]
 * @property {string} [reason] short, shown in the panel
 */

/**
 * Ask for one token from `model`.
 * @param {object} options
 * @param {string} options.apiBase
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<HealthResult>}
 */
async function probeOne({ apiBase, apiKey, model, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(`${String(apiBase).replace(/\/+$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (response.ok) {
      await response.text();
      return { ok: true, status: response.status };
    }

    const body = (await response.text()).slice(0, 400);
    if (response.status === 429) return { ok: true, status: 429, reason: "限流" };
    if (DEAD.test(body)) return { ok: false, status: response.status, reason: "网关没有可用账号" };
    if (response.status >= 500) {
      return { ok: false, status: response.status, reason: "上游不可用" };
    }
    // 400/401/403 on a one-token request is about the request, not the route.
    return { ok: true, status: response.status, reason: "请求被拒绝但不代表模型不可用" };
  } catch (error) {
    // A timeout says nothing about whether the model works — an image or video
    // model never answers a chat completion at all. Keep it in the picker and
    // say so, rather than hiding something that may be perfectly usable.
    const aborted = error?.name === "AbortError";
    return { ok: true, status: 0, reason: aborted ? "探测超时，未判定" : "探测失败，未判定" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Probe every model, a few at a time.
 *
 * @param {object} options
 * @param {string} options.apiBase
 * @param {string} options.apiKey
 * @param {string[]} options.models
 * @param {number} [options.concurrency]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Map<string, HealthResult>>}
 */
export async function checkAvailability({ apiBase, apiKey, models, concurrency = 6, signal }) {
  if (typeof apiKey !== "string" || apiKey === "") {
    throw new Sub2ApiError("还没有密钥，无法检查可用性", { code: "no_api_key" });
  }

  const queue = [...new Set(models.map((id) => String(id ?? "")).filter(Boolean))].filter(
    (id) => !NON_CHAT.test(id),
  );
  /** @type {Map<string, HealthResult>} */
  const results = new Map();

  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (next < queue.length) {
      if (signal?.aborted === true) return;
      const model = queue[next];
      next += 1;
      results.set(model, await probeOne({ apiBase, apiKey, model, signal }));
    }
  });

  await Promise.all(workers);
  return results;
}
