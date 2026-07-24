import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

function setupLean(over: Partial<React.ComponentProps<typeof RichTextEditor>> = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <RichTextEditor
      variant="lean"
      value="<p>Hi</p>"
      onChange={onChange}
      onCommit={onCommit}
      label="Note"
      lang="en-US"
      {...over}
    />,
  );
  return { onChange, onCommit };
}

describe("RichTextEditor lean variant", () => {
  it("renders the editor surface with the given accessible label", async () => {
    setupLean();
    expect(await screen.findByRole("textbox", { name: "Note" })).toBeTruthy();
  });

  it("renders the lean toolbar (bold/italic/bullet/numbered/link) and nothing heavier", async () => {
    setupLean();
    await screen.findByRole("textbox", { name: "Note" });
    for (const name of ["Bold", "Italic", "Bullet list", "Numbered list", "Insert link"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // Lean set: no underline / no headings.
    expect(screen.queryByRole("button", { name: "Underline" })).toBeNull();
    expect(screen.queryByRole("button", { name: /heading/i })).toBeNull();
  });

  it("renders the initial HTML content as text", async () => {
    setupLean();
    const surface = await screen.findByRole("textbox", { name: "Note" });
    expect(surface.textContent).toContain("Hi");
  });

  it("does not emit onChange on mount (no spurious save)", async () => {
    const { onChange } = setupLean();
    await screen.findByRole("textbox", { name: "Note" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits sanitized HTML through onChange when content changes via the toolbar", async () => {
    const { onChange } = setupLean();
    await screen.findByRole("textbox", { name: "Note" });
    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    expect(onChange).toHaveBeenCalled();
    const html = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(html).toContain("<ul>");
    expect(html).toContain("Hi");
  });
});

describe("RichTextEditor commitOnEnter", () => {
  it("with commitOnEnter, plain Enter commits and Shift+Enter does not", async () => {
    const { onCommit } = setupLean({ commitOnEnter: true });
    const surface = await screen.findByRole("textbox", { name: "Note" });
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(surface, { key: "Enter", shiftKey: true });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("without commitOnEnter, Enter does not commit", async () => {
    const { onCommit } = setupLean({ commitOnEnter: false });
    const surface = await screen.findByRole("textbox", { name: "Note" });
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not commit on Enter fired during IME composition (isComposing)", async () => {
    const { onCommit } = setupLean({ commitOnEnter: true });
    const surface = await screen.findByRole("textbox", { name: "Note" });
    // Enter to confirm a CJK IME candidate must not commit the note.
    fireEvent.keyDown(surface, { key: "Enter", isComposing: true });
    expect(onCommit).not.toHaveBeenCalled();
    // The legacy keyCode 229 IME sentinel is also guarded.
    fireEvent.keyDown(surface, { key: "Enter", keyCode: 229 });
    expect(onCommit).not.toHaveBeenCalled();
    // A normal Enter afterwards still commits.
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
