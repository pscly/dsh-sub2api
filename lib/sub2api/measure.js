/**
 * Measure a model's context window by asking the gateway.
 *
 * `/v1/models` from sub2api carries no capacity field at all, so the only
 * authority is the model itself: send a prompt larger than its window and the
 * upstream rejects it before generating, usually naming the limit. Models that
 * only say "your input exceeds the context window" are narrowed by bisection
 * between the largest size that passed and the smallest that failed.
 *
 * Rejected requests are not billed; a probe that *succeeds* is, which is why the
 * ladder starts small and stops at the first rejection.
 *
 * @module dsh-sub2api/sub2api/measure
 */

import { Sub2ApiError } from "../util.js";

/** Sizes to try, smallest first. The first rejection brackets the limit. */
const LADDER = [65_536, 131_072, 262_144, 524_288, 1_048_576, 2_097_152];

const TOO_BIG = /exceed|too long|longer than|maximum context|context window|prompt is too long/i;
const DEAD = /not supported by any configured account|isn't included|must be called via/i;

/**
 * One probe: a prompt of `tokens` repeated words, asking for a single output
 * token so a successful request stays as cheap as it can be.
 * @param {object} options
 * @param {string} options.apiBase
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {number} options.tokens
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ok: boolean, status: number, body: string}>}
 */
async function probe({ apiBase, apiKey, model, tokens, signal }) {
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: "a ".repeat(tokens) }],
    max_tokens: 1,
    stream: false,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(`${String(apiBase).replace(/\/+$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    const text = (await response.text()).slice(0, 600);
    return { ok: response.ok, status: response.status, body: text };
  } catch (error) {
    return { ok: false, status: 0, body: String(error?.message ?? error).slice(0, 200) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * @param {{ok: boolean, status: number, body: string}} result
 * @returns {"ok"|"too_big"|"dead"|"transient"|"other"}
 */
function classify(result) {
  if (result.ok) return "ok";
  if (DEAD.test(result.body)) return "dead";
  if (TOO_BIG.test(result.body)) return "too_big";
  if (result.status >= 500) return "transient";
  return "other";
}

/**
 * Measure one model's context window.
 *
 * The returned value is the smallest size known to be rejected, so it is never
 * larger than the real limit — over-claiming is what makes the host compact too
 * late and the upstream answer with a 400.
 *
 * @param {object} options
 * @param {string} options.apiBase
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{contextWindow: number, probes: Array<{size: number, verdict: string}>}>}
 */
export async function measureContext({ apiBase, apiKey, model, signal }) {
  const id = String(model ?? "").trim();
  if (id === "") throw new Sub2ApiError("缺少模型 id", { code: "invalid_model" });

  const probes = [];
  let low = 0;
  let high;

  for (const size of LADDER) {
    if (signal?.aborted === true) break;
    const result = await probe({ apiBase, apiKey, model: id, tokens: size, signal });
    const verdict = classify(result);
    probes.push({ size, verdict });

    if (verdict === "ok") {
      low = size;
      continue;
    }
    if (verdict === "too_big") {
      high = size;
      break;
    }
    // Dead route or an upstream fault: measuring is pointless until that is
    // fixed, and retrying just burns time.
    throw new Sub2ApiError(
      verdict === "dead"
        ? `${id}：网关没有能服务这个模型的账号`
        : `${id}：上游不可用（HTTP ${result.status}）`,
      { code: verdict === "dead" ? "model_not_found" : "upstream", status: result.status },
    );
  }

  if (high === undefined) {
    if (low === 0) throw new Sub2ApiError(`${id}：没有测出容量`, { code: "unmeasurable" });
    // Passed the whole ladder: the limit is above what we were willing to send.
    return { contextWindow: low, probes };
  }

  // Narrow the bracket to ~4% before reporting it.
  while (high - low > Math.max(4096, low * 0.04)) {
    if (signal?.aborted === true) break;
    const mid = Math.floor((low + high) / 2);
    const result = await probe({ apiBase, apiKey, model: id, tokens: mid, signal });
    const verdict = classify(result);
    probes.push({ size: mid, verdict });
    if (verdict === "too_big") high = mid;
    else if (verdict === "ok") low = mid;
    else break;
  }

  return { contextWindow: high, probes };
}
