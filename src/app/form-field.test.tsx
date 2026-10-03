import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Field } from "./task-form-layout";

describe("Field captionAction", () => {
  test("clicking the caption does NOT activate the caption control", async () => {
    // THE POINT OF THE WHOLE PROP. A <label> with no `for` binds to its
    // first LABELABLE descendant, and a button IS labelable. With the caption
    // control inside a binding <label>, clicking the words "Task name" would
    // fire the mic instead of focusing the field.
    // ★ The name deliberately claims ONLY the negative half. This test once
    // also promised "focuses the input", which it never asserted AND which is
    // false here: `captionAction` puts the Field in `group` mode, where the
    // caption is a plain <span> with no binding at all, so clicking it focuses
    // NOTHING. Do not "complete" this test by adding a focus assertion — it
    // would be pinning behaviour the component does not have. The input gets
    // its name from an explicit aria-label instead (see task-form-fields).
    const onMic = vi.fn();
    render(
      <Field
        label="Task name"
        captionAction={<button type="button" onClick={onMic}>Hold to dictate</button>}
      >
        <input aria-label="Task name" />
      </Field>,
    );
    await userEvent.click(screen.getByText("Task name"));
    expect(onMic).not.toHaveBeenCalled();
  });

  test("renders a named group rather than a label when captionAction is passed", () => {
    render(
      <Field label="Task name" captionAction={<button type="button">Hold to dictate</button>}>
        <input aria-label="Task name" />
      </Field>,
    );
    expect(screen.getByRole("group", { name: "Task name" })).toBeInTheDocument();
  });

  test("still wraps in a label when no captionAction is passed", async () => {
    // The default branch must be untouched -- every other Field in the app
    // relies on the implicit label binding.
    render(
      <Field label="Group">
        <input />
      </Field>,
    );
    await userEvent.click(screen.getByText("Group"));
    expect(screen.getByRole("textbox")).toHaveFocus();
  });
});

describe("Field hint (open-followups §386)", () => {
  const HINT = "Free-text grouping shown in the task list";

  test("a hinted label Field names its control with the label alone", () => {
    render(
      <Field label="Group" hint={HINT}>
        <input />
      </Field>,
    );
    // Whole-string match: before the fix the tooltip glyph joined the label's
    // text content and this computed "Groupi".
    expect(screen.getByRole("textbox", { name: "Group" })).toBeInTheDocument();
  });

  test("the hint stays reachable to AT through the focusable tooltip trigger", async () => {
    render(
      <Field label="Group" hint={HINT}>
        <input />
      </Field>,
    );
    const trigger = screen.getByRole("button", { name: HINT });
    await userEvent.tab();
    expect(trigger).toHaveFocus();
  });

  test("clicking a hinted caption still focuses its control", async () => {
    render(
      <Field label="Group" hint={HINT}>
        <input />
      </Field>,
    );
    await userEvent.click(screen.getByText("Group"));
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  test("a hinted group Field names its group with the label alone", () => {
    // ★ Not sensitive to where the tooltip renders: `FieldGroup`'s aria-label
    //   outranks its content. It pins the outcome, not the §386 mechanism —
    //   the label-branch test above is the one that fails on a regression.
    render(
      <Field label="Health" hint={HINT} group>
        <button type="button">Auto</button>
      </Field>,
    );
    expect(screen.getByRole("group", { name: "Health" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: HINT })).toBeInTheDocument();
  });
});
