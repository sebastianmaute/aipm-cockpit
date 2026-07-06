// src/app/use-activity-log.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useActivityLog } from "./use-activity-log";

// handleClearActivityLog no longer confirms here — the branded confirm lives in
// the panel (which renders under ConfirmProvider; this hook runs above it). The
// hook just performs the wipe. See activity-log-panel.test.tsx for the confirm
// flow.
function renderLog() {
  return renderHook(() => useActivityLog());
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
    it("clears logged entries", () => {
      const { result } = renderLog();
      act(() => {
        result.current.logActivity("task.created", 1, "Task A");
      });
      act(() => {
        result.current.handleClearActivityLog();
      });
      expect(result.current.activityLog).toHaveLength(0);
    });

    it("is a no-op on an already-empty log", () => {
      const { result } = renderLog();
      act(() => {
        result.current.handleClearActivityLog();
      });
      expect(result.current.activityLog).toHaveLength(0);
    });
  });
});
