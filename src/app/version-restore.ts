// src/app/version-restore.ts
// Pure selective restore. Given the current workspace, a chosen version's
// workspace, the diff between them (diffWorkspaces(version, now)), and a
// selection of changes/fields, returns a NEW workspace with only the selected
// changes reverted toward the version. Immutable; never mutates inputs.

import type { Workspace } from "./workspace";
import { COLLECTION_SPECS, type RecordId, type VersionChange } from "./version-diff";

/** Selection keyed by changeKey(collection, recordId); value is "all" (whole
 *  record / all changed fields) or an explicit list of field names. */
export type RestoreSelection = Record<string, "all" | string[]>;

/** ★★ NOT a `${collection}:${id}` join, and the reason is a data defect rather
 *  than tidiness. `knowledgeItems` ids are STRINGS, so a raw join is ambiguous
 *  two ways: an id containing the separator makes `x` + `a:b` collide with
 *  `x:a` + `b`, and an id of literally "_" collides with the `null` singleton
 *  sentinel. Either one silently reverts the WRONG record — the selection finds
 *  its change by this key. JSON encoding is unambiguous for both and stays
 *  readable in a devtools inspection.
 *  ★ Keys are built and looked up within ONE session (`RestoreSelection` is
 *  never persisted), so changing this format needs no compatibility shim.
 *  ★ The guarantee is over strings and FINITE POSITIVE numbers. `NaN` and
 *  ±Infinity stringify to `null` and would collide with the singleton
 *  sentinel — unreachable because every slice's sanitizer rejects a
 *  non-finite or non-positive id before a diff can see it, but do not widen
 *  `RecordId` past those two shapes without revisiting this. */
export function changeKey(collection: string, recordId: RecordId | null): string {
  return JSON.stringify([collection, recordId ?? null]);
}

type Rec = Record<string, unknown>;
const byId = (arr: unknown[]): Map<RecordId, Rec> =>
  new Map((arr ?? []).map((r) => [(r as { id: RecordId }).id, { ...(r as Rec) }]));

function mergeFields(target: Rec, source: Rec, fields: string[] | "all", allChanged: string[]): Rec {
  const picks = fields === "all" ? allChanged : fields;
  const next = { ...target };
  for (const f of picks) {
    if (f in source) next[f] = source[f];
    else delete next[f];
  }
  return next;
}

export function applyRestore(
  current: Workspace,
  version: Workspace,
  changes: VersionChange[],
  selection: RestoreSelection,
): Workspace {
  const changeByKey = new Map(changes.map((c) => [changeKey(c.collection, c.recordId), c]));
  const result: Record<string, unknown> = { ...(current as unknown as Record<string, unknown>) };

  for (const spec of COLLECTION_SPECS) {
    // ★★ Diff-visible but NOT restorable. The slice is carried through from
    // `current` untouched — exactly what an absent registry row used to do —
    // because it owns its own history and a second writer would fight it.
    // ★★ Measured by mutation, not reasoned: delete this line and a restore to
    // a capture predating the slice DELETES the documents (1 → 0 on both
    // slices) rather than merely failing to revert them, because every live
    // record reads as "added" against a capture that has no such key. This is
    // a DATA-LOSS guard, not only a single-writer one. Pinned by BOTH
    // "skips a collection marked restorable: false" and "removes the
    // restorable arrays on a restore to a short pre-0.259.0 capture".
    if (spec.restorable === false) continue;
    const key = spec.key as string;
    if (spec.kind === "list") {
      // ★★★ AN ABSENT KEY IS NOT AN EMPTY SLICE, and treating it as one DELETES
      // user data. `workspaceToJson` omits an additive slice's key when the
      // array is empty, and a capture taken before `getVersionPayload` grew to
      // emit these slices (db217e08, 2026-08-25) could not carry them at all —
      // so `undefined` means "this capture cannot speak about this slice". Read
      // as empty, every live record diffs as "added" and the branch below runs
      // `cur.delete(id)` on all of them. Manual checkpoints are never pruned
      // (`version-schema.ts` prunes `trigger = 'auto'` only), so a pre-0.259.0
      // checkpoint stays restorable — and destructive — indefinitely.
      // ★★ KNOWN IMPRECISION, deliberate: an empty slice and an absent one are
      // indistinguishable here, so restoring to a capture where the user
      // genuinely had zero records will NOT re-empty the current ones. That is
      // the safe direction; separating the two needs a capture-format marker on
      // the payload, which nothing writes today.
      if ((version as unknown as Record<string, unknown>)[key] === undefined) continue;
      const cur = byId(current[spec.key] as unknown[]);
      const ver = byId(version[spec.key] as unknown[]);
      let touched = false;
      for (const [selKey, sel] of Object.entries(selection)) {
        const change = changeByKey.get(selKey);
        if (!change || change.collection !== key) continue;
        const id = change.recordId as RecordId;
        if (change.type === "removed") {
          cur.set(id, ver.get(id)!);
          touched = true;
        } else if (change.type === "added") {
          cur.delete(id);
          touched = true;
        } else {
          const verRec = ver.get(id) ?? {};
          const allChanged = change.fields.map((f) => f.field);
          cur.set(id, mergeFields(cur.get(id) ?? {}, verRec, sel, allChanged));
          touched = true;
        }
      }
      if (touched) result[key] = [...cur.values()];
    } else {
      // ★★★ THE SAME ABSENT-KEY RULE AS THE LIST BRANCH, AND IT IS NOT COSMETIC
      // SYMMETRY — `db217e08` (2026-08-25) added SIX slices to
      // `getVersionPayload`: five arrays AND the singleton `settingsOverrides`.
      // Guarding only the arrays left the sixth wiping on exactly the input the
      // list guard exists for. `mergeFields(current, {}, "all", …)` takes the
      // `else delete next[f]` arm for every field and returns `{}`, so a
      // restore to any pre-db217e08 capture blanks the project's timezone,
      // notification and next-actions overrides; `hasAnyOverride({})` is false,
      // so the next save omits the key and the loss is permanent. Manual
      // checkpoints are never pruned (`version-schema.ts` prunes
      // `trigger = 'auto'` only), so it stays reachable indefinitely.
      // ★★ UNIFORM, not `settingsOverrides`-only, and that costs something real:
      // `project` / `steeringCommittee` / `timelogLinks` predate db217e08, so
      // for THEM an absent key genuinely means "unset" and this guard turns a
      // revert-to-unset into a no-op. That is the same imprecision the list
      // branch already accepts, in the same safe direction — failing to revert
      // is recoverable by hand, deleting is not — and one rule for both kinds
      // beats a per-slice exception list that the next added singleton would
      // silently miss. Separating the two needs a capture-format marker on the
      // payload, which nothing writes today (open-followups §259).
      if ((version as unknown as Record<string, unknown>)[key] === undefined) continue;
      const selKey = changeKey(key, null);
      const sel = selection[selKey];
      const change = changeByKey.get(selKey);
      if (!sel || !change) continue;
      const allChanged = change.fields.map((f) => f.field);
      const reverted = mergeFields((current[spec.key] ?? {}) as Rec, (version[spec.key] ?? {}) as Rec, sel, allChanged);
      result[key] = reverted;
    }
  }
  return result as unknown as Workspace;
}
