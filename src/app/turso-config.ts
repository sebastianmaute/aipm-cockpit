// src/app/turso-config.ts
//
// Config resolver for the Turso (libSQL) storage backend. Env vars
// (NEXT_PUBLIC_TURSO_*) win when set at build time; Settings (Integrations
// panel inputs) are the fallback. Returns null when URL or token is missing
// or the URL is unusable — the storage layer surfaces "not ready".

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

export function getTursoConfig(
  settingsUrl?: string,
  settingsToken?: string,
): TursoConfig | null {
  const envUrl = process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
  const envToken = process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
  const rawUrl = (envUrl && envUrl !== "" ? envUrl : settingsUrl) ?? "";
  const authToken = (envToken && envToken !== "" ? envToken : settingsToken) ?? "";
  if (!rawUrl) return null;
  const httpUrl = toHttpUrl(rawUrl);
  if (!httpUrl) return null;
  // Remote (https) endpoints require a token; loopback http (local tursodb)
  // may be token-less.
  if (httpUrl.startsWith("https://") && !authToken) return null;
  return { httpUrl, authToken };
}
