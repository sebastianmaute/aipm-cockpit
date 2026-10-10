import { useState } from "react";
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InlineAiEditPopover } from "./inline-ai-edit-popover";
import { Modal } from "./modal";

// §694 — the popover opened from inside an open Modal (an entity edit modal,
// for example). ★ It is opened by a CLICK, in a later commit than the Modal,
// as production does: mounting both in one commit inverts the dismissal
// stack's open order (docs/AGENTS/ui-shell.md, ESCAPE PROTOCOL, PRECONDITION).
function Host({ onModalClose, onCancel }: { onModalClose: () => void; onCancel: () => void }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  return (
    <Modal open onClose={onModalClose} ariaLabel="Edit RAID item">
      <div>
        <button type="button" onClick={() => setPopoverOpen(true)}>Ask AI</button>
        {popoverOpen && (
          <InlineAiEditPopover
            lang="en-US"
            itemTitle="Vendor late"
            entityLabel="RAID item"
            phase="idle"
            plan={null}
            clarifyText=""
            errorText=""
            onSubmit={vi.fn()}
            onApply={vi.fn()}
            onCancel={() => { onCancel(); setPopoverOpen(false); }}
          />
        )}
      </div>
    </Modal>
  );
}

it("closes only the popover when Escape is pressed while it sits above an open Modal", () => {
  const onModalClose = vi.fn();
  const onCancel = vi.fn();
  render(<Host onModalClose={onModalClose} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
  expect(screen.getByRole("dialog", { name: "Ask Claude" })).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onModalClose).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "Ask Claude" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Edit RAID item" })).toBeInTheDocument();

  // The next Escape belongs to the Modal again.
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onModalClose).toHaveBeenCalledTimes(1);
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("renders the dialog with Modal's root markers (tabindex -1, inline z-index 70) — a tripwire, not a proof", () => {
  render(<Host onModalClose={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
  const dialog = screen.getByRole("dialog", { name: "Ask Claude" });
  // Modal's root: the backdrop is the dialog element, focusable at -1, layered by inline z-index.
  expect(dialog.getAttribute("tabindex")).toBe("-1");
  expect(dialog.style.zIndex).toBe("70");
});
