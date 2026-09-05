import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { expectButtonOrder } from "../test/toolbar-order";
import { loadI18n, t } from "./i18n";
import { TaskTimeTrackingModal } from "./task-time-tracking-modal";

const base = {
  open: true,
  lang: "en-US" as const,
  estimateMinutes: 480,
  spentMinutes: 120,
  remainingMinutes: undefined,
};

// This dialog's Close and Cancel are QUALIFIED with the dialog title, because
// the task form beneath renders a Close and a Cancel of its own and speech
// input does not scope by aria-modal. Composed here from the same parts the
// component composes, so these incidental queries do not re-pin the format —
// the format itself is pinned by the 2.5.3 test below.
const DIALOG_CLOSE = `${t("en-US", "alertModalClose")} – ${t("en-US", "taskTimeTracking")}`;
const DIALOG_CANCEL = `${t("en-US", "cancel")} – ${t("en-US", "taskTimeTracking")}`;

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
    await userEvent.click(screen.getByRole("button", { name: DIALOG_CANCEL }));
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

  test("leaves Enter on a BUTTON alone, so Save/Cancel/Close stay keyboard-operable", () => {
    // REGRESSION PIN. The guard used to sit unscoped on the panel <div>, so it
    // preventDefaulted Enter for every descendant — and activating a focused
    // <button> is a DEFAULT ACTION of the keydown (WCAG 2.1.1). Measured in
    // Chromium: 0 clicks with the unscoped guard, 1 without it. jsdom does not
    // perform that default action, which is why the input-side test above
    // passed throughout; `defaultPrevented` is the observable that survives
    // both engines, so BOTH halves have to be asserted together.
    render(<TaskTimeTrackingModal {...base} onSave={vi.fn()} onClose={vi.fn()} />);
    for (const name of ["Save", DIALOG_CANCEL, DIALOG_CLOSE]) {
      const button = screen.getByRole("button", { name });
      const ev = createEvent.keyDown(button, { key: "Enter" });
      fireEvent(button, ev);
      expect(ev.defaultPrevented).toBe(false);
    }
  });

  test("shows a pinned remaining of ZERO as a value, not the derived placeholder", () => {
    // 0 is the real claim "no work left" and must not render like an unpinned
    // box. Its control is the placeholder test at the top of this file: without
    // both, nothing here can tell the two states apart, which is the defect.
    render(
      <TaskTimeTrackingModal {...base} remainingMinutes={0} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("textbox", { name: /time remaining/i })).toHaveValue("0m");
  });

  test("disables Save while a box holds unparsable text, and re-enables it on repair", async () => {
    // Unparsable text never reaches the parent's number, so an ungated Save
    // would close the dialog reporting the PREVIOUS figure while the user
    // believes their entry was taken.
    const onSave = vi.fn();
    render(
      <TaskTimeTrackingModal {...base} remainingMinutes={90} onSave={onSave} onClose={vi.fn()} />,
    );
    const remaining = screen.getByRole("textbox", { name: /time remaining/i });
    await userEvent.clear(remaining);
    await userEvent.type(remaining, "4 hours");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.clear(remaining);
    await userEvent.type(remaining, "4h");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ spentMinutes: 120, remainingMinutes: 240 });
  });

  test("Enter in a VALID duration box commits the dialog", async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<TaskTimeTrackingModal {...base} onSave={onSave} onClose={onClose} />);
    const spent = screen.getByRole("textbox", { name: /time spent/i });
    await userEvent.clear(spent);
    await userEvent.type(spent, "3h{Enter}");
    expect(onSave).toHaveBeenCalledWith({ spentMinutes: 180, remainingMinutes: undefined });
    expect(onClose).toHaveBeenCalled();
  });

  test("Enter in an INVALID duration box commits nothing", async () => {
    // Same gate as the disabled Save button — Enter must not be a way around
    // it, or the keyboard path commits exactly the stale number the button
    // refuses to.
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<TaskTimeTrackingModal {...base} onSave={onSave} onClose={onClose} />);
    const spent = screen.getByRole("textbox", { name: /time spent/i });
    await userEvent.clear(spent);
    await userEvent.type(spent, "4 hours{Enter}");
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
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

  test("puts the secondary action first and the primary last, like every other modal", () => {
    // CONVENTION PIN. task-form-modal.tsx and documents-rename-modal.tsx both
    // render Cancel then the primary CTA; this dialog shipped the other way
    // round. `contiguous` is what catches a control drifting BETWEEN the two —
    // ordering alone stays ascending in that case.
    render(<TaskTimeTrackingModal {...base} onSave={vi.fn()} onClose={vi.fn()} />);
    expectButtonOrder(["cancel", "taskTimeTrackingSave"], { contiguous: true });
  });

  test("qualifies Close and Cancel with the dialog title, keeping the visible label inside the name", () => {
    // WCAG 2.4.6 needs the qualification (the task form beneath renders a Close
    // and a Cancel of its own); WCAG 2.5.3 needs the VISIBLE text to stay
    // CONTAINED in the accessible name — containment, not prefix.
    render(<TaskTimeTrackingModal {...base} onSave={vi.fn()} onClose={vi.fn()} />);
    const cancel = screen.getByRole("button", { name: DIALOG_CANCEL });
    // The visible text is read from the DOM, not hand-copied: a component that
    // stopped rendering the base word would fail rather than pass silently.
    expect(cancel.textContent).toBe(t("en-US", "cancel"));
    expect(DIALOG_CANCEL.toLowerCase()).toContain(cancel.textContent!.toLowerCase());
    // The close ✕ has no visible text at all, so 2.5.3 does not reach it; the
    // 2.4.6 qualification still must be there.
    const close = screen.getByRole("button", { name: DIALOG_CLOSE });
    expect(close.textContent).toBe("");
  });

  test("keeps 2.5.3 containment in German, where both halves of the name differ", async () => {
    // The DE dictionary is lazy; without this the assertion would run against
    // the EN fallback and certify nothing about German.
    await loadI18n("de");
    render(<TaskTimeTrackingModal {...base} lang="de" onSave={vi.fn()} onClose={vi.fn()} />);
    const deCancel = `${t("de", "cancel")} – ${t("de", "taskTimeTracking")}`;
    // Anti-vacuity: if the DE dict had not loaded these would still read
    // "Cancel"/"Time tracking" and the containment check below would pass for
    // the wrong reason.
    expect(t("de", "cancel")).toBe("Abbrechen");
    expect(t("de", "taskTimeTracking")).toBe("Zeiterfassung");
    const cancel = screen.getByRole("button", { name: deCancel });
    expect(cancel.textContent).toBe(t("de", "cancel"));
    expect(deCancel.toLowerCase()).toContain(cancel.textContent!.toLowerCase());
  });
});
