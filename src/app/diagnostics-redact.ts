// Pure write-time redaction for the diagnostic log. Secrets NEVER reach storage;
// only primitive, length-capped structured fields survive. No free-text content
// by contract (callers pass ids/counts/codes).

const SECRET_KEY_PARTS = [
  "apikey", "authtoken", "apitoken", "token", "passphrase",
  "password", "secret", "authorization", "bearer",
];
const FIELD_MAX = 200;

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SECRET_KEY_PARTS.some((p) => k.includes(p));
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
      out[key] = value.length > FIELD_MAX ? value.slice(0, FIELD_MAX) : value;
    }
    // objects/arrays/functions/undefined -> dropped
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
