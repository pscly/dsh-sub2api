/**
 * Authentication: one form, two outcomes.
 *
 * The deployment has registration open and email verification off, so a user
 * who has never signed up should not have to discover a separate "register"
 * tab. The panel sends one email/password pair and this module tries login
 * first; only a rejected credential falls through to registration.
 *
 * The important rule is the ordering: a wrong password on an existing account
 * must never create a second account, and must not be reported as "no such
 * account".
 * @module dsh-sub2api/sub2api/auth
 */

import { Sub2ApiError } from "../util.js";

/**
 * @param {object} deps
 * @param {import("./api.js").Sub2ApiApi} deps.api
 * @param {string} deps.email
 * @param {string} deps.password
 * @param {string} [deps.promoCode]
 * @param {boolean} [deps.allowRegister] when false, a rejected login is final
 * @returns {Promise<{mode: "login" | "register", auth: any}>}
 */
export async function loginOrRegister(deps) {
  const { api, email, password, promoCode, allowRegister = true } = deps;

  try {
    const auth = await api.login(email, password);
    return { mode: "login", auth };
  } catch (error) {
    if (!isCredentialRejection(error)) throw translateLogin(error);
    if (!allowRegister) throw new Sub2ApiError("邮箱或密码不正确", { code: "wrong_password" });

    try {
      const auth = await registerWithFallbacks(api, email, password, promoCode);
      // Some deployments turn email verification on later. The account is
      // created but unusable until the address is confirmed, and pretending
      // otherwise would fail later with a confusing 401.
      if (typeof auth?.access_token !== "string" || auth.access_token === "") {
        throw new Sub2ApiError(
          "注册成功，但这个站点要求邮箱验证：请先到邮箱点击确认链接，再回来用同一密码登录。",
          { code: "email_verification_required" },
        );
      }
      return { mode: "register", auth };
    } catch (registerError) {
      // The address is taken, so the login rejection really was a bad password.
      if (isEmailTaken(registerError)) {
        throw new Sub2ApiError("这个邮箱已注册，密码不正确", { code: "wrong_password" });
      }
      throw registerError;
    }
  }
}

/**
 * Some deployments require a username. Try the minimal body first, then add one
 * derived from the address rather than making the user fill another field.
 */
async function registerWithFallbacks(api, email, password, promoCode) {
  try {
    return await api.register({ email, password, promoCode });
  } catch (error) {
    if (!mentionsField(error, "username")) throw error;
    return api.register({ email, password, promoCode, username: usernameFromEmail(email) });
  }
}

/** A stable, readable username derived from the address local part. */
export function usernameFromEmail(email) {
  const local = String(email).split("@")[0] ?? "";
  const cleaned = local.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 24);
  return cleaned === "" ? `dsh${Date.now().toString(36)}` : cleaned;
}

/** Whether an error means "these credentials are wrong", as opposed to an outage. */
export function isCredentialRejection(error) {
  if (!(error instanceof Sub2ApiError)) return false;
  if (error.status === 401) return true;
  if (error.status !== 400 && error.status !== 403 && error.status !== 422) return false;
  return /invalid|incorrect|wrong|credential|password|email or password|密码|凭据|账号或密码/i.test(
    error.message,
  );
}

/** Whether an error means the address already has an account. */
export function isEmailTaken(error) {
  if (!(error instanceof Sub2ApiError)) return false;
  return /exist|already|taken|registered|duplicate|已注册|已存在|重复/i.test(error.message);
}

/** Re-word a transport failure so the panel can say something actionable. */
function translateLogin(error) {
  if (error instanceof Sub2ApiError && error.code === "network") {
    return new Sub2ApiError("连不上 Sub2API，请检查网络或服务地址", { code: "network" });
  }
  return error;
}

/** Whether a validation error names one specific field. */
function mentionsField(error, field) {
  if (!(error instanceof Sub2ApiError)) return false;
  return new RegExp(field, "i").test(error.message);
}
