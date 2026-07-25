// src/app/use-column-manager.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_COL_WIDTHS, useColumnManager } from "./use-column-manager";

// Width state is delegated to the shared useColumnResize (tableId "open-points"),
// which owns the suffixed storage key + the debounced-persist behaviour (covered
// by use-column-resize.test.ts). These tests cover what useColumnManager adds.
const COL_WIDTHS_KEY = "aipm-cockpit:col-widths:open-points";
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
});
