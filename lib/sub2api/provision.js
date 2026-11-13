/**
 * Provisioning: turn a fresh login into a working provider.
 *
 * After a successful sign-in the plugin needs four things before the model
 * picker can offer anything: the account snapshot, the groups the account may
 * bind to, one API key in that group, and the upstream catalog behind it.
 * Each step reports its own outcome so a partial failure still leaves a usable
 * panel — a missing catalog is recoverable, a missing key is not.
 * @module dsh-sub2api/sub2api/provision
 */

import { Sub2ApiError } from "../util.js";

/** @typedef {{id: string, label: string, ok: boolean, detail?: string, error?: string}} ProvisionStep */

/**
 * @param {object} deps
 * @param {import("./api.js").Sub2ApiApi} deps.api
 * @param {(key: string) => Promise<void>} deps.saveApiKey
 * @param {(apiKey: string) => Promise<number>} deps.refreshCatalog resolves the model count
 * @param {string} deps.keyName name given to the provisioned key
 * @param {number} [deps.groupId] forced group, overriding automatic selection
 * @param {{info: Function, warn: Function}} [deps.logger]
 * @param {string} deps.accessToken
 * @returns {Promise<{steps: ProvisionStep[], key?: string, groupId?: number, models: number, ready: boolean}>}
 */
export async function provisionAccount(deps) {
  const { api, accessToken, keyName } = deps;
  const logger = deps.logger ?? { info() {}, warn() {} };
  const steps = [];

  // 1) Account snapshot. Balance is what the panel shows first, so a failure
  //    here degrades the header rather than blocking the flow.
  const profile = await attempt(() => api.profile(accessToken));
  steps.push(
    profile.ok
      ? step("profile", "账号信息", true, profile.value?.email ?? undefined)
      : step("profile", "账号信息", false, undefined, describe(profile.error)),
  );

  // 2) Groups decide where the key lives; the site may hand back none at all.
  const groupsResult = await attempt(() => api.groups(accessToken));
  const groups = groupsResult.ok && Array.isArray(groupsResult.value) ? groupsResult.value : [];
  steps.push(
    groupsResult.ok
      ? step("groups", "可用分组", true, groups.length === 0 ? "默认分组" : `${groups.length} 个`)
      : step("groups", "可用分组", false, undefined, describe(groupsResult.error)),
  );

  // 3) An existing key with our name is reused, so re-login never piles up keys.
  const keysResult = await attempt(() => api.listKeys(accessToken));
  const existing = pickKey(
    keysResult.ok ? (keysResult.value?.items ?? []) : [],
    keyName,
  );

  let key = existing?.key;
  let groupId = existing?.group_id ?? undefined;

  if (typeof key === "string" && key !== "") {
    steps.push(step("key", "API 密钥", true, `复用已有密钥 ${keyName}`));
  } else {
    const chosenGroup = chooseGroup({
      forced: deps.groupId,
      groups,
      allowed: profile.ok ? profile.value?.allowed_groups : undefined,
    });
    const created = await attempt(() =>
      api.createKey(accessToken, { name: keyName, groupId: chosenGroup }),
    );
    if (created.ok && typeof created.value?.key === "string" && created.value.key !== "") {
      key = created.value.key;
      groupId = created.value.group_id ?? chosenGroup ?? undefined;
      steps.push(
        step("key", "API 密钥", true, `已创建密钥 ${keyName}${groupLabel(groups, groupId)}`),
      );
    } else {
      steps.push(
        step(
          "key",
          "API 密钥",
          false,
          undefined,
          created.ok ? "创建成功但未返回密钥值" : describe(created.error),
        ),
      );
    }
  }

  // 4) Persist. Without this the adapter has no credential to resolve and every
  //    request fails, so it is the one step that gates `ready`.
  if (typeof key === "string" && key !== "") {
    const saved = await attempt(() => deps.saveApiKey(key));
    steps.push(
      saved.ok
        ? step("credential", "保存凭据", true, "已写入本机凭据库")
        : step("credential", "保存凭据", false, undefined, describe(saved.error)),
    );
  }

  // 5) Catalog. A failure here is retryable from the panel, not fatal — and a
  //    zero-balance account is the expected case, not an error: sub2api answers
  //    `/v1/models` with INSUFFICIENT_BALANCE until the account is topped up.
  let models = 0;
  if (typeof key === "string" && key !== "") {
    const catalog = await attempt(() => deps.refreshCatalog(key));
    models = catalog.ok ? catalog.value : 0;
    if (catalog.ok) {
      steps.push(step("catalog", "同步模型", true, `${models} 个模型`));
    } else if (isInsufficientBalance(catalog.error)) {
      steps.push(
        step("catalog", "同步模型", false, "余额不足", "充值后会自动同步模型", "warn"),
      );
    } else {
      steps.push(step("catalog", "同步模型", false, undefined, describe(catalog.error)));
    }
  }

  const blocking = steps.filter(
    (entry) => !entry.ok && (entry.id === "key" || entry.id === "credential"),
  );

  if (blocking.length > 0) {
    logger.warn(`[sub2api] 自动开通未完成：${blocking.map((entry) => entry.error).join("；")}`);
  }

  return { steps, key, groupId, models, ready: blocking.length === 0 };
}

