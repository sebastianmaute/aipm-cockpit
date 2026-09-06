import { describe, expect, it } from "vitest";
import {
  REPORT_BLOCKS, REPORTS_DEFAULT_LAYOUT, REPORTS_LAYOUT_KEY, reportBlockById,
  type ReportBlockId,
} from "./report-blocks";
import { ADDABLE_REPORTS } from "./addable-reports";
import { DASHBOARD_LAYOUT_KEY } from "./dashboard-layout-store";
import { defaultLayout, reconcile } from "./arrangement-layout";
import { t } from "./i18n";

describe("report-blocks — the catalogue", () => {
  it("declares every addable report as a block", () => {
    const ids = new Set<string>(REPORT_BLOCKS.map((b) => b.id));
    for (const r of ADDABLE_REPORTS) expect(ids.has(r.id)).toBe(true);
  });

  it("reuses each addable report's own title key, in ADDABLE_REPORTS order", () => {
    // ★ Not cosmetic: `ADDABLE_REPORTS` order is the order those reports have
    // always rendered in, and `reconcile` inserts a NEW catalogue block after its
    // nearest present predecessor — so catalogue order is what decides where a
    // later-added report lands on an existing user's board.
    const addable = REPORT_BLOCKS.filter((b) => ADDABLE_REPORTS.some((r) => r.id === b.id));
    expect(addable.map((b) => b.id)).toEqual(ADDABLE_REPORTS.map((r) => r.id));
    expect(addable.map((b) => b.labelKey)).toEqual(ADDABLE_REPORTS.map((r) => r.titleKey));
  });

  it("has no duplicate ids", () => {
    const ids = REPORT_BLOCKS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("pins the table-bearing blocks to full width", () => {
    // ★★★ THE LOAD-BEARING ONE. jsdom has no layout, so nothing else in the
    // suite can tell a squeezed table from a readable one. These seven carry
    // column-resizable tables or a whole embedded report panel; at minW 1 they
    // are a quarter of a four-column grid and unusable. This test is the only
    // guard that exists, and the VISUAL result is still owed a browser
    // eye-verify — a green run here does not mean anyone has looked at it.
    const FULL: ReportBlockId[] = [
      "byAssignee", "byGroup", "byLabel",
      "raid-report", "budget-report", "resource-report", "stakeholder-report",
    ];
    for (const id of FULL) {
      const b = REPORT_BLOCKS.find((x) => x.id === id)!;
      expect(b, `${id} is not in the catalogue`).toBeDefined();
      expect(b.minW, `${id} must not be narrowable`).toBe(4);
    }
  });

  it("keeps every span within its own bounds", () => {
    for (const b of REPORT_BLOCKS) {
      expect(b.minW, `${b.id} w`).toBeLessThanOrEqual(b.w);
      expect(b.w, `${b.id} w`).toBeLessThanOrEqual(b.maxW);
      expect(b.minH, `${b.id} h`).toBeLessThanOrEqual(b.h);
      expect(b.h, `${b.id} h`).toBeLessThanOrEqual(b.maxH);
    }
  });

  it("gives every block a label key that resolves to a real string", () => {
    // ★ `TranslationKey` already makes a TYPO a build error. What it cannot
    // catch is a key that exists and resolves to an empty string, which would
    // render a title-less block and an accessible name of just " – ".
    for (const b of REPORT_BLOCKS) {
      expect(t("en-US", b.labelKey), `${b.id} labelKey`).not.toBe("");
    }
  });

  it("resolves a known id and returns undefined for an unknown one", () => {
    expect(reportBlockById("stats")?.id).toBe("stats");
    expect(reportBlockById("nope" as ReportBlockId)).toBeUndefined();
  });
});

describe("report-blocks — the storage key", () => {
  it("keys its storage under the app prefix, so clearAppConfig sweeps it", () => {
    // ★★ The sweep is by PREFIX (`app-reset.ts` clears every `aipm-cockpit:*`
    // localStorage key), so a key without it survives a reset that claims to
    // have cleared everything.
    expect(REPORTS_LAYOUT_KEY.startsWith("aipm-cockpit:")).toBe(true);
  });

  it("does not share the Dashboard's key", () => {
    // ★★ `arrangement-store.ts` caps and evicts PER KEY. Sharing one would make
    // the two surfaces compete for the same 50-project budget and, worse, read
    // each other's layouts — every id would then be dropped by `reconcile` as
    // unknown, silently resetting whichever board loaded second.
    expect(REPORTS_LAYOUT_KEY).not.toBe(DASHBOARD_LAYOUT_KEY);
  });
});

describe("report-blocks — the default layout", () => {
  it("is ONE module-level instance that reconcile hands back BY REFERENCE", () => {
    // ★★★ The contract the whole subsystem rests on: `reconcile(…, null, …)` and
    // `reset()` both return the fallback by reference, and `use-arrangement.ts`
    // carries a dev-only detector that warns if this identity changes between
    // renders. A factory called per use would defeat both silently.
    expect(reconcile(REPORT_BLOCKS, null, REPORTS_DEFAULT_LAYOUT)).toBe(REPORTS_DEFAULT_LAYOUT);
    // Positive control: a freshly built layout is a DIFFERENT object, so the
    // assertion above is about identity rather than about deep equality.
    expect(defaultLayout(REPORT_BLOCKS)).not.toBe(REPORTS_DEFAULT_LAYOUT);
  });

  it("places every catalogue block on the board with nothing hidden", () => {
    // ★★ A catalogue CANNOT declare a block hidden-by-default: `defaultLayout`
    // places every member and `reconcile` re-inserts every absent one. Reports'
    // "only the reports you added" behaviour is therefore Task 10's migration
    // SEED, which writes the `hidden` list explicitly — not something this file
    // can express. Keeping `hidden` empty here is what makes that split honest.
    expect(REPORTS_DEFAULT_LAYOUT.board.map((p) => p.id)).toEqual(REPORT_BLOCKS.map((b) => b.id));
    expect(REPORTS_DEFAULT_LAYOUT.hidden).toEqual([]);
  });

  it("carries each block's own default size onto the board", () => {
    for (const b of REPORT_BLOCKS) {
      const placed = REPORTS_DEFAULT_LAYOUT.board.find((p) => p.id === b.id)!;
      expect([placed.w, placed.h], `${b.id}`).toEqual([b.w, b.h]);
    }
  });
});
