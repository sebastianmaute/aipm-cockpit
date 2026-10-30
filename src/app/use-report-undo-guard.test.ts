import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useReportUndoGuard } from "./use-report-undo-guard";
import type { UndoMeta } from "./undo/undo-stack";
import type { AppDialogs } from "./confirm-dialog";
import { confirmReportUndo } from "./use-report-undo-guard";

function meta(id: number, kind: UndoMeta["kind"]): UndoMeta {
  return { id, kind, count: 1, timestamp: "2026-10-30T09:00:00.000Z", label: `entry ${id}` };
}

function setup(stack: UndoMeta[], answer: boolean, redoStack: UndoMeta[] = []) {
  const api = { undo: vi.fn(), undoById: vi.fn(), undoThrough: vi.fn(), redo: vi.fn(), redoThrough: vi.fn(), stack, redoStack };
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
    await vi.waitFor(() => expect(api.undoById).toHaveBeenCalledWith(2));
    expect(api.undo).not.toHaveBeenCalled();
  });

  it("undoes the entry that was ASKED about, not one captured while the dialog was open", async () => {
    openDirtyReport();
    const stack = [meta(2, "meetingReport.updated")];
    const api = { undo: vi.fn(), undoById: vi.fn(), undoThrough: vi.fn(), redo: vi.fn(), redoThrough: vi.fn(), stack, redoStack: [] as UndoMeta[] };
    let answer: (ok: boolean) => void = () => {};
    const confirm = vi.fn(() => new Promise<boolean>((r) => { answer = r; }));
    const dialogsRef: { current: AppDialogs } = { current: { confirm, prompt: vi.fn(async () => null), notice: vi.fn(async () => {}) } };
    const { result } = renderHook(() => useReportUndoGuard({ api, dialogsRef, lang: "en-US" }));
    result.current.undo();
    stack.push(meta(3, "task.updated")); // a capture lands while the dialog is open
    answer(true);
    await vi.waitFor(() => expect(api.undoById).toHaveBeenCalledTimes(1));
    expect(api.undoById).toHaveBeenCalledWith(2);
    expect(api.undo).not.toHaveBeenCalled();
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
    await vi.waitFor(() => expect(api.redoThrough).toHaveBeenCalledWith(3));
  });
});

describe("a through-op acts only on what it asked about (AI-04)", () => {
  function deferred(stack: UndoMeta[], redoStack: UndoMeta[]) {
    const api = { undo: vi.fn(), undoById: vi.fn(), undoThrough: vi.fn(), redo: vi.fn(), redoThrough: vi.fn(), stack, redoStack };
    let answer: (ok: boolean) => void = () => {};
    const confirm = vi.fn(() => new Promise<boolean>((r) => { answer = r; }));
    const dialogsRef: { current: AppDialogs } = { current: { confirm, prompt: vi.fn(async () => null), notice: vi.fn(async () => {}) } };
    const { result } = renderHook(() => useReportUndoGuard({ api, dialogsRef, lang: "en-US" }));
    return { api, guarded: result.current, answer: (ok: boolean) => answer(ok) };
  }

  it("undoThrough does nothing when a capture landed on top while the dialog was open", async () => {
    openDirtyReport();
    const stack = [meta(1, "meetingReport.updated")];
    const h = deferred(stack, []);
    h.guarded.undoThrough(1);
    stack.push(meta(2, "task.updated"));
    h.answer(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.api.undoThrough).not.toHaveBeenCalled();
  });

  it("undoThrough runs when the top is still the one it asked about", async () => {
    openDirtyReport();
    const stack = [meta(1, "meetingReport.updated"), meta(2, "task.updated")];
    const h = deferred(stack, []);
    h.guarded.undoThrough(1);
    h.answer(true);
    await vi.waitFor(() => expect(h.api.undoThrough).toHaveBeenCalledWith(1));
  });

  it("redoThrough and redo do nothing when the redo stack grew meanwhile", async () => {
    openDirtyReport();
    const redoStack = [meta(3, "meetingReport.updated")];
    const a = deferred([], redoStack);
    a.guarded.redoThrough(3);
    redoStack.push(meta(4, "task.updated"));
    a.answer(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(a.api.redoThrough).not.toHaveBeenCalled();
    const redo2 = [meta(5, "meetingReport.updated")];
    const b = deferred([], redo2);
    b.guarded.redo();
    redo2.push(meta(6, "task.updated"));
    b.answer(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(b.api.redoThrough).not.toHaveBeenCalled();
  });
});

describe("confirmReportUndo (AI-04)", () => {
  const dialogs = (answer: boolean): { d: AppDialogs; confirm: ReturnType<typeof vi.fn> } => {
    const confirm = vi.fn(async () => answer);
    return { d: { confirm, prompt: vi.fn(async () => null), notice: vi.fn(async () => {}) } as AppDialogs, confirm };
  };
  it("goes ahead without asking when no open report is dirty", () => {
    const { d, confirm } = dialogs(false);
    expect(confirmReportUndo([meta(1, "meetingReport.updated")], d, "en-US", "undo")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
  it("asks for a report entry while a report is dirty, and passes the answer through", async () => {
    openDirtyReport();
    const { d, confirm } = dialogs(false);
    await expect(confirmReportUndo([meta(1, "meetingReport.updated")], d, "en-US", "undo")).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
