import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentsRenameModal } from "./documents-rename-modal";

describe("DocumentsRenameModal", () => {
  it("commits on Enter but not mid-IME-composition", () => {
    const onCommit = vi.fn();
    render(
      <DocumentsRenameModal
        lang="en-US"
        draft="Plan"
        onDraftChange={vi.fn()}
        onCancel={vi.fn()}
        onCommit={onCommit}
      />,
    );
    const input = screen.getByLabelText(/title/i);

    // Mid-composition Enter (e.g. confirming an IME candidate) must not commit.
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onCommit).not.toHaveBeenCalled();

    // A plain Enter commits — this half is what makes the assertion above
    // non-vacuous: it proves the handler is wired at all, so deleting the
    // whole onKeyDown would fail here even though it would pass the
    // composing-guard assertion alone.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("reports draft edits via onDraftChange", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <DocumentsRenameModal
        lang="en-US"
        draft="Plan"
        onDraftChange={onDraftChange}
        onCancel={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(/title/i);
    await user.type(input, "!");

    expect(onDraftChange).toHaveBeenCalledWith("Plan!");
  });

  it("calls onCancel from the Cancel button", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <DocumentsRenameModal
        lang="en-US"
        draft="Plan"
        onDraftChange={vi.fn()}
        onCancel={onCancel}
        onCommit={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