/**
 * Reuse the key this plugin already made. Matching on name alone would reuse a
 * key the user revoked, so status is checked too.
 * @param {Array<any>} items
 * @param {string} keyName
 */
export function pickKey(items, keyName) {
  if (!Array.isArray(items)) return undefined;
  return items.find(
    (item) => item && item.name === keyName && item.status !== "inactive" && typeof item.key === "string",
  );
}

/**
 * Pick the group a new key belongs to.
 *
 * Leaving it unset is not a neutral default: an ungrouped key is rejected by
 * the gateway's permission check, so the catalog never loads and the panel
 * shows a failure nobody can act on. The order is therefore explicit and always
 * lands on a real group when one exists.
 *
 * Preference: the operator's forced id, the account's own allowed group, the
 * only group on offer, then a group that speaks the protocol this plugin does
 * (an OpenAI-compatible route cannot serve a message from a group whose
 * platform is something else), then the first non-exclusive one.
 * @param {{forced?: number, groups: any[], allowed?: number[]}} input
 * @returns {number | undefined}
 */
export function chooseGroup(input) {
  const { forced, groups, allowed } = input;
  if (typeof forced === "number") return forced;

  const available = (Array.isArray(groups) ? groups : []).filter(
    (group) => group && typeof group.id === "number" && group.status !== "disabled",
  );
  if (available.length === 0) return undefined;

  if (Array.isArray(allowed) && allowed.length > 0) {
    const match = available.find((group) => allowed.includes(group.id));
    if (match) return match.id;
  }
  if (available.length === 1) return available[0].id;

  const sameProtocol = available.find(
    (group) => String(group.platform ?? "").toLowerCase() === "openai",
  );
  if (sameProtocol) return sameProtocol.id;

  const open = available.find((group) => group.is_exclusive !== true);
  if (open) return open.id;

  return available[0].id;
}

/** Render the group name for a step detail, when one is known. */
function groupLabel(groups, groupId) {
  if (typeof groupId !== "number") return "";
  const match = (Array.isArray(groups) ? groups : []).find((group) => group?.id === groupId);
  return match?.name ? `（分组：${match.name}）` : "";
}

/** Whether a failure is the expected zero-balance state rather than a fault. */
export function isInsufficientBalance(error) {
  return error instanceof Sub2ApiError && error.code === "INSUFFICIENT_BALANCE";
}

/**
 * @param {string} id
 * @param {string} label
 * @param {boolean} ok
 * @param {string} [detail]
 * @param {string} [error]
 * @param {"error" | "warn"} [tone] how the panel should color a failed step
 * @returns {ProvisionStep}
 */
function step(id, label, ok, detail, error, tone) {
  const entry = { id, label, ok };
  if (detail !== undefined) entry.detail = detail;
  if (error !== undefined) entry.error = error;
  if (tone !== undefined) entry.tone = tone;
  return entry;
}

/** Run one step without letting its failure escape the pipeline. */
async function attempt(run) {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * A short, redacted description of a failure.
 *
 * `String(object)` is "[object Object]", which is what the panel used to show
 * when a lower layer threw a plain object rather than an Error.
 */
export function describe(error) {
  if (typeof error === "string") return error;
  if (error instanceof Sub2ApiError) return error.message;
  if (error instanceof Error) return error.message || error.name || "未知错误";
  if (error !== null && typeof error === "object") {
    for (const key of ["message", "error", "detail", "code"]) {
      const value = error[key];
      if (typeof value === "string" && value.trim() !== "") return value;
    }
    try {
      return JSON.stringify(error).slice(0, 300);
    } catch {
      return "未知错误";
    }
  }
  return String(error);
}
