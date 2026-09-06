/**
 * The Reports block catalogue — the single declaration of what blocks the
 * Reports view has, how big each is by default, and how far a user may resize
 * it. The Reports analogue of `dashboard-tiles.ts`.
 *
 * Pure and i18n-free: it carries i18n KEYS, never strings, so it stays
 * importable from a bare node process. ★ The `TranslationKey` import is
 * TYPE-ONLY, and that is what keeps that promise true — the import is erased at
 * compile time, so nothing here pulls the dictionaries in. A VALUE import from
 * `./i18n` would break it.
 *
 * ★★★ TWO SIZING DECISIONS HERE ARE LOAD-BEARING AND NO TEST CAN CHECK EITHER,
 * because jsdom has no layout engine. Both are owed a browser eye-verify, and a
 * green unit suite is not evidence that anyone has looked at them:
 *
 *   1. THE SEVEN `minW: 4` ROWS. Those blocks carry column-resizable tables or a
 *      whole embedded report panel. `BlockSpan` is `1|2|3|4` over a four-column
 *      grid, so a narrower `minW` lets a user squeeze an entire report table
 *      into a quarter of the width, where it is unusable. `minW` is the only
 *      thing preventing it. `report-blocks.test.ts` pins the NUMBERS; nothing
 *      pins the rendered result.
 *   2. REPORTS MUST BIND A 120px ROW UNIT, NOT THE DASHBOARD'S 80px. ★★★ THIS
 *      IS AN OBLIGATION ON WHOEVER BINDS THE GRID, NOT A DESCRIPTION OF TODAY —
 *      no `auto-rows-[120px]` exists anywhere in `src/` or `e2e/` yet; the only
 *      row units in the repo are the Dashboard's `auto-rows-[80px]` and
 *      `auto-rows-[72px]`. Reproduce with
 *      `grep -rn "auto-rows-" src e2e --include=*.ts --include=*.tsx`.
 *      The reason: `BlockSpan` caps at 4, so at the Dashboard's unit the tallest
 *      a block could ever be is 320px — too short for an embedded report. The
 *      class is injected as `ArrangementGrid`'s `rowClass` rather than declared
 *      here, because this file is i18n- and DOM-free; the REASON lives here
 *      because it is a property of these blocks' CONTENT, not of the grid. It is
 *      assertable once bound — `arrangement-grid.test.tsx` already pins injected
 *      row and gap classes the same way.
 *
 * ★★ A CATALOGUE CANNOT DECLARE A BLOCK HIDDEN BY DEFAULT. `defaultLayout`
 * places every member and `reconcile` re-inserts every absent one, by design —
 * see `arrangement-layout.ts`. Reports' "only the reports you added" behaviour
 * is therefore a one-time migration SEED that writes the `hidden` list
 * explicitly, not something expressible here. `REPORTS_DEFAULT_LAYOUT` below is
 * deliberately everything-visible so that split stays honest.
 */
import type { TranslationKey } from "./i18n";
import {
  defaultLayout, specById,
  type ArrangementLayout, type BlockSpec,
} from "./arrangement-layout";
import type { FeatureModuleId } from "./feature-modules";
import { ADDABLE_REPORTS, type AddableReportId } from "./addable-reports";

export type ReportBuiltinId =
  | "stats" | "groupHealth" | "openByStatus" | "completionOutcomes"
  | "inquiries" | "byAssignee" | "byPriority" | "byGroup" | "byLabel";

export type ReportBlockId = ReportBuiltinId | AddableReportId;

/** ★ The Reports analogue of `TileGateInput`. A gate decides what RENDERS,
 *  never what is STORED — a gated-off block keeps its position, so switching a
 *  module off and on again does not lose it. `reconcile` takes no gate, and the
 *  render layer is what filters. ★ Optional and unused by every entry today;
 *  it is declared because the engine's `BlockSpec` deliberately has no `gate`
 *  field and a surface's own spec type is where one belongs. */
