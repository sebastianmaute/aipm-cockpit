import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UndoControl, RedoControl } from "./undo-control";

describe("UndoControl", () => {
  it("renders nothing when the stack is empty", () => {
    const { container } = render(<UndoControl lang="en-US" depth={0} onUndo={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a labeled button with the depth and fires onUndo", async () => {
    const onUndo = vi.fn();
    render(<UndoControl lang="en-US" depth={3} onUndo={onUndo} />);
    const btn = screen.getByRole("button", { name: /undo/i });
    expect(btn).toHaveAttribute("aria-label");
    expect(btn).toHaveTextContent("3");
    await userEvent.click(btn);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("caret opens a popover previewing the next entry's label", async () => {
    render(<UndoControl lang="en-US" depth={2} nextLabel={'Delete task "X"'} onUndo={() => {}} />);
    const caret = screen.getByRole("button", { name: /show next undo/i });
    expect(caret).toHaveAttribute("aria-haspopup");
    expect(caret).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(caret);
    expect(caret).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText('Delete task "X"')).toBeInTheDocument();
  });

  it("renders no caret when nextLabel is absent", () => {
    render(<UndoControl lang="en-US" depth={2} onUndo={() => {}} />);
    expect(screen.queryByRole("button", { name: /show next undo/i })).toBeNull();
  });
});

describe("RedoControl", () => {
  it("renders nothing when the redo stack is empty", () => {
    const { container } = render(<RedoControl lang="en-US" depth={0} onRedo={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a labeled button with the depth and fires onRedo", async () => {
    const onRedo = vi.fn();
    render(<RedoControl lang="en-US" depth={2} onRedo={onRedo} />);
    const btn = screen.getByRole("button", { name: /redo/i });
    expect(btn).toHaveAttribute("aria-label");
    expect(btn).toHaveTextContent("2");
    await userEvent.click(btn);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });
});
