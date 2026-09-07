import { beforeAll, describe, expect, it } from "vitest";
import {
  REPORT_BLOCKS, REPORTS_DEFAULT_LAYOUT, REPORTS_LAYOUT_KEY, reportBlockById,
  type ReportBlockId,
} from "./report-blocks";
import { ADDABLE_REPORTS } from "./addable-reports";
import { DASHBOARD_LAYOUT_KEY } from "./dashboard-layout-store";
import { defaultLayout, reconcile, type BlockSpan } from "./arrangement-layout";
import { loadI18n, t } from "./i18n";

/**
 * Every block's intended `minW`, spelled out.
 *
 * ★★★ TYPED `Record<ReportBlockId, BlockSpan>` ON PURPOSE. A new catalogue id
 * is then a COMPILE error until someone states its minimum width — which is the
 * one decision in this file that no test, and no gate, and no amount of axe can
 * check once it is wrong, because jsdom has no layout. The type does the
 * enumeration a hand-copied list kept getting wrong.
 */
const EXPECTED_MIN_W: Record<ReportBlockId, BlockSpan> = {
  stats: 2,
  groupHealth: 2,
  openByStatus: 2,
  completionOutcomes: 2,
  inquiries: 2,
  byAssignee: 4,
  byPriority: 1,
  byGroup: 4,
  byLabel: 4,
  "raid-report": 4,
  "budget-report": 4,
  "resource-report": 4,
  "stakeholder-report": 4,
};

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

  it("pins EVERY block's minW, not just the full-width ones", () => {
    // ★★★ THE LOAD-BEARING ONE. jsdom has no layout, so nothing else in the
    // suite can tell a squeezed table from a readable one. `minW` is the only
    // thing standing between a user and an unreadable report, and the VISUAL
    // result is still owed a browser eye-verify — a green run here does not mean
    // anyone has looked at it.
    //
    // ★★★ EVERY BLOCK, NOT A SUBSET, and that is a correction. This test used to
    // iterate a hardcoded list of the seven full-width ids, which left the other
    // six unguarded: narrowing `inquiries` from 2 to 1 — a block that renders its
    // own table with a column header and an `InfoTooltip` — passed all twelve
    // tests at exit 0. A `minW` nobody pins is a `minW` that moves.
    for (const b of REPORT_BLOCKS) {
      expect(b.minW, `${b.id} minW`).toBe(EXPECTED_MIN_W[b.id]);
    }
  });

  it("keeps the minW table in step with the catalogue, in both directions", () => {
    // ★★ `Record<ReportBlockId, BlockSpan>` already makes a NEW block a COMPILE
    // error — the table cannot omit a key. This catches the other direction: a
    // STALE entry for a block that has been removed, which the type cannot see.
    expect([...Object.keys(EXPECTED_MIN_W)].sort())
      .toEqual(REPORT_BLOCKS.map((b) => b.id).sort());
  });

  it("makes every addable report full width, derived rather than retyped", () => {
    // ★★★ THIS IS THE DRIFT GUARD, and its DERIVATION is the point. The source
    // builds these four rows from `ADDABLE_REPORTS` so a fifth report cannot go
    // missing; an earlier version of this test then re-typed the same four ids
    // into a literal, reintroducing exactly that failure one layer up — a fifth
    // addable would get `minW: 4` correctly and silently fall outside the test.
    for (const r of ADDABLE_REPORTS) {
      expect(reportBlockById(r.id)?.minW, `${r.id} embeds a whole report panel`).toBe(4);
    }
  });

  it("has exactly the expected full-width census — no block wrongly widened either", () => {
    // ★ The census direction the per-block loop above states but does not
    // advertise: a block wrongly WIDENED to 4 is as much a regression as one
    // wrongly narrowed, and this names the seven that are meant to be there.
    const expectedFull = REPORT_BLOCKS
      .filter((b) => EXPECTED_MIN_W[b.id] === 4)
      .map((b) => b.id);
    expect(REPORT_BLOCKS.filter((b) => b.minW === 4).map((b) => b.id)).toEqual(expectedFull);
    expect(expectedFull).toHaveLength(7);
  });

  it("keeps every span within its own bounds", () => {
    for (const b of REPORT_BLOCKS) {
      expect(b.minW, `${b.id} w`).toBeLessThanOrEqual(b.w);
      expect(b.w, `${b.id} w`).toBeLessThanOrEqual(b.maxW);
      expect(b.minH, `${b.id} h`).toBeLessThanOrEqual(b.h);
      expect(b.h, `${b.id} h`).toBeLessThanOrEqual(b.maxH);
    }
  });

  it("gives every block a label key that resolves to a real string in EN", () => {
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

describe("report-blocks — label keys in DE", () => {
  // ★★ THE DE DICTIONARY IS LAZY, so a DE assertion without this `beforeAll`
  // silently falls back to the EN value and passes for the wrong reason.
  beforeAll(async () => { await loadI18n("de"); });

  it("resolves every label key to a non-empty DE string too", () => {
    // ★★★ tsc enforces KEY PARITY, never VALUE non-emptiness — so a DE value of
    // "" typechecks, and the EN pass above cannot see it. That is the exact
    // failure this pair of tests exists for (a title-less block, and an
    // accessible name of just " – "), in the one language nothing else checked.
    for (const b of REPORT_BLOCKS) {
      expect(t("de", b.labelKey), `${b.id} labelKey (de)`).not.toBe("");
    }
  });

  it("resolves all thirteen titles to DISTINCT strings in BOTH languages", () => {
    // ★★★ THE ROUTE THE "no prop can make two titles equal" ARGUMENT DOES NOT
    // COVER. `reports.test.tsx` leaves `requireCollisionSeed` OFF because no
    // prop `ReportsPanel` accepts can make two block titles equal — every title
    // is `t(lang, spec.labelKey)` off this module-level catalogue. That is true
    // and it is NOT sufficient on its own: the KEYS are distinct by
    // construction, the rendered STRINGS are not. Two different keys resolving
    // to the same string would put two identically-named grips and two
    // identically-named ⋮ buttons on the board — a live WCAG 2.4.6 failure that
    // axe cannot see in any view at any seed size.
    //
    // ★★ BOTH LANGUAGES, and DE is the one that can drift alone: a translator
    // shortening two labels to the same word is exactly the shape that survives
    // an EN-only check. tsc enforces key parity, never value distinctness.
    //
    // ★ Same class as the shelf defect found in Task 8 — a collision nothing
    // could produce from the catalogue in front of you, until it could.
    for (const lang of ["en-US", "de"] as const) {
      const titles = REPORT_BLOCKS.map((b) => t(lang, b.labelKey));
      const seen = new Map<string, string[]>();
      REPORT_BLOCKS.forEach((b, i) => {
        seen.set(titles[i], [...(seen.get(titles[i]) ?? []), b.id]);
      });
      const clashes = [...seen.entries()].filter(([, ids]) => ids.length > 1);
      expect(clashes, `${lang}: ${clashes.map(([s, ids]) => `"${s}" ← ${ids.join(", ")}`).join(" | ")}`)
        .toEqual([]);
      // Positive control: the fixture really did resolve thirteen titles, so an
      // empty catalogue could not read as "no clashes".
      expect(titles).toHaveLength(REPORT_BLOCKS.length);
      expect(titles.every((s) => s.length > 0)).toBe(true);
    }
  });

  it("actually loaded the DE dictionary, rather than falling back to EN", () => {
    // ★ The positive control for the test above. Without it, a broken
    // `loadI18n` would make every DE assertion an EN assertion in disguise —
    // green, and covering nothing. `reportsHeadline` is the key this slice
    // added, and its two values differ.
    expect(t("de", "reportsHeadline")).toBe("Überblick");
    expect(t("de", "reportsHeadline")).not.toBe(t("en-US", "reportsHeadline"));
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
