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
 * ★★★ `settings.reports.extra` RETIRES AS THE OWNER OF ORDER AND VISIBILITY —
 * AS AN OBLIGATION ON TASK 12, NOT AS A DESCRIPTION OF TODAY. An earlier
 * revision of this block stated it in the present tense ("the field is read by
 * nothing, and nothing writes it"), which was measurably false: `reports.tsx`
 * still reads the prop and still writes the field through
 * `onChangeExtraReports` at four sites, and nothing calls this hook yet.
 * Reproduce both halves:
 *   `grep -n "onChangeExtraReports" src/app/reports.tsx`
 *   `grep -rn "useReportsArrangement" src/`
 * Task 12 must stop writing the field when it binds this hook. The field then
 * stays on the Settings type because removing it is a separate change with its
 * own storage surface.
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
  /** `resolveExtraReports(settings.reports?.extra)` — the retiring setting. */
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
   * ★★★ "ONE-TIME" IS A PROPERTY OF STORAGE, NOT OF THIS FUNCTION, AND THE GAP
   * IS REAL. The marker is that `loadArrangement` returned something USABLE for
   * this project, and it cannot distinguish a MISSING key from a REJECTED one —
   * `use-arrangement.ts` reads `stored ?? seed?.() ?? null`. So a blob written
   * by a future `v: 2` build, or a hand-corrupted one, re-runs this migration.
   * ★★ THAT WILL BE WORSE HERE THAN ON THE DASHBOARD ONCE TASK 12 LANDS, and
   * the tense matters. The Dashboard reverts to a DEFAULT — a whole arrangement,
   * which a user notices and can attribute. Reports will revert to a STALE
   * SETTING frozen at its pre-migration value, losing exactly the reports the
   * user had restored from the shelf, which reads as the app quietly forgetting
   * a few choices. ★★★ TODAY THE GAP IS MILDER, because `reports.tsx` still
   * WRITES `settings.reports.extra` (see the file header's reproduce), so a
   * re-run seed restores from a CURRENT setting rather than a frozen one. It
   * becomes the described failure at the moment Task 12 stops writing the field.
   * Pinned either way by "RE-RUNS the seed when the stored blob is REJECTED", so
   * the behaviour is recorded rather than assumed.
   *
   * ★★ TWO WAYS TO CLOSE IT, AND THE CHEAPER ONE IS NOT THE OBVIOUS ONE. A
   * second marker key is new storage surface for a case `arrangement-store.ts`
   * already accepts losing, and it would close this gap only. The cheaper fix is
   * one layer down: `loadArrangement` collapses MISSING and REJECTED into a
   * single `null`, and it KNOWS which case it is at that boundary. Distinguishing
   * them there would let `use-arrangement.ts` offer the seed on MISSING alone —
   * zero new storage surface, and it would close the Dashboard's accepted
   * downgrade trade at the same time. Neither call is made here; recorded so the
   * marker key does not become the only remembered option.
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
