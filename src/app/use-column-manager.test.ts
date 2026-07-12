// src/app/use-column-manager.test.ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COL_WIDTHS, useColumnManager } from "./use-column-manager";

const COL_WIDTHS_KEY = "aipm-cockpit:col-widths";
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

  describe("persistence", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("persists colWidths to localStorage after 250 ms debounce", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useColumnManager());
      await act(async () => { vi.runAllTimers(); });
      localStorage.removeItem(COL_WIDTHS_KEY);

      act(() => {
        result.current.setColWidths((prev) => ({ ...prev, taskName: 999 }));
      });
      expect(localStorage.getItem(COL_WIDTHS_KEY)).toBeNull();

      act(() => { vi.advanceTimersByTime(250); });
      const stored = JSON.parse(
        localStorage.getItem(COL_WIDTHS_KEY) ?? "{}",
      ) as Record<string, number>;
      expect(stored.taskName).toBe(999);
    });
  });
});
