// src/app/inline-ai-edit/link-titles.ts
//
// Pure, i18n-free. Renders a link field's id list as something a human can read
// on the AI edit-preview card. No React, no DOM, no `t(...)` — the surface that
// mounts this translates its own labels; the ids and titles here are data.
import { type Workspace } from "../workspace";
import { type LinkField } from "./entity-descriptor";

/** Prefix for an id whose row does not exist, or whose title is blank. */
export const UNKNOWN_ID_MARKER = "#";

/** Resolve an id list to a readable, comma-joined title list.
 *
 *  ★★ A dangling id is MARKED, never dropped. `sanitizeIdList` keeps any
 *   positive integer and nothing prunes against the live rows, so dangling ids
 *   genuinely exist in stored data. Omitting one would make a preview that is
 *   missing a link look identical to a preview of a link being removed.
 *
 *  ★★★ `titleOf` TAKES THE WORKSPACE AND MUST BE CALLED WITH IT. The resource
 *   descriptor's `roleId` is the reason: a `Role` has no `name`, so its label is
 *   `disciplineId` + `gradeId` resolved against two OTHER workspace arrays
 *   (`roleLabel`). A one-argument call compiles — the second parameter is simply
 *   `undefined` at runtime — and every list-kind field goes on rendering
 *   correctly, so the defect surfaces only on roles, as a blank that is
 *   indistinguishable from the link having been dropped. Pinned by the
 *   "passes the workspace through to titleOf" test, which drives the REAL
 *   descriptor field rather than a fixture.
 *
 *  ★ Linear `.find` per id, matching `liveRowTitle` (`chat-proposal-stage.ts`).
 *   That is O(rows x ids); the lists here are short and the alternative — a
 *   memoised map on `WorkspaceProvider` — re-renders every direct consumer on
 *   any workspace change, which is a documented landmine. Measure before
 *   changing this. */
export function resolveLinkTitles(ids: readonly number[], link: LinkField, ws: Workspace): string {
  const rows = ws[link.wsKey] as unknown;
  const list = Array.isArray(rows) ? (rows as ReadonlyArray<Record<string, unknown>>) : [];
  return ids
    .map((id) => {
      const row = list.find((r) => Number(r.id) === id);
      const title = row ? link.titleOf(row, ws) : "";
      return typeof title === "string" && title.trim() !== "" ? title : `${UNKNOWN_ID_MARKER}${id}`;
    })
    .join(", ");
}
