import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { buildMoveAbsenceHandler } from "./absence-move-handler";
import { useUndoStack } from "./undo/use-undo-stack";
import type { Absence } from "./types";

const anna: Absence = {
  id: 7,
  assignee: "Anna",
  assigneeEmail: "",
  startDate: "2026-07-27",
  endDate: "2026-07-27",
  type: "vacation",
};

// Mirrors task-manager.tsx: buildMoveAbsenceHandler is reconstructed on every
// render from the LIVE absences state + a save function shaped exactly like
// use-resource-planner.ts's real handleSaveAbsence (map-replace by id) — a
// mini-integration harness, not a mock of the whole app.
function harness(initial: readonly Absence[]) {
  return renderHook(() => {
    const [absences, setAbsences] = useState<readonly Absence[]>(initial);
    const undo = useUndoStack({
      lang: "en-US",
      logActivity: vi.fn(),
      showToast: vi.fn(),
      showToastAction: vi.fn(),
    });
    const handleSaveAbsence = vi.fn((next: Absence) => {
      setAbsences((prev) => prev.map((a) => (a.id === next.id ? next : a)));
    });
    const handleMoveAbsence = buildMoveAbsenceHandler(absences, setAbsences, undo.captureFieldEdit, handleSaveAbsence);
    return { absences, undo, handleSaveAbsence, handleMoveAbsence };
  });
}

describe("buildMoveAbsenceHandler", () => {
  it("reaches handleSaveAbsence — the same write path a modal edit uses — with the merged absence", () => {
    const { result } = harness([anna]);
    // Capture the spy BEFORE calling the handler: handleSaveAbsence is
    // reconstructed fresh every render (like the real task-manager.tsx
    // closure), so `result.current.handleSaveAbsence` AFTER the act() below
    // is a different instance than the one the handler actually invoked.
    const savedSpy = result.current.handleSaveAbsence;
    act(() => result.current.handleMoveAbsence(7, { startDate: "2026-07-29", endDate: "2026-07-30" }));
    expect(savedSpy).toHaveBeenCalledTimes(1);
    expect(savedSpy).toHaveBeenCalledWith({
      ...anna,
      startDate: "2026-07-29",
      endDate: "2026-07-30",
    });
    expect(result.current.absences[0]).toMatchObject({ startDate: "2026-07-29", endDate: "2026-07-30" });
  });

  it("is a no-op — no save, no undo entry — when the id no longer exists (e.g. deleted mid-drag)", () => {
    const { result } = harness([anna]);
    const savedSpy = result.current.handleSaveAbsence;
    act(() => result.current.handleMoveAbsence(999, { startDate: "2026-07-29", endDate: "2026-07-29" }));
    expect(savedSpy).not.toHaveBeenCalled();
    expect(result.current.undo.stack).toHaveLength(0);
  });

  it("produces exactly ONE undo entry for a reassign, and undoing it reverts every patched field together", () => {
    const { result, rerender } = harness([anna]);
    act(() =>
      result.current.handleMoveAbsence(7, {
        startDate: "2026-07-29",
        endDate: "2026-07-29",
        assignee: "Bob",
        assigneeEmail: "bob@x.io",
        resourceId: 5,
      }),
    );
    rerender();

    // One gesture, one entry — not one per changed field/group.
    expect(result.current.undo.stack).toHaveLength(1);
    expect(result.current.absences[0]).toMatchObject({
      startDate: "2026-07-29",
      endDate: "2026-07-29",
      assignee: "Bob",
      assigneeEmail: "bob@x.io",
      resourceId: 5,
    });

    act(() => result.current.undo.undo());
    rerender();

    // ALL five patched fields revert together in a single undo click — a
    // half-reverted record (e.g. new dates but the old assignee) would mean
    // the capture missed a field.
    expect(result.current.absences[0]).toMatchObject({
      startDate: "2026-07-27",
      endDate: "2026-07-27",
      assignee: "Anna",
      assigneeEmail: "",
      resourceId: undefined,
    });
  });

  it("captures a move's two date fields as a single entry, distinct from a modal edit's per-group entries", () => {
    const { result, rerender } = harness([anna]);
    act(() => result.current.handleMoveAbsence(7, { startDate: "2026-07-29", endDate: "2026-07-30" }));
    rerender();
    expect(result.current.undo.stack).toHaveLength(1);
    act(() => result.current.undo.undo());
    rerender();
    expect(result.current.absences[0]).toMatchObject({ startDate: "2026-07-27", endDate: "2026-07-27" });
  });
});