export interface ReportBlockSpec extends BlockSpec<ReportBlockId> {
  gate?: (features: readonly FeatureModuleId[]) => boolean;
}

/** ★★ Its own key, never the Dashboard's. `arrangement-store.ts` caps and evicts
 *  PER KEY, so a shared key would make the two surfaces compete for one
 *  50-project budget AND read each other's layouts — every id would then be
 *  dropped by `reconcile` as unknown, silently resetting whichever board loaded
 *  second. ★ The `aipm-cockpit:` prefix is required: `clearAppConfig` sweeps by
 *  prefix, so a key without it survives a reset that claims to clear everything. */
export const REPORTS_LAYOUT_KEY = "aipm-cockpit:reports-layout";

export const REPORT_BLOCKS: readonly ReportBlockSpec[] = [
  { id: "stats",              labelKey: "reportsHeadline",            w: 4, h: 1, minW: 2, maxW: 4, minH: 1, maxH: 2 },
  { id: "groupHealth",        labelKey: "reportsGroupHealth",         w: 4, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 4 },
  { id: "openByStatus",       labelKey: "reportsOpenByStatus",        w: 2, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 3 },
  { id: "completionOutcomes", labelKey: "reportsCompletionOutcomes",  w: 2, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 3 },
  { id: "inquiries",          labelKey: "reportsInquiries",           w: 4, h: 3, minW: 2, maxW: 4, minH: 2, maxH: 4 },
  { id: "byAssignee",         labelKey: "reportsByAssignee",          w: 4, h: 3, minW: 4, maxW: 4, minH: 2, maxH: 4 },
  { id: "byPriority",         labelKey: "reportsByPriority",          w: 2, h: 1, minW: 1, maxW: 4, minH: 1, maxH: 2 },
  { id: "byGroup",            labelKey: "reportsByGroup",             w: 4, h: 3, minW: 4, maxW: 4, minH: 2, maxH: 4 },
  { id: "byLabel",            labelKey: "reportsByLabel",             w: 4, h: 3, minW: 4, maxW: 4, minH: 2, maxH: 4 },
  // ★★ DERIVED FROM `ADDABLE_REPORTS`, NEVER RETYPED. Each one embeds a whole
  // report panel, so all four are full width and tall. Deriving keeps the id
  // set and the title keys in one place — a hand-copied list would drift the
  // moment a fifth addable report lands, and `reconcile` would then silently
  // drop it as an unknown id.
  // ★ Order matters: `reconcile` inserts a NEW catalogue block after its nearest
  // present predecessor, so this order decides where a later-added report lands
  // on a board a user already arranged.
  ...ADDABLE_REPORTS.map((r) => ({
    id: r.id,
    labelKey: r.titleKey satisfies TranslationKey,
    w: 4 as const, h: 4 as const, minW: 4 as const, maxW: 4 as const, minH: 2 as const, maxH: 4 as const,
  })),
];

/** ★ Delegates to the engine's `specById`, which Task 4 made generic over the
 *  SPEC type precisely so it hands back the caller's own spec rather than
 *  narrowing to `BlockSpec` — that is what keeps `gate` readable here. A local
 *  `find` would be a second implementation of the same lookup. */
export function reportBlockById(id: ReportBlockId): ReportBlockSpec | undefined {
  return specById(REPORT_BLOCKS, id);
}

/**
 * Every block on the board, in catalogue order, at its default size.
 *
 * ★★★ ONE INSTANCE, MODULE-LEVEL, DECLARED ONLY HERE. `reconcile(…, null, …)`
 * and `reset()` both hand it back BY REFERENCE, and the engine's four mutators
 * signal "no change" the same way — so a factory called per use, or a second
 * declaration in the adapter, breaks the no-op contract silently.
 * `use-arrangement.ts` carries a dev-only warning for exactly that identity
 * changing between renders. The plan declared this in two places; it belongs in
 * this file alone.
 */
export const REPORTS_DEFAULT_LAYOUT: ArrangementLayout<ReportBlockId> =
  defaultLayout(REPORT_BLOCKS);
