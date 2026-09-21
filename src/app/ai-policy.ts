// The organisation AI-usage policy the AI Assistant's consent screen points to.
// Pure and i18n-free: the consent screen and Settings → AI both read `resolveAiPolicy`.
//
// ★ Precedence: a build-time `NEXT_PUBLIC_AI_POLICY_*` value, then Settings, then the
//   built-in default — the same shape as `getMsalConfig` and the Turso URL.
// ★★ The link is rendered as an `href`, so only an `https:` URL ever leaves this module.
//   Anything else (`javascript:`, `data:`, plain http, a typo) resolves to "no policy"
//   from Settings and is skipped from the environment — never passed through.

export const DEFAULT_AI_POLICY_ORG = "Acme";
export const DEFAULT_AI_POLICY_URL = "https://wiki.example.com/wiki/x/ewB2bwE";

/** Longest value Settings keeps for either field. */
export const MAX_AI_POLICY_FIELD = 2048;

export interface AiPolicySettings {
  /** `undefined` = never set (built-in default); `""` = deliberately cleared. */
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

  let org: string | null;
  if (orgFromEnv) org = envOrg;
  else if (settings.policyOrgName === undefined) org = DEFAULT_AI_POLICY_ORG;
  else org = settings.policyOrgName.trim() || null;

  let url: string | null;
  if (urlFromEnv) url = envUrl;
  else if (settings.policyUrl === undefined) url = DEFAULT_AI_POLICY_URL;
  else url = isSafePolicyUrl(settings.policyUrl) ? settings.policyUrl.trim() : null;

  return { org, url, orgFromEnv, urlFromEnv };
}
