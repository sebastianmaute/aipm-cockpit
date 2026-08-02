// src/app/use-column-manager.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_COL_WIDTHS, useColumnManager } from "./use-column-manager";

// Width state is delegated to the shared useColumnResize (tableId
// "open-points-v2"), which owns the suffixed storage key + the debounced-persist
// behaviour (covered by use-column-resize.test.ts). These tests cover what
// useColumnManager adds.
const COL_WIDTHS_KEY = "aipm-cockpit:col-widths:open-points-v2";
const HIDDEN_COLS_KEY = "aipm-cockpit:hidden-cols";

describe("useColumnManager", () => {
  describe("initial state", () => {
    it("colWidths equals DEFAULT_COL_WIDTHS initially", () => {
      const { result } = renderHook(() => useColumnManager());
      expect(result.current.colWidths).toEqual(DEFAULT_COL_WIDTHS);
    });

    it("hiddenCols contains the default-hidden columns initially", () => {
      const { result } = renderHook(() => useColumnManager());
      expect(result.current.hiddenCols).toEqual(new Set(["estimate", "spent", "createdDate"]));
    });

    it("colConfigOpen is false initially", () => {
      const { result } = renderHook(() => useColumnManager());
      expect(result.current.colConfigOpen).toBe(false);
    });
  });

  describe("localStorage hydration", () => {
    it("loads colWidths from localStorage on mount", async () => {
      localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify({ taskName: 300 }));
      const { result } = renderHook(() => useColumnManager());
      await act(async () => {});
      expect(result.current.colWidths.taskName).toBe(300);
    });

    it("reads widths from the v2 table key, ignoring a stale open-points blob", () => {
      // The pre-bump blob held all 18 keys, so it masked every default. Bumping
      // the tableId is what lets the new declared widths actually reach a user
      // who once dragged one unrelated column.
      localStorage.setItem(
        "aipm-cockpit:col-widths:open-points",
        JSON.stringify({ status: 999, actions: 999 }),
      );
      const { result } = renderHook(() => useColumnManager());
      expect(result.current.colWidths.status).toBe(DEFAULT_COL_WIDTHS.status);
      expect(result.current.colWidths.actions).toBe(DEFAULT_COL_WIDTHS.actions);
    });

    it("loads hiddenCols from localStorage on mount", async () => {
      localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify(["notes", "blockers"]));
      const { result } = renderHook(() => useColumnManager());
      await act(async () => {});
      expect(result.current.hiddenCols.has("notes")).toBe(true);
      expect(result.current.hiddenCols.has("blockers")).toBe(true);
    });
  });

  describe("resetColWidths", () => {
    it("resets to DEFAULT_COL_WIDTHS and removes the localStorage key", async () => {
      localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify({ taskName: 300 }));
      const { result } = renderHook(() => useColumnManager());
      await act(async () => {});
      act(() => {
        result.current.resetColWidths();
      });
      expect(result.current.colWidths).toEqual(DEFAULT_COL_WIDTHS);
      expect(localStorage.getItem(COL_WIDTHS_KEY)).toBeNull();
    });
  });

  // hiddenCols persists per device and its ["estimate","spent"] seed only applied
  // on a fresh install — so a NEW default-hidden column (createdDate) must be
  // migrated into an existing user's stored set exactly once, without disturbing
  // a column they have since deliberately unhidden.
  describe("hidden-cols storage migration", () => {
    it("a legacy bare array keeps its hides and gains createdDate", () => {
      localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify(["blockers"]));
      const { result } = renderHook(() => useColumnManager());
      expect([...result.current.hiddenCols].sort()).toEqual(["blockers", "createdDate"]);
    });

    it("a v2 payload is honoured verbatim — createdDate is not re-added once unhidden", () => {
      localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify({ v: 2, hidden: ["estimate"] }));
      const { result } = renderHook(() => useColumnManager());
      expect([...result.current.hiddenCols]).toEqual(["estimate"]);
    });

    it("a corrupt payload falls back to the fresh-install seed", () => {
      localStorage.setItem(HIDDEN_COLS_KEY, "{not json");
      const { result } = renderHook(() => useColumnManager());
      expect([...result.current.hiddenCols].sort()).toEqual(["createdDate", "estimate", "spent"]);
    });

    it("persists the v2 shape after a state update — a regression to writing a bare array would be misread as v1 on the next load", () => {
      const { result } = renderHook(() => useColumnManager());
      act(() => {
        result.current.setHiddenCols((prev) => {
          const next = new Set(prev);
          next.delete("createdDate");
          return next;
        });
      });
      expect(JSON.parse(window.localStorage.getItem(HIDDEN_COLS_KEY)!)).toEqual({
        v: 2,
        hidden: ["estimate", "spent"],
      });
    });
  });

  // ★★ The pane binds to `sizedWidths`, NOT `colWidths` — an absent key is what
  //    lets `taskName` render with no declared width and so absorb the table's
  //    leftover. If this hook stopped re-exporting it, or re-exported the merged
  //    map under that name, every column would declare a width, the flex column
  //    would silently never engage, and the leftover would go back to being split
  //    evenly across all of them. That is invisible in jsdom and to axe.
  // ★★ KNOWN GAP, deliberately not closed here: these tests pin the HOOK's half
  //    of the contract. The other half — `task-manager.tsx` passing `sizedWidths`
  //    as the pane's `colWidths` prop — has NO test. `tasks-section.test.tsx`
  //    supplies that prop directly, and the characterization suite mounts
  //    TaskManager on the dashboard, so TasksSection never renders there (probed:
  //    a mock of it captures nothing). Reverting that one line would kill the flex
  //    column with every gate still green. Covering it needs a TaskManager mount
  //    navigated to Open Points — worth doing if that pane grows more wiring.
  describe("sizedWidths", () => {
    it("is empty on a fresh install, where colWidths is fully populated", () => {
      const { result } = renderHook(() => useColumnManager());
      expect(result.current.sizedWidths).toEqual({});
      expect(Object.keys(result.current.colWidths).length).toBeGreaterThan(10);
    });

    it("carries only the dragged column, while colWidths still fills the rest", () => {
      localStorage.setItem(
        "aipm-cockpit:col-widths:open-points-v2",
        JSON.stringify({ v: 2, widths: { taskName: 333 } }),
      );
      const { result } = renderHook(() => useColumnManager());

      expect(result.current.sizedWidths).toEqual({ taskName: 333 });
      expect(result.current.colWidths.taskName).toBe(333);
      expect(result.current.colWidths.status).toBe(DEFAULT_COL_WIDTHS.status);
    });
  });
});
