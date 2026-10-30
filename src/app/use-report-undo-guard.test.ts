import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useReportUndoGuard } from "./use-report-undo-guard";
import type { UndoMeta } from "./undo/undo-stack";
import type { AppDialogs } from "./confirm-dialog";

function meta(id: number, kind: UndoMeta["kind"]): UndoMeta {
  return { id, kind, count: 1, timestamp: "2026-10-30T09:00:00.000Z", label: `entry ${id}` };
}

function setup(stack: UndoMeta[], answer: boolean, redoStack: UndoMeta[] = []) {
  const api = { undo: vi.fn(), undoThrough: vi.fn(), redo: vi.fn(), redoThrough: vi.fn(), stack, redoStack };
  const confirm = vi.fn(async () => answer);
  const dialogsRef: { current: AppDialogs } = {
    current: { confirm, prompt: vi.fn(async () => null), notice: vi.fn(async () => {}) },
  };
  const { result } = renderHook(() => useReportUndoGuard({ api, dialogsRef, lang: "en-US" }));
  return { api, confirm, guarded: result.current };
}

function openDirtyReport(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-report-dirty", "true");
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useReportUndoGuard (AI-04)", () => {
  it("asks before undoing a report change while an open report has unsaved changes; yes undoes", async () => {
    openDirtyReport();
    const { api, confirm, guarded } = setup([meta(1, "task.updated"), meta(2, "meetingReport.updated")], true);
    guarded.undo();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(api.undo).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(api.undo).toHaveBeenCalledTimes(1));
  });

  it("no keeps the stack as it is", async () => {
    openDirtyReport();
    const { api, confirm, guarded } = setup([meta(2, "meetingReport.updated")], false);
    guarded.undo();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(api.undo).not.toHaveBeenCalled();
  });

  it("undoes at once when the open report has no unsaved changes", () => {
    const { api, confirm, guarded } = setup([meta(2, "meetingReport.updated")], false);
    guarded.undo();
    expect(api.undo).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("undoes at once when the top entry is not a report change", () => {
    openDirtyReport();
    const { api, confirm, guarded } = setup([meta(1, "meetingReport.updated"), meta(2, "task.updated")], false);
    guarded.undo();
    expect(api.undo).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("undo-through asks when any entry it would undo is a report change", async () => {
    openDirtyReport();
    const { api, confirm, guarded } = setup([meta(1, "meetingReport.updated"), meta(2, "task.updated")], true);
    guarded.undoThrough(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(api.undoThrough).toHaveBeenCalledWith(1));
  });

  it("redo of a report change asks too", async () => {
    openDirtyReport();
    const { api, confirm, guarded } = setup([], true, [meta(3, "meetingReport.updated")]);
    guarded.redo();
    expect(confirm).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(api.redo).toHaveBeenCalledTimes(1));
  });
});
