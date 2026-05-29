// src/app/turso-config.ts
//
// Config resolver for the Turso (libSQL) storage backend. Env vars
// (NEXT_PUBLIC_TURSO_*) win when set at build time; Settings (Integrations
// panel inputs) are the fallback. Returns null when URL or token is missing
// or the URL is unusable — the storage layer surfaces "not ready".

export interface TursoConfig {
  /** HTTPS pipeline base, e.g. "https://db.turso.io" (no trailing slash). */
  httpUrl: string;
  authToken: string;
}

/** Normalize a Turso DB URL to its HTTPS pipeline base.
 *  libsql:// → https://, https:// passthrough, trailing slash stripped;
 *  any other scheme / unparseable input → null. */
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
  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null; // e.g. "https://" parses but has no host (origin === "null")
  return parsed.origin;
}

export function getTursoConfig(
  settingsUrl?: string,
  settingsToken?: string,
): TursoConfig | null {
  const envUrl = process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
  const envToken = process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
  const rawUrl = (envUrl && envUrl !== "" ? envUrl : settingsUrl) ?? "";
  const authToken = (envToken && envToken !== "" ? envToken : settingsToken) ?? "";
  if (!rawUrl || !authToken) return null;
  const httpUrl = toHttpUrl(rawUrl);
  if (!httpUrl) return null;
  return { httpUrl, authToken };
}
