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
  test("names itself with the caption verbatim, so a speech-input user can say what they see", () => {
    // WCAG 2.5.3 is CONTAINMENT -- the VISIBLE text must appear in the name.
    // Derived from one function, so this cannot drift; asserting the caption as
    // RENDERED (not a hand-written copy) is what makes the test non-vacuous.
    // formatDuration uses a JIRA WORKING-TIME basis: 8h = 1 day, 5d = 1 week.
    // So 120 minutes is "2h" and 480 minutes is "1d", NOT "8h".
    const { container } = render(<TaskTimeTrackingButton {...base} />);
    const btn = screen.getByRole("button", { name: /time tracking/i });
    const caption = container.querySelector("p")?.textContent ?? "";
    // Load-bearing: without it a caption that failed to render makes
    // stringContaining("") trivially true and this test certifies nothing.
    expect(caption).not.toBe("");
    expect(btn).toHaveAccessibleName(expect.stringContaining(caption));
  });

  test("names itself with the caption verbatim in the no-estimate branch too", () => {
    // One i18n string now serves both branches, so the no-estimate caption
    // ("No estimate set") has to be contained in the name as well.
    const { container } = render(<TaskTimeTrackingButton {...base} estimateMinutes={undefined} />);
    const btn = screen.getByRole("button", { name: /time tracking/i });
    const caption = container.querySelector("p")?.textContent ?? "";
    expect(caption).not.toBe("");
    expect(btn).toHaveAccessibleName(expect.stringContaining(caption));
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

  test("portals the dialog out of the surrounding form", async () => {
    // The dialog must not be a DESCENDANT of the task <form>: an ancestor panel
    // carries a non-`none` transform, which would scope the dialog's own fixed
    // backdrop to that panel instead of the viewport.
    render(
      <form data-testid="host">
        <TaskTimeTrackingButton {...base} />
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: /time tracking/i }));
    const dialog = screen.getByRole("dialog", { name: /time tracking/i });
    expect(screen.getByTestId("host")).not.toContainElement(dialog);
    // A direct child of <body>, i.e. the portal target itself -- "somewhere in
    // the document" would be true of the un-portaled tree too.
    expect(dialog.parentElement).toBe(document.body);
  });

  test("pressing Enter in a duration box cannot submit the surrounding task form", async () => {
    const submitSpy = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={submitSpy}>
        <input aria-label="outside" />
        <TaskTimeTrackingButton {...base} />
        <button type="submit">Save task</button>
      </form>,
    );

    // ANTI-VACUITY CONTROL. If jsdom did not implement implicit form
    // submission, the negative assertion below would pass against ANY
    // implementation and certify nothing. Assert the positive first.
    await userEvent.type(screen.getByRole("textbox", { name: "outside" }), "x{Enter}");
    expect(submitSpy).toHaveBeenCalledTimes(1);
    submitSpy.mockClear();

    await userEvent.click(screen.getByRole("button", { name: /time tracking/i }));
    const spent = screen.getByRole("textbox", { name: /time spent/i });
    await userEvent.clear(spent);
    await userEvent.type(spent, "3h{Enter}");
    expect(submitSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /time tracking/i })).toBeInTheDocument();
  });

  test("does not expose a progressbar role, because the track is decorative here", () => {
    render(<TaskTimeTrackingButton {...base} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
