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
  /eyJ[A-Za-z0-9._-]{20,}/g,                // JWTs
  /\bATATT[A-Za-z0-9_=.\-]+/g,              // Atlassian Jira API tokens
  /(?:api[_-]?key|api[_-]?token|auth[_-]?token|token|secret|authorization|password|passphrase)=[^&\s]+/gi, // key=value pairs
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
