import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useUndoStack, type CaptureCompositeOpts } from "./use-undo-stack";
import type { UndoMeta } from "./undo-stack";
import type { ToastAction } from "../use-toast";
import { readDiagLog } from "../diagnostics";

// AI-04 — the save toast's Undo asks (confirmBeforeUndo) before it runs, like the top bar and the hotkey do.
function setup(confirmBeforeUndo?: (m: UndoMeta) => true | Promise<boolean>) {
  const showToastAction = vi.fn<(kind: "info" | "error", text: string, action: ToastAction) => void>();
  const restore = vi.fn();
  const { result } = renderHook(() =>
    useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction, confirmBeforeUndo }),
  );
  const opts: CaptureCompositeOpts = {
    kind: "meetingReport.updated",
    primaryCount: 1,
    name: "M1",
    parts: [{ isPrimary: false, followsPrimary: false, restore: () => { restore(); return () => {}; } }],
  };
  act(() => result.current.captureComposite(opts));
  const toastUndo = () => showToastAction.mock.calls[0][2].run();
  return { result, restore, toastUndo };
}

describe("a confirm that rejects", () => {
  it("is logged, not left as an unhandled rejection, and undoes nothing", async () => {
    const h = setup(() => Promise.reject(new Error("dialog gone")));
    act(() => h.toastUndo());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(h.restore).not.toHaveBeenCalled();
    expect(readDiagLog().some((e) => e.code === "undo.confirmRejected")).toBe(true);
  });
});

describe("the save toast's Undo and confirmBeforeUndo", () => {
  it("asks first with the entry it would undo; a no leaves the entry on the stack and runs nothing", async () => {
    const confirm = vi.fn<(m: UndoMeta) => Promise<boolean>>(async () => false);
    const h = setup(confirm);
    act(() => h.toastUndo());
    await act(async () => { await Promise.resolve(); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({ kind: "meetingReport.updated" });
    expect(h.restore).not.toHaveBeenCalled();
    expect(h.result.current.stack).toHaveLength(1);
  });

  it("a yes undoes it", async () => {
    const h = setup(async () => true);
    await act(async () => { h.toastUndo(); await Promise.resolve(); await Promise.resolve(); });
    expect(h.restore).toHaveBeenCalledTimes(1);
    expect(h.result.current.stack).toHaveLength(0);
  });

  it("with nothing to ask (true) it undoes at once, as before", () => {
    const h = setup(() => true);
    act(() => h.toastUndo());
    expect(h.restore).toHaveBeenCalledTimes(1);
  });

  it("without the dep it undoes at once", () => {
    const h = setup(undefined);
    act(() => h.toastUndo());
    expect(h.restore).toHaveBeenCalledTimes(1);
  });
});
