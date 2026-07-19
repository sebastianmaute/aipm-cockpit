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

    it("hiddenCols contains only the default-hidden effort columns initially", () => {
      const { result } = renderHook(() => useColumnManager());
      expect(result.current.hiddenCols).toEqual(new Set(["estimate", "spent"]));
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
});
