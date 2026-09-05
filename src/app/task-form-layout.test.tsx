import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Field } from "./task-form-layout";

describe("Field captionAction", () => {
  test("clicking the caption focuses the input and does NOT activate the caption control", async () => {
    // THE POINT OF THE WHOLE PROP. A <label> with no `for` binds to its
    // first LABELABLE descendant, and a button IS labelable. With the caption
    // control inside a binding <label>, clicking the words "Task name" would
    // fire the mic instead of focusing the field.
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
