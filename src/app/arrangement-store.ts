"use client";
/**
 * Per-device, per-project storage for a surface's block arrangement, generic
 * over the storage KEY so each surface owns its own map.
 *
 * ★★ THE CAP AND THE RECENCY RULE APPLY PER KEY, INDEPENDENTLY. Every function
 * here takes the key as its first argument and reads/writes only that key's
 * `{[projectId]: layout}` map, so two surfaces never share a project budget:
 * fifty projects arranged on the Dashboard evict nothing from Reports. Pinned
 * by "gives each key its own cap rather than one shared budget".
 * ★ THE BUDGET IS PER KEY; THE NUMBER IS NOT. `MAX_PROJECTS` is ONE module
 * constant every binding shares — deliberately, since no surface has wanted its
 * own size — so read the ★★ above as "each key counts its own projects", never
 * as "each surface sets its own limit". Making it a parameter is a one-line
 * change if a surface ever needs one; do not pre-empt it.
 *
 * ★★ NOT A `Workspace` FIELD, deliberately — zero backend write paths, nothing
 * in exports or Turso. One localStorage key per surface holds a
 * `{[projectId]: layout}` map, exactly like `landing-state.ts`, so
 * `clearAppConfig`'s `aipm-cockpit:*` sweep already clears it and no codec, DDL
 * or golden fixture has to change. ★ That sweep is by PREFIX, so a new
 * surface's key must start `aipm-cockpit:` to inherit it.
 *
 * ★ The raw storage I/O goes through `device-store.ts` (`readDeviceJson` /
 * `writeDeviceJson`), the same envelope `landing-state.ts` uses — it owns the
 * SSR guard, the defensive parse and the quota-safe write. Validation, the cap
 * and the recency rule stay here, which is that helper's documented split.
 *
 * ★ Insertion order in the JSON object IS the recency order used for eviction.
 * Re-saving an existing project deletes and re-adds its key so it moves to the
 * end; without that, the first `MAX_PROJECTS` projects a user ever opened would
 * be pinned forever and the next one could never be stored.
 *
 * ★★ THAT RESTS ON PROJECT IDS NOT BEING INTEGER-LIKE, and they are not — this
 * is recorded so nobody re-derives the worry. `Object.keys` lists canonical
 * integer-index keys FIRST, in ASCENDING NUMERIC order, ahead of every string
 * key: with ids like `"1"`, `"2"`, … the delete-and-re-add would move nothing
 * and the cap would evict the LOWEST-NUMBERED project rather than the least
 * recently used. Every id that reaches here is a `crypto.randomUUID()` — file
 * mode mints one at all three `addProject` sites in `use-storage-file-ops.ts`,
 * Turso at both mint sites in `use-storage-turso-ops.ts` — plus the literal
 * `"default"` fallback `dashboard-panel.tsx` passes when it has no project id.
 * A UUID always contains hyphens and hex letters, so none of them can be
 * integer-like. Reproduce: `grep -rn "const id = crypto.randomUUID()"
 * src/app/use-storage-file-ops.ts src/app/use-storage-turso-ops.ts` (five hits).
 * ★ The project id reaches here from the SURFACE, so this holds for every
 * surface that binds this store, not just the Dashboard — they are handed the
 * same ids. A future id scheme that mints bare decimal strings would silently
 * break the recency rule with nothing to say so — prefix it, or replace
 * insertion order with a stored timestamp.
 *
 * ★★ A DOWNGRADE→UPGRADE ROUND TRIP LOSES THE ARRANGEMENT, PERMANENTLY, and that
 * is accepted rather than unnoticed. `isArrangementLayout` rejects any `v` that
 * is not exactly 1, so a blob written by a FUTURE version reads as absent,
 * `reconcile` hands back the surface's default, and the first mutation writes a
 * `v: 1` layout over the newer one — the old arrangement is gone, not merely
 * ignored. Accepted because this is a preference, not data (the same reason a
 * quota failure is swallowed below), and because the alternative — preserving an
 * unreadable blob under a side key — buys a user who downgrades once something
 * nobody has asked for. A future `v: 2` should MIGRATE a `v: 1` blob rather than
 * reject it, which costs the same round trip in the other direction.
 * ★★ AND A VERSION BUMP IS NOW A LOCKSTEP DECISION ACROSS EVERY SURFACE, which
 * it was not while each store carried its own guard. `isArrangementLayout`
 * hardcodes `l.v !== 1` for all of them, so bumping one surface to `v: 2` either
 * bumps the others with it or forces the guard to take the accepted version(s)
 * per surface. Neither is hard; both are more than the one-file change the
 * paragraph above reads like.
 */
import { readDeviceJson, writeDeviceJson } from "./device-store";
import type { ArrangementLayout } from "./arrangement-layout";

