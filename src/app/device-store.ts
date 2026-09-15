// src/app/device-store.ts
//
// Tiny per-device localStorage JSON envelope shared by the pure JSON-blob
// stores (saved views, panel views, landing-state, search-recents, …). It
// factors out the SSR guard + defensive `JSON.parse` read and the quota-safe
// `JSON.stringify` write that each such store repeated verbatim. Callers keep
// their OWN validation / cap / dedupe / shape — the helper owns only the raw
// storage I/O and swallows every error silently (matching the existing stores).
// Dependency-free.

/** Read + JSON.parse a per-device key. SSR-safe; on missing key / parse error /
 *  any throw returns `fallback`. The parsed value is returned AS-IS — the caller
 *  is responsible for validating its shape. */
export function readDeviceJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** JSON.stringify + write a per-device key. SSR-safe; never throws on quota /
 *  serialization / disabled-storage errors.
 *  Returns `true` only when the value reached storage. Callers that can live
 *  with a lost write ignore it; `saveActualsCache` reads it, because a lost
 *  TimeLog fetch must be reported to the user. */
export function writeDeviceJson(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // quota / disabled / serialization — non-fatal, but reported
    return false;
  }
}

/** Remove a per-device key. SSR-safe; swallows errors. */
export function removeDeviceKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // disabled storage — non-fatal
  }
}
