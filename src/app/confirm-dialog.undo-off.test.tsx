import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ConfirmProvider, useConfirm } from "./confirm-dialog";
import { useUndoHotkey } from "./use-undo-hotkey";

// AI-04 — a confirm opened from the meeting report switches the app undo off inside itself: the provider renders at
// the app root, outside the report dialog's own `appUndoOff` subtree, so without this Ctrl+Z reached the app undo.
function Harness({ appUndoOff, undo, redo }: { appUndoOff?: boolean; undo: () => void; redo: () => void }) {
  useUndoHotkey(undo, redo);
  const confirm = useConfirm();
  return (
    <button type="button" onClick={() => void confirm({ message: "Replace?", appUndoOff })}>
      ask
    </button>
  );
}

async function openConfirm(appUndoOff: boolean | undefined) {
  const undo = vi.fn();
  const redo = vi.fn();
  render(
    <ConfirmProvider lang="en-US">
      <Harness appUndoOff={appUndoOff} undo={undo} redo={redo} />
    </ConfirmProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "ask" }));
  const cancel = await screen.findByRole("button", { name: "Cancel" });
  return { undo, redo, cancel };
}

const chords = [
  { key: "z", ctrlKey: true },
  { key: "z", ctrlKey: true, shiftKey: true },
  { key: "y", ctrlKey: true },
];

describe("ConfirmOptions.appUndoOff", () => {
  it("with it, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y inside the dialog reach neither undo nor redo", async () => {
    const { undo, redo, cancel } = await openConfirm(true);
    for (const c of chords) act(() => { fireEvent.keyDown(cancel, c); });
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it("without it (a confirm opened elsewhere) the hotkeys are unaffected", async () => {
    const { undo, redo, cancel } = await openConfirm(undefined);
    for (const c of chords) act(() => { fireEvent.keyDown(cancel, c); });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(2);
  });
});
