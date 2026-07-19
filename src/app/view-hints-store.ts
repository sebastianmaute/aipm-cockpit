// Per-device dismiss state for the contextual per-view callouts (Help SP2).
// NOT workspace data: a single localStorage key, out of exports/Turso, cleared
// by clearAppConfig's `aipm-cockpit:*` sweep. Popout windows are read-only and never
// persist. Pure + defensive: a malformed/absent store yields no dismissals.

import { readDeviceJson, writeDeviceJson } from "./device-store";

const KEY = "aipm-cockpit:view-hints";

type ViewHintsState = { dismissed: Record<string, true> };

export function loadDismissed(): Record<string, true> {
  const v = readDeviceJson<unknown>(KEY, null);
  if (v && typeof v === "object" && "dismissed" in v) {
    const d = (v as ViewHintsState).dismissed;
    if (d && typeof d === "object") return d;
  }
  return {};
}

/** Mark a view's callout dismissed and persist (no-op in popouts). Returns the
 *  new dismissed map so callers can update state without a re-read. */
export function dismissView(view: string, isPopout: boolean): Record<string, true> {
  const next = { ...loadDismissed(), [view]: true as const };
  if (isPopout) return next; // popouts are read-only — never persist
  writeDeviceJson(KEY, { dismissed: next } satisfies ViewHintsState);
  return next;
}
