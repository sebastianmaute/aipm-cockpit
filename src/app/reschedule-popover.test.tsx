import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReschedulePopover } from "./reschedule-popover";

const action = {
  id: "task-due:1:overdue", source: "task-due",
  title: { key: "actionTaskTitle", params: ["T"] },
  why: { key: "actionTaskWhyOverdue", params: [2] }, score: 70, tier: "now",
  cta: { kind: "open", view: "open-points", id: 1 },
} as never;

describe("ReschedulePopover", () => {
  it("fires onReschedule with the chosen date and closes", () => {
    const onReschedule = vi.fn();
    render(<ReschedulePopover lang="en-US" action={action} bundle={{ onReschedule }} />);
    fireEvent.click(screen.getByRole("button", { name: /reschedule/i }));
    const input = screen.getByLabelText(/new due date/i);
    fireEvent.change(input, { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByRole("button", { name: /update/i }));
    expect(onReschedule).toHaveBeenCalledWith(action, "2026-08-01");
  });
  it("shows the current due date and prefills the input with it", () => {
    render(
      <ReschedulePopover
        lang="en-US"
        action={action}
        bundle={{ onReschedule: vi.fn(), currentDueDate: () => "2026-07-10" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reschedule/i }));
    expect(screen.getByText(/current due date: 2026-07-10/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/new due date/i)).toHaveValue("2026-07-10");
  });

  it("disables confirm when the date is empty/invalid", () => {
    render(<ReschedulePopover lang="en-US" action={action} bundle={{ onReschedule: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: /reschedule/i }));
    expect(screen.getByRole("button", { name: /update/i })).toBeDisabled();
  });

  it("portals the dialog to document.body with fixed positioning (escapes the overflow-auto clip)", () => {
    render(<ReschedulePopover lang="en-US" action={action} bundle={{ onReschedule: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: /reschedule/i }));
    const dialog = screen.getByRole("dialog");
    // Portaled OUT of the trigger's subtree so the actions-panel scroller can't
    // clip it — the dialog is a direct child of <body>, not the component.
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveClass("fixed");
  });

  it("stays open when interacting inside the portaled dialog (dismiss covers the portal)", () => {
    render(<ReschedulePopover lang="en-US" action={action} bundle={{ onReschedule: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: /reschedule/i }));
    fireEvent.mouseDown(screen.getByLabelText(/new due date/i));
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("closes on an outside mousedown", () => {
    render(<ReschedulePopover lang="en-US" action={action} bundle={{ onReschedule: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: /reschedule/i }));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
