import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { TaskTimeTrackingModal } from "./task-time-tracking-modal";

const base = {
  open: true,
  lang: "en-US" as const,
  estimateMinutes: 480,
  spentMinutes: 120,
  remainingMinutes: undefined,
};

describe("TaskTimeTrackingModal", () => {
  test("shows the derived remaining figure as a placeholder when nothing is pinned", () => {
    render(<TaskTimeTrackingModal {...base} onSave={vi.fn()} onClose={vi.fn()} />);
    // 480 - 120 = 360 minutes = "6h" on the Jira working-time basis (8h/day).
    expect(screen.getByRole("textbox", { name: /time remaining/i })).toHaveAttribute(
      "placeholder",
      "6h",
    );
  });

  test("shows a pinned remaining value as the field's value, not its placeholder", () => {
    render(
      <TaskTimeTrackingModal {...base} remainingMinutes={90} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("textbox", { name: /time remaining/i })).toHaveValue("1h 30m");
  });

  test("saving an emptied remaining box stores undefined, never zero", async () => {
    // THE RULE THAT DEFINES THE OVERRIDE. A stored 0 is the real claim
    // "no work left"; undefined is "not overridden". Conflating them makes
    // clearing the box silently assert the task is finished.
    const onSave = vi.fn();
    render(
      <TaskTimeTrackingModal {...base} remainingMinutes={90} onSave={onSave} onClose={vi.fn()} />,
    );
    await userEvent.clear(screen.getByRole("textbox", { name: /time remaining/i }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ spentMinutes: 120, remainingMinutes: undefined });
  });

  test("cancel discards edits", async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<TaskTimeTrackingModal {...base} onSave={onSave} onClose={onClose} />);
    await userEvent.clear(screen.getByRole("textbox", { name: /time spent/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /time spent/i }), "3h");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test("swallows a bare Enter on a duration box", () => {
    // The panel's own guard, asserted at ITS level -- independent of where the
    // dialog sits in the DOM, so portalling it cannot make this pass for the
    // wrong reason. Typing a duration and pressing Enter is the natural way to
    // finish the entry; unguarded it would submit the task form beneath.
    render(<TaskTimeTrackingModal {...base} onSave={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: /time spent/i });
    const ev = createEvent.keyDown(input, { key: "Enter" });
    fireEvent(input, ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  test("leaves other keys alone, so typing a duration still works", () => {
    render(<TaskTimeTrackingModal {...base} onSave={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: /time spent/i });
    const ev = createEvent.keyDown(input, { key: "h" });
    fireEvent(input, ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  test("states plainly that there is no original estimate rather than printing an empty one", () => {
    render(
      <TaskTimeTrackingModal
        {...base}
        estimateMinutes={undefined}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/no original estimate/i)).toBeInTheDocument();
  });
});
