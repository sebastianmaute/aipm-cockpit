"use client";
/**
 * The Reports binding of the shared arrangement hook, plus the one-time
 * migration off `settings.reports.extra`.
 *
 * ★★ THE ENGINE'S LANDMINES LIVE IN `use-arrangement.ts` — the lazy-initialiser
 * initial read, the render-body project-switch read and the argument for it, the
 * id-and-layout-as-one-state fix, the separate flush effect, and the full `seed`
 * contract. Read them there before changing anything here.
 *
 * ★★★ `settings.reports.extra` HAS RETIRED AS THE OWNER OF ORDER AND VISIBILITY.
 * `reports.tsx` binds this hook and no longer WRITES the field — the arrangement
 * owns order and visibility for every block, built-in and addable alike. The
 * field is still READ, for one purpose only: it is the input to the one-time
 * migration seed below. Reproduce:
 *   `grep -n "onChangeExtraReports(" src/app/reports.tsx`  → no call at all; the
 *     surviving mentions are the prop TYPE and a comment saying the write is gone
 *   `grep -rn "useReportsArrangement" src/`                → bound in `reports.tsx`
 * ★★ THIS BLOCK HAS NOW BEEN WRONG IN BOTH DIRECTIONS, WHICH IS THE LESSON. It
 * first stated the retirement in the present tense while the write was still
 * live; the correction pushed it into the future ("an obligation on Task 12, not
 * a description of today"), and that correction was itself re-staled when Task 12
 * landed later ON THIS SAME BRANCH. A correction is a NEW claim and inherits none
 * of the verification of the thing it corrects — re-run the greps rather than
 * trusting this paragraph's tense.
 * ★ The field stays on the `Settings` type: the migration seed still needs it, and
 * removing it is a separate change with its own storage surface.
 *
 * ★★ CALLER CONTRACT — `extraReports` MAY BE A FRESH ARRAY EACH RENDER. The
 * seed closes over it and nothing memoises on its identity, so a literal is
 * harmless. ★ But that safety is a property of `use-arrangement.ts`'s internals
 * (the seed sits in no dependency array), not a promise of this signature —
 * stated here so the caller does not have to derive it, and so a future change
 * that DOES memoise on it knows it is changing a contract.
 */
import { useArrangement, type ArrangementApi } from "./use-arrangement";
import type { ArrangementLayout } from "./arrangement-layout";
import {
  REPORT_BLOCKS, REPORTS_DEFAULT_LAYOUT, REPORTS_LAYOUT_KEY, type ReportBlockId,
} from "./report-blocks";
import { ADDABLE_REPORTS, type AddableReportId } from "./addable-reports";

