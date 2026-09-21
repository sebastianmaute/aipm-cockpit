// Pure write-time redaction for the diagnostic log. Secrets NEVER reach storage;
// only primitive, length-capped structured fields survive. Free-text values
// (e.g. error messages) are scrubbed for known secret patterns AND length-capped;
// callers should still prefer ids/counts/codes.

const SECRET_KEY_PARTS = [
  "apikey", "authtoken", "apitoken", "token", "passphrase",
  "password", "secret", "authorization", "bearer",
];
const FIELD_MAX = 500;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g,                 // Anthropic API keys
  /Bearer\s+[A-Za-z0-9._-]+/gi,             // bearer tokens
  /Basic\s+[A-Za-z0-9+/=]{16,}/g,           // HTTP Basic auth blobs
  /eyJ[A-Za-z0-9._-]{20,}/g,                // JWTs
  /\bATATT[A-Za-z0-9_=.\-]+/g,              // Atlassian Jira API tokens
  /(?:api[_-]?key|api[_-]?token|auth[_-]?token|token|secret|authorization|password|passphrase)=[^&\s]+/gi, // key=value pairs
  // §606: a base64-shaped secret that `+` or trailing `=` padding pulls OUT of §564's alphabet
  // (which excludes both). A run of 32+ from the base64 alphabet [A-Za-z0-9+/], mixing
  // lowercase, uppercase AND a digit (same lookahead style as §564, scoped to the run's own
  // character class), that EITHER contains a `+` OR ends in `=`/`==` padding — a `=` elsewhere
  // in the string does not count, because it is outside the matched run. Paths and stack frames
  // use `/` too but never `+` or a trailing `=`, so they stay readable. Placed BEFORE the §564
  // catch-all so the run (including its padding) is consumed in one piece rather than left with
  // a stray `=` after §564's narrower alphabet redacts only the alnum core.
  // ★ Known miss: a token split ONLY by `/` (no `+`, no `=` padding) is not caught.
  /(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*\d)(?:(?=[A-Za-z0-9+/]*\+)[A-Za-z0-9+/]{32,}={0,2}|[A-Za-z0-9+/]{32,}={1,2})/g,
  // §564: an opaque token with no vendor prefix and no `key=` frame. A run of 32+ from the
  // token alphabet that mixes lowercase, uppercase AND a digit. The mix is what keeps real ids
  // readable: canonical UUIDs and commit SHAs are single-case hex, MSAL GUIDs are upper-only,
  // i18n keys and German words carry no digit, and stack frames break into short runs at
  // `/ : ( .`. The lookaheads cannot see past the run, because their class excludes every
  // separator. ★ Known miss: a token that is entirely single-case hex is NOT caught, which is
  // the price of keeping UUIDs and SHAs in diagnostics.
  /(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}/g,
];

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SECRET_KEY_PARTS.some((p) => k.includes(p));
}

function scrubSecretValues(s: string): string {
  let out = s;
  for (const re of SECRET_VALUE_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}

export function redactFields(
  fields?: Record<string, unknown>,
): Record<string, string | number | boolean> | undefined {
  if (!fields) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isSecretKey(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      const scrubbed = scrubSecretValues(value);
      out[key] = scrubbed.length > FIELD_MAX ? scrubbed.slice(0, FIELD_MAX) : scrubbed;
    }
    // objects/arrays/functions/undefined -> dropped
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
