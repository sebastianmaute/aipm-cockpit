// src/app/use-activity-log.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import { useActivityLog } from "./use-activity-log";

function renderLog(lang: Lang = "en-US" as Lang) {
  return renderHook(() => useActivityLog({ lang }));
}

describe("useActivityLog", () => {
  describe("initial state", () => {
    it("activityLog is empty initially", () => {
      const { result } = renderLog();
      expect(result.current.activityLog).toHaveLength(0);
    });
  });

  describe("logActivity", () => {
    it("logActivity appends an entry", () => {
      const { result } = renderLog();
      act(() => {
        result.current.logActivity("task.created", 1, "Test task");
      });
      expect(result.current.activityLog).toHaveLength(1);
    });

    it("calling logActivity twice appends two entries", () => {
      const { result } = renderLog();
      act(() => {
        result.current.logActivity("task.created", 1, "Task A");
      });
      act(() => {
        result.current.logActivity("task.updated", 1, "Task A");
      });
      expect(result.current.activityLog).toHaveLength(2);
    });
  });

  describe("handleClearActivityLog", () => {
    it("does nothing when log is empty (no window.confirm call)", () => {
      const { result } = renderLog();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      act(() => {
        result.current.handleClearActivityLog();
      });
      expect(confirmSpy).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it("clears log when window.confirm returns true", () => {
      const { result } = renderLog();
      act(() => {
        result.current.logActivity("task.created", 1, "Task A");
      });
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      act(() => {
        result.current.handleClearActivityLog();
      });
      expect(result.current.activityLog).toHaveLength(0);
      confirmSpy.mockRestore();
    });

    it("does NOT clear when window.confirm returns false", () => {
      const { result } = renderLog();
      act(() => {
        result.current.logActivity("task.created", 1, "Task A");
      });
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      act(() => {
        result.current.handleClearActivityLog();
      });
      expect(result.current.activityLog).toHaveLength(1);
      confirmSpy.mockRestore();
    });
  });
});
