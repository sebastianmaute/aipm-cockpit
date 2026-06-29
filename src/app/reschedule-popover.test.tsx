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
  it("disables confirm when the date is empty/invalid", () => {
    render(<ReschedulePopover lang="en-US" action={action} bundle={{ onReschedule: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: /reschedule/i }));
    expect(screen.getByRole("button", { name: /update/i })).toBeDisabled();
  });
});
