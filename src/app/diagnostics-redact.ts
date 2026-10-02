// Pure write-time redaction for the diagnostic log. Secrets NEVER reach storage;
// only primitive, length-capped structured fields survive. Free-text values
// (e.g. error messages) are scrubbed for known secret patterns AND length-capped;
// callers should still prefer ids/counts/codes.

const SECRET_KEY_PARTS = [
  "apikey", "authtoken", "apitoken", "token", "passphrase",
  "password", "secret", "authorization", "bearer",
];
const FIELD_MAX = 500;
const REDACTED = "[redacted]";
// §608: scrub only a bounded prefix, never the full field. Several patterns backtrack
// quadratically on a long run that fails them (64k mixed-case ~12 s), so the input is cut
// BEFORE scrubbing. Minimum match lengths differ per pattern (sk-ant- ~8, Bearer ~8, Basic 22,
// eyJ 23, ATATT 6, key=value ~7, the two base64 rules 32), all far under 512, and none looks
// beyond its own run, so any token wholly inside the window is matched exactly as before.
// ★ Only a token CUT by the window is a problem. Redaction SHRINKS text, so the first FIELD_MAX
// chars of the OUTPUT can reach original positions far past FIELD_MAX, and a cut token with too
// few chars kept would survive as a raw fragment. `boundScrubInput` therefore finds the start of
// the token-alphabet run the cut splits (a linear backward scan, no regex over the window): a run
// starting at or after FIELD_MAX is DROPPED (the output is cut back to its start), and a run
// starting before FIELD_MAX is REDACTED outright, as follows.
// ★ A run that starts BEFORE FIELD_MAX and reaches the cut is at least 512 token chars long: never
// readable log text, and only matching the WHOLE run could judge it, which is the quadratic cost
// this removes. Handing the partial run to the patterns would let §606 miss a `+` or `=` padding
// that lies past the window, so that run is redacted outright. COST: a long non-secret run, such as
// a URL over 512 chars with no separator, is redacted in diagnostics.
export const SCRUB_WINDOW = FIELD_MAX + 512;

// The union of every character a SECRET_VALUE_PATTERNS match can be made of, read off the
// patterns: sk-ant- [A-Za-z0-9_-]; Bearer [A-Za-z0-9._-]; Basic [A-Za-z0-9+/=]; eyJ [A-Za-z0-9._-];
// ATATT [A-Za-z0-9_=.-]; the base64 rule [A-Za-z0-9+/] and `=`; the catch-all [A-Za-z0-9_-].
// key=value's value class [^&\s] is wider, but any prefix of it still matches and a cut right
// after the `=` only drops the value, so it needs no entry. Whitespace is NOT in the set: a
// secret is split from what precedes it by anything outside it, which is how JSON quotes and
// commas end a run. Widening a pattern's alphabet means widening this set; the §608 test pins it.
const TOKEN_CHAR = /[A-Za-z0-9+/=_.-]/;

function boundScrubInput(value: string): string {
  if (value.length <= SCRUB_WINDOW) return value;
  // The cut splits a token run only when the chars on both sides are token chars.
  if (!TOKEN_CHAR.test(value[SCRUB_WINDOW - 1]) || !TOKEN_CHAR.test(value[SCRUB_WINDOW])) {
    return value.slice(0, SCRUB_WINDOW);
  }
  let start = SCRUB_WINDOW;
  while (start > 0 && TOKEN_CHAR.test(value[start - 1])) start--;
  return start < FIELD_MAX ? value.slice(0, start) + REDACTED + value.slice(start, start + 60) :value.slice(0, start);
}

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
  // character class), that EITHER contains a `+` OR ends in 1-2 `=` of padding. Padding counts
  // only when it TERMINATES the token — nothing from the alphabet and no further `=` may follow
  // it — so a path followed by `=` and more text (`/api/v1/Tenants/Chart2Panel/Settings=on`) is
  // not a token. In the `+` branch the padding group is optional as a whole, so a `+` run
  // followed by `=on` is still redacted and only the `=on` stays visible; a boundary after a
  // bare `={0,2}` there would reject the whole run and log a `+`-split secret in full. Placed
  // BEFORE the §564 catch-all: §564's alphabet excludes `+`, so run first it would redact only
  // a 32+ head and leave `+<tail>` of the secret in the log.
  // ★ Known miss: a token split ONLY by `/` (no `+`, no `=` padding) is not caught.
  // ★ Accepted false positives (the owner's trade): long `+`-joined text that mixes case and
  // carries a digit — a URL search query (`?q=Project+Status+Report+Q3+Summary`), a `+` chain
  // with no spaces (`renderChartReadout+useChartReadout3+formatValue`), or
  // `total=TaskHours2025Q3+RaidHours2025Q3+ChangeHours2025Q3` — is redacted.
  /(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*\d)(?:(?=[A-Za-z0-9+/]*\+)[A-Za-z0-9+/]{32,}(?:={1,2}(?![A-Za-z0-9+/=]))?|[A-Za-z0-9+/]{32,}={1,2}(?![A-Za-z0-9+/=]))/g,
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
  for (const re of SECRET_VALUE_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

export function redactFields(
  fields?: Record<string, unknown>,
): Record<string, string | number | boolean> | undefined {
  if (!fields) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isSecretKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      const scrubbed = scrubSecretValues(boundScrubInput(value));
      out[key] = scrubbed.length > FIELD_MAX ? scrubbed.slice(0, FIELD_MAX) : scrubbed;
    }
    // objects/arrays/functions/undefined -> dropped
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
