import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ConfirmProvider, useConfirm, type AppDialogs } from "./confirm-dialog";
import { useUndoHotkey } from "./use-undo-hotkey";
import { confirmReportUndo } from "./use-report-undo-guard";
import type { UndoMeta } from "./undo/undo-stack";

// AI-04 — the guard's own question switches the app undo off inside itself, so Ctrl+Z there cannot stack a second one.
const ENTRY: UndoMeta = { id: 1, kind: "meetingReport.updated", count: 1, timestamp: "t", label: "l" };

afterEach(() => {
  document.body.innerHTML = "";
});

describe("confirmReportUndo's own confirm", () => {
  it("Ctrl+Z inside it neither asks again nor reaches the undo", async () => {
    const dirty = document.createElement("div");
    dirty.setAttribute("data-report-dirty", "true");
    document.body.appendChild(dirty);
    const undo = vi.fn();
    function Harness() {
      const confirm = useConfirm();
      const dialogs = { confirm, prompt: vi.fn(async () => null), notice: vi.fn(async () => {}) } as AppDialogs;
      const ask = () => {
        undo();
        void confirmReportUndo([ENTRY], dialogs, "en-US", "undo");
      };
      useUndoHotkey(ask);
      return <button type="button" onClick={ask}>undo</button>;
    }
    render(
      <ConfirmProvider lang="en-US">
        <Harness />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    act(() => { fireEvent.keyDown(cancel, { key: "z", ctrlKey: true }); });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});
