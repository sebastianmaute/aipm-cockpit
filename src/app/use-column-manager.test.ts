// src/app/use-column-manager.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useColumnManager } from "./use-column-manager";

// Width state is delegated to the shared useColumnResize (tableId
// "open-points-v2"), which owns the suffixed storage key + the debounced-persist
// behaviour (covered by use-column-resize.test.ts). These tests cover what
// useColumnManager adds.
const COL_WIDTHS_KEY = "aipm-cockpit:col-widths:open-points-v2";
const HIDDEN_COLS_KEY = "aipm-cockpit:hidden-cols";

describe("useColumnManager", () => {
  describe("initial state", () => {
    it("sizedWidths is empty initially — every column is at its default", () => {
      const { result } = renderHook(() => useColumnManager());
      expect(result.current.sizedWidths).toEqual({});
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
    it("loads stored widths from localStorage on mount", async () => {
      localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify({ taskName: 300 }));
      const { result } = renderHook(() => useColumnManager());
      await act(async () => {});
      expect(result.current.sizedWidths.taskName).toBe(300);
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
      expect(result.current.sizedWidths.status).toBeUndefined();
      expect(result.current.sizedWidths.actions).toBeUndefined();
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
    it("clears every user-set width and removes the localStorage key", async () => {
      localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify({ taskName: 300 }));
      const { result } = renderHook(() => useColumnManager());
      await act(async () => {});
      act(() => {
        result.current.resetColWidths();
      });
      // Empty, NOT defaults-filled: reset must restore the flex column, and a
      // taskName entry of any value — including its own default — pins a width.
      expect(result.current.sizedWidths).toEqual({});
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

  // ★★ The pane binds to `sizedWidths`, and an ABSENT key is what lets `taskName`
  //    render with no declared width and so absorb the table's leftover. Hand the
  //    pane the defaults-filled map instead and every column declares a width, the
  //    flex column silently never engages, and the leftover goes back to padding
  //    the narrow columns. Invisible in jsdom and to axe.
  // ★★★ THAT REVERT IS NOT A TYPE ERROR — `Record<string, number>` is assignable
  //     to `Partial<Record<string, number>>`, so `sizedWidths={colWidths}` compiles
  //     clean and no test catches it. The guard is that this hook does NOT RETURN
  //     the merged map at all, so there is no `colWidths` in `task-manager.tsx`'s
  //     scope to pass. The test below is what pins that: it fails to compile if the
  //     key comes back. `useColumnResize` still computes it for the 37 other tables.
  describe("sizedWidths", () => {
    it("is empty on a fresh install", () => {
      const { result } = renderHook(() => useColumnManager());
      expect(result.current.sizedWidths).toEqual({});
    });

    it("carries only the dragged column", () => {
      localStorage.setItem(
        "aipm-cockpit:col-widths:open-points-v2",
        JSON.stringify({ v: 2, widths: { taskName: 333 } }),
      );
      const { result } = renderHook(() => useColumnManager());

      expect(result.current.sizedWidths).toEqual({ taskName: 333 });
      expect(result.current.sizedWidths.status).toBeUndefined();
    });

    it("does not expose the defaults-filled map, so it cannot be wired to the pane", () => {
      const { result } = renderHook(() => useColumnManager());
      // A ts-expect-error IS the assertion: if `colWidths` is ever added back to
      // the return type this line stops erroring and `npx tsc --noEmit` FAILS on
      // the unused directive. Runtime absence alone would not catch it, since the
      // damage is done by a caller that CAN name the key.
      // @ts-expect-error — colWidths is deliberately not part of this hook's API.
      expect(result.current.colWidths).toBeUndefined();
    });
  });
});
