import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useReportsArrangement } from "./use-reports-arrangement";
import { REPORTS_DEFAULT_LAYOUT, REPORTS_LAYOUT_KEY } from "./report-blocks";
import { ADDABLE_REPORTS, type AddableReportId } from "./addable-reports";
import { LAYOUT_PERSIST_MS } from "./use-arrangement";

const ALL_ADDABLE = ADDABLE_REPORTS.map((r) => r.id);

function mount(opts: {
  projectId?: string;
  extraReports?: readonly AddableReportId[];
  isPopout?: boolean;
} = {}) {
  return renderHook(() =>
    useReportsArrangement({
      projectId: opts.projectId ?? "p1",
      extraReports: opts.extraReports ?? [],
      isPopout: opts.isPopout,
    }),
  );
}

/** Persist and flush, so the next mount reads what the last one wrote. */
function settle() {
  act(() => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS + 100); });
}

/** ★ The legacy key a "one-time migration" would be tempted to clean up. Its
 *  exact name does not matter — what matters is that SOMETHING unrelated is in
 *  storage across the migrating mount, and comes out identical. */
const DECOY_KEY = "aipm-cockpit:settings";
const DECOY_VALUE = JSON.stringify({ reports: { extra: ["raid-report"] } });

/** Every localStorage entry, as a plain object. */
function snapshotStorage(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i)!;
    out[k] = localStorage.getItem(k);
  }
  return out;
}

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("useReportsArrangement — the one-time migration", () => {
  it("seeds hidden from settings.reports.extra on first load", () => {
    const { result } = mount({ extraReports: ["raid-report"] });
    expect(result.current.layout.hidden).toEqual(
      expect.arrayContaining(["budget-report", "resource-report", "stakeholder-report"]),
    );
    expect(result.current.layout.board.map((b) => b.id)).toContain("raid-report");
  });

  it("hides EVERY addable report absent from the setting, and no builtin", () => {
    // ★★ The census, not a sample. A migration that hid a builtin block would
    // pass the `arrayContaining` assertion above — that matcher is a subset
    // check and says nothing about what else is in the list.
    const { result } = mount({ extraReports: ["budget-report"] });
    expect([...result.current.layout.hidden].sort())
      .toEqual(ALL_ADDABLE.filter((id) => id !== "budget-report").sort());
  });

  it("hides every addable report when the setting is empty", () => {
    const { result } = mount({ extraReports: [] });
    expect([...result.current.layout.hidden].sort()).toEqual([...ALL_ADDABLE].sort());
  });

  it("hides nothing when the setting names them all", () => {
    // ★ The positive control for the three above: with everything kept, the
    // migration must produce an EMPTY hidden list, or it is hiding on some
    // basis other than the setting.
    const { result } = mount({ extraReports: ALL_ADDABLE });
    expect(result.current.layout.hidden).toEqual([]);
    expect(result.current.layout.board.map((b) => b.id))
      .toEqual(REPORTS_DEFAULT_LAYOUT.board.map((b) => b.id));
  });

  it("ignores settings.reports.extra once a layout is stored", () => {
    // ★★★ THE WHOLE POINT OF THE MARKER. If this fails, the migration runs on
    // every load and a user's arrangement is silently reverted on each visit.
    const first = mount({ extraReports: ["raid-report"] });
    act(() => { first.result.current.hide("byPriority"); });
    settle();
    first.unmount();

    const second = mount({ extraReports: [] });
    expect(second.result.current.layout.board.map((b) => b.id)).toContain("raid-report");
    expect(second.result.current.layout.hidden).toContain("byPriority");
    // ★★ `raid-report` IS THE DISCRIMINATING OBSERVABLE, and the obvious
    // assertion is the wrong one. The other three are hidden in BOTH worlds —
    // the first migration hid them and that was persisted — so asserting they
    // are absent fails against CORRECT code, which is exactly what it did when
    // this test was first written. Only `raid-report` differs: the stored
    // layout keeps it on the board, while a re-run seed with an emptied setting
    // would hide all four.
    expect(second.result.current.layout.hidden).not.toContain("raid-report");
  });

  it("writes nothing under its own key on the migrating load itself", () => {
    // ★★ The `dirty` guard: a mount that only MIGRATES persists nothing, so the
    // marker is written by the user's first real change rather than by the
    // migration. ★ This checks ONE key — see the whole-storage test below for
    // the seed's own side effects.
    mount({ extraReports: ["raid-report"] });
    settle();
    expect(localStorage.getItem(REPORTS_LAYOUT_KEY)).toBeNull();
  });

  it("leaves the REST of localStorage untouched, legacy settings included", () => {
    // ★★★ THE SEED RUNS DURING RENDER AND MUST BE PURE, and this is the
    // observable for the specific risk its docstring names: a "one-time
    // migration" that DELETES or REWRITES the legacy settings key as it goes.
    // The single-key assertion above cannot see that — it only ever looks at
    // REPORTS_LAYOUT_KEY.
    //
    // ★★ WHAT THIS DOES AND DOES NOT PROVE. It proves no localStorage entry was
    // added, removed or changed across the migrating mount. It is NOT a purity
    // proof: a seed could still call an API, mutate a module or write to
    // IndexedDB and pass. Purity beyond storage rests on review.
    localStorage.setItem(DECOY_KEY, DECOY_VALUE);
    localStorage.setItem("aipm-cockpit:unrelated", "keep me");
    const before = snapshotStorage();

    mount({ extraReports: ["raid-report"] });
    settle();

    expect(localStorage.length).toBe(2);
    expect(localStorage.getItem(DECOY_KEY)).toBe(DECOY_VALUE);
    expect(snapshotStorage()).toEqual(before);
  });
});

