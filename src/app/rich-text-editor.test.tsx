import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RichTextEditor, type RichTextEditorLabels } from "./rich-text-editor";

// ProseMirror touches layout APIs jsdom lacks; stub them so the editor mounts.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

const labels: RichTextEditorLabels = {
  bold: "Bold", italic: "Italic", underline: "Underline",
  heading1: "Heading 1", heading2: "Heading 2",
  bulletList: "Bullet list", numberedList: "Numbered list",
  link: "Link", unlink: "Remove link", linkPrompt: "Enter URL",
};

function setup(over: Partial<React.ComponentProps<typeof RichTextEditor>> = {}) {
  const onChange = vi.fn();
  render(
    <RichTextEditor
      value="<p>Hi</p>"
      onChange={onChange}
      label="Body"
      mergeFields={["taskName", "dueDate"]}
      fieldLabel={(f) => (f === "taskName" ? "Task name" : "Due date")}
      labels={labels}
      {...over}
    />,
  );
  return { onChange };
}

describe("RichTextEditor", () => {
  it("renders the editor surface with the given accessible label", async () => {
    setup();
    expect(await screen.findByLabelText("Body")).toBeTruthy();
  });
  it("renders the core toolbar buttons with accessible names", async () => {
    setup();
    await screen.findByLabelText("Body");
    for (const name of ["Bold", "Italic", "Underline", "Heading 1", "Heading 2", "Bullet list", "Numbered list", "Link", "Remove link"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });
  it("renders a merge-field chip per field", async () => {
    setup();
    await screen.findByLabelText("Body");
    expect(screen.getByRole("button", { name: "Task name" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Due date" })).toBeTruthy();
  });
  it("renders the initial HTML content as text", async () => {
    setup();
    const surface = await screen.findByLabelText("Body");
    expect(surface.textContent).toContain("Hi");
  });
  it("does not emit onChange on mount (no spurious save)", async () => {
    const { onChange } = setup();
    await screen.findByLabelText("Body");
    expect(onChange).not.toHaveBeenCalled();
  });
});
