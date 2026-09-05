import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { Button } from "./button";
import { t } from "./i18n";
import { ModalHeader } from "./modal-header";
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
    // The dialog's Cancel is QUALIFIED with the dialog title, so the task form
    // beneath can keep an unqualified Cancel of its own without colliding.
    await userEvent.click(
      screen.getByRole("button", {
        name: `${t("en-US", "cancel")} – ${t("en-US", "taskTimeTracking")}`,
      }),
    );
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
    const onChange = vi.fn();
    render(
      <form onSubmit={submitSpy}>
        <input aria-label="outside" />
        <TaskTimeTrackingButton {...base} onChange={onChange} />
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
    // Enter COMMITS this dialog (Jira-shaped) and closes it — so "still open"
    // is no longer the right proxy for "the outer form was spared". The
    // commit landing on the DIALOG's onChange rather than on the form's
    // onSubmit is what the assertion pair above and below actually says.
    expect(onChange).toHaveBeenCalledWith({ spentMinutes: 180, remainingMinutes: undefined });
    expect(screen.queryByRole("dialog", { name: /time tracking/i })).not.toBeInTheDocument();
  });

  test("captions itself through the shared Field primitive, in `group` mode", () => {
    // The caption is `Field`'s, not a hand-rolled copy of its markup — and
    // `group` mode specifically: the child IS a button, and a <label> with no
    // `for` binds to its first LABELABLE descendant, so the default branch
    // would make clicking the caption OPEN the dialog. `Field` renders
    // <div role="group" aria-label> instead (task-form-layout.tsx).
    render(<TaskTimeTrackingButton {...base} />);
    const group = screen.getByRole("group", { name: t("en-US", "taskTimeTracking") });
    expect(group).toContainElement(screen.getByRole("button", { name: /time tracking/i }));
    // The caption text is rendered once, inside that group.
    expect(within(group).getByText(t("en-US", "taskTimeTracking"))).toBeInTheDocument();
  });

  test("the dialog's Close and Cancel do not collide with the task form's", async () => {
    // WCAG 2.4.6 / speech input. The task form beneath renders a ModalHeader
    // close button and a secondary Cancel (`task-form-modal.tsx`); this dialog
    // renders one of each again. Screen readers scope announcements by
    // aria-modal, but SPEECH INPUT does not — "click Cancel" with two Cancels
    // picks one arbitrarily, and the wrong one abandons the whole task edit.
    //
    // ★ The form beneath is REPRODUCED here (its two controls, verbatim from
    // task-form-modal.tsx) rather than mounted: TaskFormModal needs Workspace
    // and Filters providers plus an advanced-tier field toggle before this
    // button renders at all. A change to the form's own two controls would not
    // reach this fixture — re-read task-form-modal.tsx's footer if it moves.
    render(
      <>
        <ModalHeader lang="en-US" title="Edit task" onClose={vi.fn()} />
        <TaskTimeTrackingButton {...base} />
        <Button variant="secondary">{t("en-US", "cancel")}</Button>
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: /time tracking/i }));
    // SIX controls, the exact measured count: the form's Close + Cancel, the
    // tracking trigger, and the dialog's Close + Save + Cancel. A loose floor
    // would let a fixture that stopped rendering the dialog read as a pass.
    // `requireCollisionSeed` is deliberately OFF — this is a distinct-name pin,
    // and that guard THROWS unless two names collide once " (N)" is stripped,
    // which is the state this test exists to forbid.
    expectRowUniqueNames({ minControls: 6 });
  });

  test("does not expose a progressbar role, because the track is decorative here", () => {
    render(<TaskTimeTrackingButton {...base} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
