// SERVER-ONLY. The operator settings for the per-caller request limits of the AI relay and dictation, read
// from the environment on every call, so a restart applies a change and no rebuild is needed:
//   AIPM_AI_RELAY_MAX_REQUESTS   relayed AI calls one caller may send per minute (default RELAY_MAX_REQUESTS)
//   AIPM_STT_MAX_REQUESTS        dictation requests one caller may send per minute (default STT_MAX_REQUESTS)
// Each is a whole number from 1 to MAX_REQUEST_LIMIT. A value that is set but unusable keeps the route's
// default, so a typo can never switch the limit off, and is logged on the server once per process, naming
// the setting only, never its value.

export const AI_RELAY_MAX_REQUESTS_ENV = "AIPM_AI_RELAY_MAX_REQUESTS";
export const STT_MAX_REQUESTS_ENV = "AIPM_STT_MAX_REQUESTS";
export const MAX_REQUEST_LIMIT = 100_000;

type Env = Record<string, string | undefined>;

const WHOLE_NUMBER = /^[0-9]+$/;

/** The limit a raw setting gives, with no side effect: the default while unset, and while invalid. */
export function parseRequestLimit(raw: string | undefined, fallback: number): { max: number; invalid: boolean } {
  const value = raw?.trim() ?? "";
  if (value === "") return { max: fallback, invalid: false };
  const max = WHOLE_NUMBER.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(max) || max < 1 || max > MAX_REQUEST_LIMIT) return { max: fallback, invalid: true };
  return { max, invalid: false };
}

/** Settings already reported by this server process: each is logged once, not on every request. Mutable module
 *  state on purpose: "once per process" needs memory that outlives a call. */
const reported = new Set<string>();

/** `parseRequestLimit` for the named setting; an invalid one tells the operator once per process. */
export function readRequestLimit(env: Env, name: string, fallback: number): number {
  const { max, invalid } = parseRequestLimit(env[name], fallback);
  if (invalid && !reported.has(name)) {
    reported.add(name);
    console.warn(`request limit setting invalid, using the default: ${name}`);
  }
  return max;
}
