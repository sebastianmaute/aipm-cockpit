// src/app/use-activity-log.test.tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { useActivityLog } from "./use-activity-log";
import { aiOrigin } from "./activity-origin";

// handleClearActivityLog no longer confirms here — the branded confirm lives in
// the panel (which renders under ConfirmProvider; this hook runs above it). The
// hook just performs the wipe. See activity-log-panel.test.tsx for the confirm
// flow.
// ★ The hook owns no state now — the log is a WorkspaceProvider slice, so every
// render needs the provider (FiltersProvider is WorkspaceProvider's own
// dependency, mirroring workspace-context.test.tsx's wrapper).
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

function renderLog() {
  return renderHook(() => useActivityLog(), { wrapper });
}

describe("useActivityLog", () => {
  describe("initial state", () => {
    it("activityLog is empty initially", () => {
      const { result } = renderLog();
      expect(result.current.activityLog).toHaveLength(0);
    });
  });

  describe("the human logger cannot write an AI entry (§799)", () => {
    it("logActivityAs and logActivityChangesAs reject the \"ai\" actor at compile time", () => {
      const { result } = renderLog();
      act(() => {
        // @ts-expect-error "ai" is not a HumanActor; only logActivityAi may write an AI entry
        result.current.logActivityAs("ai", "task.updated");
        // @ts-expect-error "ai" is not a HumanActor; only logActivityAi may write an AI entry
        result.current.logActivityChangesAs("ai", "task.updated", []);
      });
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

    it("appending an activity entry produces a NEW array (reference-equality dirty check)", () => {
      // ★ NOT a red-first test — the hook was already functional-setter based,
      // so this passed before the lift too. It is a REGRESSION GUARD: the save
      // effect's dirty check is reference equality on the workspace slice, so an
      // in-place push would keep the identity and silently skip every save.
      const { result } = renderLog();
      const before = result.current.activityLog;
      act(() => {
        result.current.logActivity("task.created", "T-1");
      });
      expect(result.current.activityLog).not.toBe(before);
      expect(result.current.activityLog).toHaveLength(before.length + 1);
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

  describe("actor-aware variants", () => {
    it("logActivityAs stamps the actor, and the plain variant omits the key", () => {
      const { result } = renderLog();
      act(() => {
        result.current.logActivityAs("integration", "task.created", 1, "Task A");
      });
      act(() => {
        result.current.logActivity("task.created", 2, "Task B");
      });
      expect(result.current.activityLog[0].actor).toBe("integration");
      // ★ `in` rather than toBeUndefined(): the key must be OMITTED so the ~150
      // untouched call sites keep writing byte-identical entries.
      expect("actor" in result.current.activityLog[1]).toBe(false);
    });

    it("logActivityChangesAs appends an entry carrying BOTH the diff and the actor", () => {
      const { result } = renderLog();
      const changes = [{ field: "status", from: "Open", to: "Closed" }];
      act(() => {
        result.current.logActivityChangesAs("integration", "raid.updated", changes, 5, "R", "Risk");
      });
      expect(result.current.activityLog).toHaveLength(1);
      expect(result.current.activityLog[0].changes).toEqual(changes);
      expect(result.current.activityLog[0].actor).toBe("integration");
      expect(result.current.activityLog[0].args).toEqual([5, "R", "Risk"]);
    });

    it("logActivityAs produces a NEW array (reference-equality dirty check)", () => {
      const { result } = renderLog();
      const before = result.current.activityLog;
      act(() => {
        result.current.logActivityAs("integration", "task.created", "T-1");
      });
      expect(result.current.activityLog).not.toBe(before);
      expect(result.current.activityLog).toHaveLength(before.length + 1);
    });
  });

  describe("logActivityAi", () => {
    it("stamps actor ai and the origin the caller names", () => {
      const { result } = renderLog();
      act(() => {
        result.current.logActivityAi(aiOrigin("wbsPlan"), "ai.wbsPlan", "x");
      });
      expect(result.current.activityLog[0].actor).toBe("ai");
      expect(result.current.activityLog[0].origin).toEqual({ feature: "wbsPlan" });
      expect(result.current.activityLog[0].args).toEqual(["x"]);
    });

    it("two calls in one act both survive, each with its own origin", () => {
      const { result } = renderLog();
      act(() => {
        result.current.logActivityAi(aiOrigin("wbsPlan"), "ai.wbsPlan", "a");
        result.current.logActivityAi(aiOrigin("taskDedup"), "ai.taskDedup", 2);
      });
      expect(result.current.activityLog.map((e) => e.origin?.feature)).toEqual(["wbsPlan", "taskDedup"]);
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
