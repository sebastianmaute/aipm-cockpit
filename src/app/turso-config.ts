// src/app/turso-config.ts
//
// Config resolver for the Turso (libSQL) storage backend. A NEXT_PUBLIC_TURSO_*
// env var wins over the Settings (Integrations panel) value ONLY when it is
// usable; an unusable env URL falls through to Settings rather than poisoning
// the result. The TOKEN has no usability test — any non-empty string is a
// plausible token — so an env token wins over Settings UNLESS Turso itself
// has rejected it (§337, `isEnvTokenRejected` below), in which case a
// non-empty Settings token wins instead. The Settings "Test connection"
// button is what tells a user a token is wrong before that rejection happens
// for real.
// Returns null when the URL or token is missing or the URL is unusable — the
// storage layer surfaces "not ready".

export interface TursoConfig {
  /** Pipeline base, e.g. "https://db.turso.io" (no trailing slash). May be an
   *  "http://" loopback origin for a local/self-hosted tursodb. */
  httpUrl: string;
  /** May be empty for a loopback (local) server that requires no auth. */
  authToken: string;
}

/** Loopback hosts that may be reached over plaintext http (local tursodb).
 *  `new URL(...).hostname` is already lowercased by the WHATWG parser, so only
 *  lowercase entries are needed here (e.g. "http://LOCALHOST" → "localhost"). */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

/** Normalize a Turso DB URL to its pipeline base.
 *  libsql:// → https://, https:// passthrough; plaintext http:// is allowed
 *  ONLY for loopback hosts (local/self-hosted tursodb) so a Bearer token is
 *  never sent over plaintext to a remote host. Trailing slash stripped;
 *  any other scheme / non-loopback http / unparseable input → null. */
function toHttpUrl(raw: string): string | null {
  // Replace libsql:// before parsing — Node's URL rejects protocol mutation
  // for non-standard schemes (origin stays null after reassignment).
  const normalized = raw.replace(/^libsql:\/\//, "https://");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }
  if (!parsed.hostname) return null; // e.g. "https://" parses but has no host (origin === "null")
  if (parsed.protocol === "https:") return parsed.origin;
  if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) return parsed.origin;
  return null;
}

/** True when a raw URL string normalises to a usable pipeline base.
 *
 *  ★★ EXPORTED SO THE SETTINGS UI ASKS THE SAME QUESTION THIS FILE ANSWERS.
 *  Before it existed, `integrations-section.tsx` hid the URL input on env-var
 *  PRESENCE (`!!process.env.NEXT_PUBLIC_TURSO_DATABASE_URL`) while the
 *  resolver below rejected the value on USABILITY. A typo'd env var was
 *  therefore present enough to hide the field and unusable enough to yield no
 *  config, locking the user out of configuring Turso from the UI at all
 *  (open-followups §337). Two predicates answering one question is the defect;
 *  do not reintroduce a second one. */
export function isUsableTursoUrl(raw: string): boolean {
  return toHttpUrl(raw) !== null;
}

// NOTE: a region-qualified host (`<db>-<org>.aws-eu-west-1.turso.io`) is a
// VALID, officially-issued Turso URL — it is what `turso db show` prints. This
// file once carried an `isLikelyRegionQualifiedTursoUrl` guard that drove a
// settings warning telling users to strip the region segment; that advice was
// wrong and has been removed. Don't reintroduce it.

/** §337 — per-device record that Turso REJECTED the deployment (env) token.
 *  While set, a non-empty Settings token outranks the env token and the
 *  Settings field is shown. Cleared by the next success that used the env
 *  token, so a fixed deployment wins again. Lives under the app-config prefix,
 *  so clearAppConfig wipes it. Not a secret, not workspace data. */
export const ENV_TOKEN_REJECTED_KEY = "aipm-cockpit:turso-env-token-rejected";
export function isEnvTokenRejected(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(ENV_TOKEN_REJECTED_KEY) === "1";
  } catch {
    return false;
  }
}
export function markEnvTokenRejected(): void {
  try {
    localStorage.setItem(ENV_TOKEN_REJECTED_KEY, "1");
  } catch {
    /* storage unavailable: precedence stays env-first */
  }
}
export function clearEnvTokenRejected(): void {
  try {
    localStorage.removeItem(ENV_TOKEN_REJECTED_KEY);
  } catch {
    /* same */
  }
}

export function getTursoConfig(
  settingsUrl?: string,
  settingsToken?: string,
): TursoConfig | null {
  const envUrl = process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
  const envToken = process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
  // ★★ THE ENV VALUE WINS ONLY WHEN IT IS USABLE. An unusable one falls
  // through to Settings rather than poisoning the result — see §337 and the
  // predicate above. This is deployment-visible: an operator who set the env
  // var to a deliberately malformed value to force "no Turso" now gets the
  // Settings value instead. Nothing that WORKED before changes, because an
  // unusable env value already resolved to null.
  const envUrlUsable = !!envUrl && envUrl !== "" && isUsableTursoUrl(envUrl);
  const rawUrl = (envUrlUsable ? envUrl : settingsUrl) ?? "";
  // ★★★ §337 (token half) — a USABLE env token can still be WRONG (revoked,
  // rotated, copy-pasted from another deployment), and there was no way to
  // find out except a 401/403 from Turso itself with the Settings field
  // hidden and unable to help. `turso-pipeline.ts` flags that rejection via
  // `markEnvTokenRejected`; while the flag is set, a non-empty Settings token
  // outranks the env token so the user has a way out. An empty Settings
  // token does NOT win — falling back to null here would break every
  // deployment mid-incident, before the user has had a chance to type
  // anything.
  const envTokenSet = !!envToken && envToken !== "";
  const settingsTokenSet = !!settingsToken && settingsToken !== "";
  const preferSettings = settingsTokenSet && isEnvTokenRejected();
  const authToken = (envTokenSet && !preferSettings ? envToken : settingsTokenSet ? settingsToken : envToken) ?? "";
  if (!rawUrl) return null;
  const httpUrl = toHttpUrl(rawUrl);
  if (!httpUrl) return null;
  // Remote (https) endpoints require a token; loopback http (local tursodb)
  // may be token-less.
  if (httpUrl.startsWith("https://") && !authToken) return null;
  return { httpUrl, authToken };
}
