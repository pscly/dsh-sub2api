/**
 * Measure the context window of every model a sub2api gateway lists.
 *
 * `/v1/models` from sub2api returns ids and nothing else, so the plugin cannot
 * know a model's capacity from the API. This script asks the gateway directly:
 *
 *   1. Send a prompt larger than the model's window. The upstream rejects it
 *      before generating, and most reply with the limit in the message.
 *   2. Models that only say "your input exceeds the context window" are
 *      narrowed by bisection between the largest size that passed and the
 *      smallest that failed.
 *
 * Rejected requests are not billed. A model that answers instead of rejecting
 * does get billed for its input, which is what the ladder tries to avoid.
 *
 * Usage:
 *   node scripts/measure-context.mjs --key sk-... [--base https://host] \
 *        [--out /tmp/ctx.json] [--only model-a,model-b]
 *
 * Then regenerate the table the plugin ships:
 *   node scripts/build-context-table.mjs /tmp/ctx.json
 */

import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const key = flag("key", process.env.SUB2API_API_KEY);
const base = String(flag("base", process.env.SUB2API_BASE ?? "https://sub.pscly.cc")).replace(/\/+$/, "");
const out = flag("out", "/tmp/ctx.json");
const only = flag("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!key) {
  console.error("缺少 --key（或环境变量 SUB2API_API_KEY）");
  process.exit(1);
}

/** Sizes to try, smallest first: the first rejection brackets the limit. */
const LADDER = [65_536, 131_072, 262_144, 524_288, 1_048_576, 2_097_152, 4_194_304];

const TOO_BIG = /exceed|too long|longer than|maximum context|context window|prompt is too long/i;
const DEAD = /not supported by any configured account|isn't included|must be called via/i;

/**
 * @param {string} model
 * @param {number} tokens
 * @returns {Promise<{ok: boolean, status: number, body: string}>}
 */
async function probe(model, tokens) {
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: "a ".repeat(tokens) }],
    max_tokens: 1,
    stream: false,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  try {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    const text = (await response.text()).slice(0, 600);
    return { ok: response.ok, status: response.status, body: text };
  } catch (error) {
    return { ok: false, status: 0, body: String(error?.message ?? error).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** @returns {"ok"|"too_big"|"dead"|"transient"|"other"} */
function classify(result) {
  if (result.ok) return "ok";
  if (DEAD.test(result.body)) return "dead";
  if (TOO_BIG.test(result.body)) return "too_big";
  if (result.status >= 500) return "transient";
  return "other";
}

const listResponse = await fetch(`${base}/v1/models`, {
  headers: { Authorization: `Bearer ${key}` },
});
if (!listResponse.ok) {
  console.error(`读取模型目录失败：HTTP ${listResponse.status} ${(await listResponse.text()).slice(0, 200)}`);
  process.exit(1);
}
const listed = (await listResponse.json()).data ?? [];
const targets = only.length > 0 ? listed.filter((m) => only.includes(m.id)) : listed;
console.log(`待测 ${targets.length} 个模型，网关 ${base}`);

/** @type {Record<string, unknown>} */
const results = {};
for (const [index, model] of targets.entries()) {
  const record = { probes: [] };
  let low = 0;
  let high;

  for (const size of LADDER) {
    const result = await probe(model.id, size);
    const verdict = classify(result);
    record.probes.push({ size, verdict, status: result.status });
    if (verdict === "ok") {
      low = size;
      continue;
    }
    if (verdict === "too_big") {
      high = size;
      break;
    }
    record.note = result.body.slice(0, 160);
    record.dead = verdict === "dead";
    break;
  }

  if (high !== undefined) {
    while (high - low > Math.max(4096, low * 0.04)) {
      const mid = Math.floor((low + high) / 2);
      const result = await probe(model.id, mid);
      const verdict = classify(result);
      record.probes.push({ size: mid, verdict, status: result.status });
      if (verdict === "too_big") high = mid;
      else if (verdict === "ok") low = mid;
      else break;
    }
    record.context = high;
    record.low = low;
  } else if (low > 0) {
    record.context = low;
    record.atLeast = true;
  }

  results[model.id] = record;
  const shown = record.context ? record.context.toLocaleString() : (record.note ?? "").slice(0, 40);
  console.log(`[${index + 1}/${targets.length}] ${model.id.padEnd(34)} ${shown}`);
  await writeFile(out, JSON.stringify(results, null, 1), "utf8");
}

const measured = Object.values(results).filter((r) => Number(r.context) > 0).length;
console.log(`\n完成：${measured}/${targets.length} 个测到容量，写入 ${out}`);
console.log(`生成插件用表：node scripts/build-context-table.mjs ${out}`);