export const MAX_PROJECTS = 50;

/** ★ Deliberately loose: an unknown id or an out-of-RANGE span is `reconcile`'s
 *  job, not this one. This only rejects a blob that is not a layout AT ALL.
 *
 *  ★★ `Number.isFinite`, NOT `typeof === "number"`, AND THE DIFFERENCE IS THE
 *  ONE VALUE THIS PREDICATE EXISTS TO STOP. `typeof NaN === "number"`, so a
 *  `typeof` test admits it, `clampSpan` yields NaN, `JSON.stringify` writes
 *  `null`, and the NEXT load rejects the whole layout — the silent reset the
 *  ★★★ block below describes, produced by the guard that claims to prevent it.
 *  Measured: with `typeof`, `isArrangementLayout({v:1,board:[{id:"x",w:NaN,h:1}],
 *  hidden:[]})` returned true. ±Infinity rides along for free. */
function isPlacedBlock(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const t = v as { id?: unknown; w?: unknown; h?: unknown };
  return typeof t.id === "string" && Number.isFinite(t.w) && Number.isFinite(t.h);
}

/**
 * The shape-and-version guard `reconcile` requires of its `stored` argument.
 *
 * ★★★ IT IS THE ONLY THING BETWEEN A HAND-EDITED localStorage BLOB AND A PANEL
 * THAT FAILS TO RENDER. `reconcile` validates nothing (its own ★★★ block says
 * so): `board: null`, `hidden: null`, `board: [null]` and `{}` all THROW out of
 * it, and a surface reconciles from a lazy `useState` initialiser and a
 * render-phase project switch, so that throw is a render failure rather than a
 * degradation. A non-numeric `w` is quieter and worse — it clamps to NaN,
 * serialises as `null`, and is rejected on the NEXT load, silently resetting the
 * user's whole arrangement. Every surface reading a stored layout must pass it
 * through here first, which `loadArrangement` below does for anyone using it.
 *
 * ★★ THE HOSTILE INPUTS THAT MATTER ARRIVE BY TWO DIFFERENT DOORS, and the
 * narrower door is closed by JSON rather than by anything here. Through
 * `loadArrangement` a blob has been through `JSON.parse`, so it can hold `null`,
 * a wrong type or a stale `v` but never NaN, Infinity or `undefined` — JSON has
 * no literal for any of them. This function is EXPORTED, though, and the pointer
 * in `arrangement-layout.ts` invites calling it on a blob from somewhere else:
 * an in-memory object, a structured clone, a test fixture. Those CAN carry NaN,
 * which is why `isPlacedBlock` uses `Number.isFinite` — see its own ★★.
 *
 * ★ The narrowing is to `ArrangementLayout<string>`, the widest id: this cannot
 * know a surface's id union, and a surface's own `ArrangementLayout<Id>` is
 * assignable TO that but not FROM it. The cast back down belongs at the
 * surface's adapter, where it is one visible line rather than a hidden generic.
 * ★★ THE ID IS NOT THE ONLY UNSOUND AXIS — the SPANS are too, and by more. A
 * `PlacedBlock`'s `w`/`h` are `BlockSpan = 1|2|3|4`, while this accepts any
 * finite number: `99`, `-3` and `2.7` all pass. That is the deliberate
 * looseness `isPlacedBlock` documents (range is `reconcile`'s job — it clamps
 * per axis), but do not read the narrowing as proving anything about the values
 * beyond "there is a number there".
 */
export function isArrangementLayout(v: unknown): v is ArrangementLayout<string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const l = v as { v?: unknown; board?: unknown; hidden?: unknown };
  if (l.v !== 1 || !Array.isArray(l.board) || !Array.isArray(l.hidden)) return false;
  return (l.board as unknown[]).every(isPlacedBlock)
    && (l.hidden as unknown[]).every((h) => typeof h === "string");
}

/** The whole `{[projectId]: layout}` map for ONE key, unvalidated. A missing
 *  key, a corrupt blob or a non-object payload all read as `{}` — never a
 *  throw. */
function readMap(key: string): Record<string, unknown> {
  const parsed = readDeviceJson<unknown>(key, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

export function loadArrangement(key: string, projectId: string): ArrangementLayout<string> | null {
  const entry = readMap(key)[projectId];
  return isArrangementLayout(entry) ? entry : null;
}

export function saveArrangement(
  key: string,
  projectId: string,
  layout: ArrangementLayout<string>,
): void {
  const map = readMap(key);
  delete map[projectId];                                  // re-add so it is newest
  map[projectId] = layout;
  const keys = Object.keys(map);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_PROJECTS))) delete map[stale];
  // Quota or private-mode failure is swallowed by `writeDeviceJson`: the
  // arrangement is a preference, not data — losing it must never break the
  // surface.
  writeDeviceJson(key, map);
}
