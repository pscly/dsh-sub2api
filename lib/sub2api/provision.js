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

  // 5) Catalog. A failure here is retryable from the panel, not fatal.
  let models = 0;
  if (typeof key === "string" && key !== "") {
    const catalog = await attempt(() => deps.refreshCatalog(key));
    models = catalog.ok ? catalog.value : 0;
    steps.push(
      catalog.ok
        ? step("catalog", "同步模型", true, `${models} 个模型`)
        : step("catalog", "同步模型", false, undefined, describe(catalog.error)),
    );
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
 * Preference order: an explicit setting, then the account's own allowed group,
 * then the only group on offer. Leaving it undefined is correct — the server
 * then applies the account default, which is what "用户分组" means when the
 * account has exactly one.
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
  return undefined;
}

/** Render the group name for a step detail, when one is known. */
function groupLabel(groups, groupId) {
  if (typeof groupId !== "number") return "";
  const match = (Array.isArray(groups) ? groups : []).find((group) => group?.id === groupId);
  return match?.name ? `（分组：${match.name}）` : "";
}

/** @returns {ProvisionStep} */
function step(id, label, ok, detail, error) {
  const entry = { id, label, ok };
  if (detail !== undefined) entry.detail = detail;
  if (error !== undefined) entry.error = error;
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

/** A short, redacted description of a failure. */
function describe(error) {
  if (error instanceof Sub2ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
