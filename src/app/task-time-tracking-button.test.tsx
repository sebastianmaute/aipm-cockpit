import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { TaskTimeTrackingButton } from "./task-time-tracking-button";

const base = {
  lang: "en-US" as const,
  estimateMinutes: 480,
  spentMinutes: 120,
  remainingMinutes: undefined,
  onChange: vi.fn(),
};

describe("TaskTimeTrackingButton", () => {
  test("names itself with the figures, so the state is available without opening the dialog", () => {
    render(<TaskTimeTrackingButton {...base} />);
    // WCAG 2.5.3 is CONTAINMENT, case-insensitive and position-independent --
    // not prefix. The visible text must appear somewhere in the name.
    // formatDuration uses a JIRA WORKING-TIME basis: 8h = 1 day, 5d = 1 week.
    // So 120 minutes is "2h" and 480 minutes is "1d", NOT "8h".
    const btn = screen.getByRole("button", { name: /time tracking/i });
    expect(btn).toHaveAccessibleName(expect.stringContaining("2h"));
    expect(btn).toHaveAccessibleName(expect.stringContaining("1d"));
  });

  test("does not submit the surrounding form, because the task form wraps it", () => {
    // A bare <button> defaults to type="submit"; this one sits inside the task
    // <form>, so the default would save the task on every dialog open.
    render(<TaskTimeTrackingButton {...base} />);
    expect(screen.getByRole("button", { name: /time tracking/i })).toHaveAttribute("type", "button");
  });

  test("is still operable with no estimate, because time can be logged against an unestimated task", async () => {
    render(<TaskTimeTrackingButton {...base} estimateMinutes={undefined} />);
    const btn = screen.getByRole("button", { name: /time tracking/i });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(screen.getByRole("dialog", { name: /time tracking/i })).toBeInTheDocument();
  });

  test("opens the dialog and reports saved values to its caller", async () => {
    const onChange = vi.fn();
    render(<TaskTimeTrackingButton {...base} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /time tracking/i }));
    await userEvent.clear(screen.getByRole("textbox", { name: /time spent/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /time spent/i }), "3h");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenCalledWith({ spentMinutes: 180, remainingMinutes: undefined });
  });

  test("unmounts the dialog on close, so a discarded edit cannot survive into the next open", async () => {
    // EffortField seeds its text ONCE via a lazy useState, and the dialog's own
    // two useStates seed from props the same way -- a RETAINED instance would
    // reopen showing the previous session's discarded text.
    const onChange = vi.fn();
    render(<TaskTimeTrackingButton {...base} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /time tracking/i }));
    await userEvent.clear(screen.getByRole("textbox", { name: /time spent/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /time spent/i }), "3h");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /time tracking/i }));
    // Re-seeded from the PROP (120 -> "2h"), not from the discarded "3h".
    expect(screen.getByRole("textbox", { name: /time spent/i })).toHaveValue("2h");
  });

  test("does not expose a progressbar role, because the track is decorative here", () => {
    render(<TaskTimeTrackingButton {...base} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