describe("useReportsArrangement — what the marker cannot cover", () => {
  it("RE-RUNS the seed when the stored blob is REJECTED, reverting a later arrangement", () => {
    // ★★★ THE HONEST LIMITATION, pinned rather than described. The marker is
    // "storage holds something usable", and `loadArrangement` cannot tell a
    // MISSING key from a REJECTED one — so a blob written by a future `v: 2`
    // build, or a hand-corrupted one, re-runs the migration.
    //
    // ★★ THE REPORTS CASE IS WORSE THAN THE DASHBOARD'S ACCEPTED TRADE, and
    // that is why this is pinned and reported rather than waved through. The
    // Dashboard reverts to a DEFAULT; Reports reverts to a STALE SETTING —
    // `settings.reports.extra` is frozen at its pre-migration value because
    // nothing writes it any more, so a user who has since RESTORED reports from
    // the shelf loses exactly those restorations.
    localStorage.setItem(
      REPORTS_LAYOUT_KEY,
      JSON.stringify({ p1: { v: 9, board: [], hidden: [] } }),
    );
    // Non-vacuity: the entry IS present, so this cannot pass for the ordinary
    // missing-key reason.
    expect(JSON.parse(localStorage.getItem(REPORTS_LAYOUT_KEY)!).p1.v).toBe(9);

    const { result } = mount({ extraReports: ["raid-report"] });
    expect([...result.current.layout.hidden].sort())
      .toEqual(ALL_ADDABLE.filter((id) => id !== "raid-report").sort());
  });
});

describe("useReportsArrangement — reconciling the seed", () => {
  it("puts a NEW catalogue block on the board even though the setting predates it", () => {
    // ★★ The seed names only addable reports, so every builtin is absent from
    // its `hidden` list and `reconcile` step 2 re-inserts all of them. That is
    // what makes a stale setting safe: it can only ever hide the four ids it
    // knows about.
    const { result } = mount({ extraReports: [] });
    const board = result.current.layout.board.map((b) => b.id);
    for (const id of ["stats", "groupHealth", "byPriority", "byLabel"]) {
      expect(board, `${id} must survive the migration`).toContain(id);
    }
  });

  it("keeps the board and the hidden list disjoint", () => {
    const { result } = mount({ extraReports: ["raid-report"] });
    const board = new Set(result.current.layout.board.map((b) => b.id));
    for (const id of result.current.layout.hidden) {
      expect(board.has(id), `${id} is on the board AND hidden`).toBe(false);
    }
  });
});

describe("useReportsArrangement — the binding", () => {
  it("never persists from a popout, and reports readOnly", () => {
    const { result } = mount({ isPopout: true });
    act(() => { result.current.hide("byPriority"); });
    settle();
    expect(localStorage.getItem(REPORTS_LAYOUT_KEY)).toBeNull();
    expect(result.current.readOnly).toBe(true);
  });

  it("persists a real change under the Reports key, never the Dashboard's", () => {
    const { result } = mount({ extraReports: ALL_ADDABLE });
    act(() => { result.current.hide("byPriority"); });
    settle();
    const map = JSON.parse(localStorage.getItem(REPORTS_LAYOUT_KEY)!);
    expect(map.p1.hidden).toContain("byPriority");
    expect(localStorage.getItem("aipm-cockpit:dashboard-layout")).toBeNull();
  });

  it("reset returns the surface's OWN fallback BY REFERENCE", () => {
    // ★★★ `REPORTS_DEFAULT_LAYOUT` is imported, never re-derived here — one
    // instance per surface, because `reconcile(null)` and `reset()` both hand it
    // back by reference and `use-arrangement.ts` warns in dev if that identity
    // moves between renders.
    const { result } = mount({ extraReports: ALL_ADDABLE });
    act(() => { result.current.hide("byPriority"); });
    expect(result.current.layout).not.toBe(REPORTS_DEFAULT_LAYOUT);
    act(() => { result.current.reset(); });
    expect(result.current.layout).toBe(REPORTS_DEFAULT_LAYOUT);
  });

  it("keeps each project's arrangement separate", () => {
    const first = mount({ projectId: "pA", extraReports: ALL_ADDABLE });
    act(() => { first.result.current.hide("byPriority"); });
    settle();
    first.unmount();

    const second = mount({ projectId: "pB", extraReports: ["raid-report"] });
    // pB has nothing stored, so it MIGRATES rather than inheriting pA's board.
    expect(second.result.current.layout.hidden).toContain("budget-report");
    expect(second.result.current.layout.hidden).not.toContain("byPriority");
  });
});
