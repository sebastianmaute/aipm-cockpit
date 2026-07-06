// src/app/use-activity-log.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import { useActivityLog } from "./use-activity-log";
import { useConfirm } from "./confirm-dialog";

vi.mock("./confirm-dialog", () => ({ useConfirm: vi.fn(() => () => Promise.resolve(true)) }));

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
    it("does nothing when log is empty (confirm not called)", async () => {
      const confirmFn = vi.fn(() => Promise.resolve(true));
      vi.mocked(useConfirm).mockReturnValue(confirmFn);
      const { result } = renderLog();
      await act(async () => {
        await result.current.handleClearActivityLog();
      });
      expect(confirmFn).not.toHaveBeenCalled();
    });

    it("clears log when confirm resolves true", async () => {
      vi.mocked(useConfirm).mockReturnValue(() => Promise.resolve(true));
      const { result } = renderLog();
      act(() => {
        result.current.logActivity("task.created", 1, "Task A");
      });
      await act(async () => {
        await result.current.handleClearActivityLog();
      });
      expect(result.current.activityLog).toHaveLength(0);
    });

    it("does NOT clear when confirm resolves false", async () => {
      vi.mocked(useConfirm).mockReturnValue(() => Promise.resolve(false));
      const { result } = renderLog();
      act(() => {
        result.current.logActivity("task.created", 1, "Task A");
      });
      await act(async () => {
        await result.current.handleClearActivityLog();
      });
      expect(result.current.activityLog).toHaveLength(1);
    });
  });
});