export function useReportsArrangement({
  projectId,
  extraReports,
  isPopout = false,
}: {
  projectId: string;
  /**
   * The retired setting, read only to seed the migration below.
   *
   * ★★ NOT SANITISED AT THIS BOUNDARY, and an earlier revision of this line
   * documented it as `resolveExtraReports(settings.reports?.extra)`, which names
   * a call that does not happen here. What `workspace-section.tsx` actually
   * passes is `settings.reports?.extra ?? DEFAULT_EXTRA_REPORTS`, and
   * `reports.tsx` substitutes its own module-level `EMPTY_EXTRA_REPORTS` when
   * the prop is absent. `resolveExtraReports` DOES run — in `use-settings.ts`,
   * at LOAD — so the value is normally clean, but that is a property of the
   * load path, not a guarantee this signature can make.
   * ★ The seed is safe regardless, and for a reason worth naming rather than
   * assuming: it iterates `ADDABLE_REPORTS` and only ASKS whether each id is in
   * the incoming set, so an unknown or malformed entry can at worst fail to
   * match. Nothing here trusts the input's contents.
   */
  extraReports: readonly AddableReportId[];
  isPopout?: boolean;
}): ArrangementApi<ReportBlockId> {
  /**
   * The one-time migration off `settings.reports.extra`: every addable report
   * ABSENT from the setting starts hidden.
   *
   * ★★★ IT RUNS DURING RENDER, so it is PURE and must stay that way. Both of
   * `readLayout`'s call sites in `use-arrangement.ts` are render-phase — the
   * lazy `useState` initialiser and the project-switch reconcile — so deleting
   * or rewriting `settings.reports.extra` in here would be a render-phase side
   * effect, and StrictMode double-invokes a lazy initialiser besides. The
   * setting is simply left where it is; nothing reads it after this.
   *
   * ★★★ "ONE-TIME" IS A PROPERTY OF STORAGE, NOT OF THIS FUNCTION — AND THE GAP
   * THAT USED TO FOLLOW FROM THAT IS NOW CLOSED (open-followups §427). The
   * marker is that the read returned something USABLE for this project. It used
   * to be unable to distinguish a MISSING key from a REJECTED one, because
   * `loadArrangement` collapsed both into `null` and `use-arrangement.ts` read
   * `stored ?? seed?.() ?? null` — so a blob written by a future `v: 2` build,
   * or a hand-corrupted one, re-ran this migration.
   * ★★ WHY THAT MATTERED MORE HERE THAN ON THE DASHBOARD, kept because it is
   * the reason the fix was worth making rather than accepting: the Dashboard
   * reverts to a DEFAULT — a whole arrangement, which a user notices and can
   * attribute. Reports reverted to a STALE SETTING, frozen at whatever
   * `settings.reports.extra` held when the panel stopped writing it, losing
   * exactly the reports the user had restored from the shelf — which reads as
   * the app quietly forgetting a few choices rather than as a reset.
   * ★★ THE FIX IS THE CHEAPER OF THE TWO THIS BLOCK USED TO LIST, and it is one
   * layer down rather than a second marker key here: `readArrangement`
   * (`arrangement-store.ts`) reports `missing` | `rejected` | `ok`, and
   * `useArrangement` offers the seed on `missing` ALONE. Zero new storage
   * surface, and it closed the Dashboard's accepted downgrade trade at the same
   * time. A rejected blob now falls through to the surface's own fallback.
   * ★ A marker key here would have closed this gap only, and is still the wrong
   * option — recorded so it does not get re-derived as the obvious one.
   * Pinned by `use-reports-arrangement.test.tsx`'s "does NOT re-run the seed
   * when the stored blob is REJECTED" and its "DOES run the seed when nothing is
   * stored" sibling.
   * ★★ THE MUTANT REDDENS ONE TEST PER FILE, NOT THIS PAIR, and an earlier
   * wording here said "the pair is mutation-proved … turns exactly those two
   * red", whose only antecedent was the pair just named. Relaxing
   * `use-arrangement.ts`'s `read.status === "missing"` to `!== "ok"` reddens the
   * two REJECTED tests, one here and one in `use-arrangement.test.tsx`. The
   * DOES-run sibling CANNOT redden under it — `missing` satisfies `!== "ok"`
   * identically — which is the point of having it: it guards against the seed
   * being switched off wholesale, a different mutant.
   *
   * ★ The result is reconciled like any stored blob, so a stale or malformed
   * setting cannot corrupt the board: this names only addable ids, so every
   * builtin is absent from `hidden` and `reconcile` step 2 re-inserts all of
   * them — including blocks that did not exist when the setting was written.
   *
   * ★★ NOT WRAPPED IN `useCallback`, and that is deliberate rather than an
   * omission from the plan's sketch. `seed` reaches nothing but `readLayout`,
   * which is a plain function rebuilt every render, and it appears in NO
   * dependency array inside `use-arrangement.ts` — verify with
   * `grep -n "\[.*seed.*\]" src/app/use-arrangement.ts`, which returns nothing.
   * Memoising it would buy no stability that anything reads, while implying one
   * that matters.
   */
  const seed = (): ArrangementLayout<ReportBlockId> => {
    const kept = new Set<string>(extraReports);
    const hidden = ADDABLE_REPORTS.filter((r) => !kept.has(r.id)).map((r) => r.id);
    const hiddenSet = new Set<string>(hidden);
    return {
      v: 1,
      // ★ Filtering the board is belt-and-braces: `reconcile` already drops any
      // id that is also in `hidden`, on both its passes. It is kept so the
      // returned object is internally consistent on its own terms — a layout
      // whose board and hidden list overlap is not a thing this surface should
      // ever hand out, reconciled or not.
      board: REPORTS_DEFAULT_LAYOUT.board.filter((b) => !hiddenSet.has(b.id)),
      hidden,
    };
  };

  return useArrangement<ReportBlockId>({
    // ★★ BOTH MODULE-LEVEL CONSTANTS FROM `report-blocks.ts`, never rebuilt
    // here. `use-arrangement.ts` carries a dev-only detector that warns if
    // either changes identity between renders, and `reset()`'s by-reference
    // contract depends on `fallback` in particular.
    catalogue: REPORT_BLOCKS,
    storageKey: REPORTS_LAYOUT_KEY,
    fallback: REPORTS_DEFAULT_LAYOUT,
    projectId,
    // ★ The public prop is `isPopout` — a Reports feature — and the generic
    // parameter is `readOnly`, which is what it MEANS. Mapping between them is
    // the adapter's job, exactly as in `use-dashboard-layout.ts`.
    readOnly: isPopout,
    seed,
  });
}
