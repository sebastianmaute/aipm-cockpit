import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RichTextToolbar } from "./rich-text-toolbar";

// A minimal Editor stub — the toolbar must not reach past isActive() and chain().
function makeEditor(active: Record<string, boolean> = {}) {
  const run = vi.fn();
  const chain = {
    focus: () => chain,
    toggleBold: () => chain, toggleItalic: () => chain, toggleUnderline: () => chain,
    toggleStrike: () => chain, toggleCode: () => chain, toggleHighlight: () => chain,
    toggleSuperscript: () => chain, toggleSubscript: () => chain,
    toggleBulletList: () => chain, toggleOrderedList: () => chain,
    toggleBlockquote: () => chain, toggleCodeBlock: () => chain,
    setParagraph: () => chain, toggleHeading: () => chain,
    unsetLink: () => chain, extendMarkRange: () => chain, setLink: () => chain,
    run,
  };
  return {
    run,
    editor: {
      isActive: (name: string, attrs?: { level?: number }) =>
        active[attrs?.level ? `${name}${attrs.level}` : name] ?? false,
      chain: () => chain,
    } as never,
  };
}

describe("RichTextToolbar", () => {
  it("renders every mark control with an accessible name", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    for (const name of ["Bold", "Italic", "Underline", "Strikethrough", "Inline code",
                        "Highlight", "Superscript", "Subscript"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("renders every block control with an accessible name", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    for (const name of ["Bullet list", "Numbered list", "Quote", "Code block"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("gives the heading select a real accessible name, not a visible span", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Text style" })).toBeTruthy();
  });

  it("offers Normal plus headings 1-4 and nothing else", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    const opts = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(["Normal text", "Heading 1", "Heading 2", "Heading 3", "Heading 4"]);
  });

  // ★ The select reflects the DOCUMENT's state, so a caret inside an <h2> must
  //   preselect "Heading 2" — a control that always reads "Normal text" would
  //   pass every other test here.
  it("preselects the heading level the caret sits in", () => {
    const { editor } = makeEditor({ heading2: true });
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    const select = screen.getByRole("combobox", { name: "Text style" }) as HTMLSelectElement;
    expect(select.value).toBe("2");
  });

  it("reports pressed state through aria-pressed", () => {
    const { editor } = makeEditor({ bold: true });
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows a NON-COLOUR pressed marker, present in both states", () => {
    const { editor } = makeEditor({ bold: true });
    const { container } = render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    expect(container.querySelectorAll("[data-pressed-marker]").length).toBeGreaterThan(1);
  });

  it("runs the bold command on click", async () => {
    const { editor, run } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(run).toHaveBeenCalled();
  });

  it("delegates the link control to onAddLink", async () => {
    const { editor } = makeEditor();
    const onAddLink = vi.fn();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={onAddLink} />);
    await userEvent.click(screen.getByRole("button", { name: "Insert link" }));
    expect(onAddLink).toHaveBeenCalledTimes(1);
  });

  // ★★ Every control acts on the editor's SELECTION. Taking focus on mousedown
  //    blurs the contenteditable and destroys it — and the commit-on-blur
  //    consumers remount the editor between mousedown and mouseup, so no click
  //    is ever dispatched. The guard lives in ToggleButton behind an opt-in prop.
  it("does not steal focus from the editor surface", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    const btn = screen.getByRole("button", { name: "Bold" });
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  // ★ The plain Buttons are a different code path from the ToggleButtons and
  //    carry their own guard, so they need their own assertion.
  it("does not steal focus from the link controls either", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    for (const name of ["Insert link", "Remove link"]) {
      const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      screen.getByRole("button", { name }).dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
  });
});
