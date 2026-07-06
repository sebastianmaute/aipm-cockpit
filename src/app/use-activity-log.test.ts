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

    it("logActivityChanges appends an entry carrying the per-field diff (#22)", () => {
      const { result } = renderLog();
      const changes = [{ field: "status", from: "Open", to: "Closed" }];
      act(() => {
        result.current.logActivityChanges("raid.updated", changes, 5, "R", "Risk");
      });
      expect(result.current.activityLog).toHaveLength(1);
      expect(result.current.activityLog[0].changes).toEqual(changes);
      expect(result.current.activityLog[0].args).toEqual([5, "R", "Risk"]);
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
