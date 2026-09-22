// The organisation AI-usage policy the AI Assistant's consent screen points to.
// Pure and i18n-free: the consent screen and Settings → AI both read `resolveAiPolicy`.
//
// ★ Precedence: a build-time `NEXT_PUBLIC_AI_POLICY_*` value, then Settings, then
//   nothing — there is no built-in default. A deployment that wants a policy step
//   sets both build variables; a user can also set both fields in Settings.
// ★★ The link is rendered as an `href`, so only an `https:` URL ever leaves this module.
//   Anything else (`javascript:`, `data:`, plain http, a typo) resolves to "no policy"
//   from Settings and is skipped from the environment — never passed through.

/** Longest value Settings keeps for either field. */
export const MAX_AI_POLICY_FIELD = 2048;

export interface AiPolicySettings {
  /** `undefined` = never set; `""` = deliberately cleared. Both currently resolve
   *  to no policy, but are kept distinct so a caller can tell "never entered" from
   *  "entered, then removed" if that ever needs different wording. */
  policyOrgName?: string;
  policyUrl?: string;
}

export interface AiPolicyEnv {
  org: string | undefined;
  url: string | undefined;
}

export interface AiPolicy {
  /** Who owns the policy; `null` when cleared — callers then use neutral wording. */
  org: string | null;
  /** A safe https link; `null` means there is no policy to read or accept. */
  url: string | null;
  orgFromEnv: boolean;
  urlFromEnv: boolean;
  /** `NEXT_PUBLIC_AI_POLICY_URL` is set but is not a safe https link, so it was
   *  ignored — Settings says so rather than letting the fallback look intended. */
  urlEnvRejected: boolean;
}

export function isSafePolicyUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname !== "";
  } catch {
    return false;
  }
}

/** The deployment's build-time values. Next.js inlines `NEXT_PUBLIC_*` at build. */
export function aiPolicyEnv(): AiPolicyEnv {
  return {
    org: process.env.NEXT_PUBLIC_AI_POLICY_ORG,
    url: process.env.NEXT_PUBLIC_AI_POLICY_URL,
  };
}

export function resolveAiPolicy(settings: AiPolicySettings, env: AiPolicyEnv = aiPolicyEnv()): AiPolicy {
  const envOrg = env.org?.trim() ?? "";
  const envUrl = env.url?.trim() ?? "";
  const orgFromEnv = envOrg !== "";
  const urlFromEnv = envUrl !== "" && isSafePolicyUrl(envUrl);

  const org: string | null = orgFromEnv ? envOrg : settings.policyOrgName?.trim() || null;

  // ★★ There is no built-in link. A link is used only when it was actually
  //   configured — by the deployment or in Settings — never inferred from the owner.
  let url: string | null;
  if (urlFromEnv) url = envUrl;
  else url = settings.policyUrl !== undefined && isSafePolicyUrl(settings.policyUrl) ? settings.policyUrl.trim() : null;

  return { org, url, orgFromEnv, urlFromEnv, urlEnvRejected: envUrl !== "" && !urlFromEnv };
}
