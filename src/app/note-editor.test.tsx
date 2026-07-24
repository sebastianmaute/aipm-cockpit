import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NoteEditor } from "./note-editor";

// ProseMirror touches layout APIs jsdom lacks; stub them so the editor mounts.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

function setup(over: Partial<React.ComponentProps<typeof NoteEditor>> = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <NoteEditor
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

describe("NoteEditor", () => {
  it("renders the editor surface with the given accessible label", async () => {
    setup();
    expect(await screen.findByRole("textbox", { name: "Note" })).toBeTruthy();
  });

  it("renders the lean toolbar (bold/italic/bullet/numbered/link) and nothing heavier", async () => {
    setup();
    await screen.findByRole("textbox", { name: "Note" });
    for (const name of ["Bold", "Italic", "Bullet list", "Numbered list", "Insert link"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // Lean set: no underline / no headings.
    expect(screen.queryByRole("button", { name: "Underline" })).toBeNull();
    expect(screen.queryByRole("button", { name: /heading/i })).toBeNull();
  });

  it("renders the initial HTML content as text", async () => {
    setup();
    const surface = await screen.findByRole("textbox", { name: "Note" });
    expect(surface.textContent).toContain("Hi");
  });

  it("does not emit onChange on mount (no spurious save)", async () => {
    const { onChange } = setup();
    await screen.findByRole("textbox", { name: "Note" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits sanitized HTML through onChange when content changes via the toolbar", async () => {
    const { onChange } = setup();
    await screen.findByRole("textbox", { name: "Note" });
    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    expect(onChange).toHaveBeenCalled();
    const html = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(html).toContain("<ul>");
    expect(html).toContain("Hi");
  });

  it("with commitOnEnter, plain Enter commits and Shift+Enter does not", async () => {
    const { onCommit } = setup({ commitOnEnter: true });
    const surface = await screen.findByRole("textbox", { name: "Note" });
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(surface, { key: "Enter", shiftKey: true });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("without commitOnEnter, Enter does not commit", async () => {
    const { onCommit } = setup({ commitOnEnter: false });
    const surface = await screen.findByRole("textbox", { name: "Note" });
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
