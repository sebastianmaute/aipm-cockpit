// src/app/version-restore.ts
// Pure selective restore. Given the current workspace, a chosen version's
// workspace, the diff between them (diffWorkspaces(version, now)), and a
// selection of changes/fields, returns a NEW workspace with only the selected
// changes reverted toward the version. Immutable; never mutates inputs.

import type { Workspace } from "./workspace";
import { COLLECTION_SPECS, type VersionChange } from "./version-diff";

/** Selection keyed by changeKey(collection, recordId); value is "all" (whole
 *  record / all changed fields) or an explicit list of field names. */
export type RestoreSelection = Record<string, "all" | string[]>;

export function changeKey(collection: string, recordId: number | null): string {
  return `${collection}:${recordId ?? "_"}`;
}

type Rec = Record<string, unknown>;
const byId = (arr: unknown[]): Map<number, Rec> =>
  new Map((arr ?? []).map((r) => [(r as { id: number }).id, { ...(r as Rec) }]));

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
    const key = spec.key as string;
    if (spec.kind === "list") {
      const cur = byId(current[spec.key] as unknown[]);
      const ver = byId(version[spec.key] as unknown[]);
      let touched = false;
      for (const [selKey, sel] of Object.entries(selection)) {
        const change = changeByKey.get(selKey);
        if (!change || change.collection !== key) continue;
        const id = change.recordId as number;
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
