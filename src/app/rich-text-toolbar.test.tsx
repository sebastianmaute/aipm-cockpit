import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

  // -------------------------------------------------------------------------
  // Naming the row (WCAG 2.4.6 / technique ARIA17)
  // -------------------------------------------------------------------------
  //
  // ★★★ THESE ARE THE ONLY DETECTOR THAT EXISTS. Measured against the installed
  // axe-core 4.12.1: of its 105 rules, 69 carry one of the four tags
  // `e2e/a11y.spec.ts` requests, and NOT ONE flags two controls sharing an
  // accessible name — so the a11y gate is silent on this in every view, at
  // every seed size, forever.
  // ★★★ AND A SINGLE-EDITOR FIXTURE CANNOT SEE IT EITHER: with one toolbar in
  // the DOM, `getByRole("button", { name: "Bold" })` resolves whether or not
  // the group exists. The collision only exists with two rows mounted, which is
  // the real shape — the change modal renders THREE editors as siblings in one
  // form, RAID two, and the note log two. Keep the two-row test below.
  it("names the row after the editor it acts on", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />);
    expect(screen.getByRole("group", { name: "Description" })).toBeTruthy();
  });

  it("keeps two mounted rows apart — each control resolves inside its own group", async () => {
    const a = makeEditor();
    const b = makeEditor();
    render(
      <>
        <RichTextToolbar editor={a.editor} lang="en-US" label="Description" onAddLink={() => {}} />
        <RichTextToolbar editor={b.editor} lang="en-US" label="Mitigation" onAddLink={() => {}} />
      </>,
    );
    // The names really are ambiguous at the flat level — that is the defect.
    expect(screen.getAllByRole("button", { name: "Bold" })).toHaveLength(2);
    expect(screen.getAllByRole("combobox", { name: "Text style" })).toHaveLength(2);

    // …and the group boundary is what resolves them. Assert the RELATIONSHIP,
    // not the count: two groups could both be named "Description" and every
    // count assertion here would still pass.
    const description = screen.getByRole("group", { name: "Description" });
    const mitigation = screen.getByRole("group", { name: "Mitigation" });
    const boldInDescription = within(description).getByRole("button", { name: "Bold" });
    const boldInMitigation = within(mitigation).getByRole("button", { name: "Bold" });
    expect(boldInDescription).not.toBe(boldInMitigation);
    // Each group holds exactly one of each repeated control, so neither group
    // contains the other's row.
    expect(within(description).getAllByRole("button", { name: "Bold" })).toHaveLength(1);
    expect(within(mitigation).getAllByRole("combobox", { name: "Text style" })).toHaveLength(1);

    // The control inside a group still drives ITS OWN editor — a group that
    // merely renamed things while both rows pointed at one editor would pass
    // every assertion above.
    await userEvent.click(boldInMitigation);
    expect(b.run).toHaveBeenCalled();
    expect(a.run).not.toHaveBeenCalled();
  });

  // ★★ `group` and NOT `toolbar`: the APG toolbar pattern is a keyboard
  //    contract (one tab stop, roving tabindex, arrow keys between controls)
  //    that this row does not implement — every control is its own tab stop.
  it("does not claim the toolbar role, whose keyboard contract it does not honour", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  // ★★ An UNNAMED group is worse than no group — it announces a boundary
  //    carrying no information. So no label means no role at all, and in
  //    particular never a generic fallback: three sibling groups all called
  //    "Formatting" disambiguate nothing while looking fixed.
  it("renders no group at all when there is no name for it", () => {
    const { editor } = makeEditor();
    const { container } = render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    expect(screen.queryByRole("group")).toBeNull();
    const row = container.firstElementChild;
    expect(row?.hasAttribute("aria-label")).toBe(false);
    expect(row?.hasAttribute("role")).toBe(false);
    // The controls themselves are unaffected — this is a naming change only.
    expect(screen.getByRole("button", { name: "Bold" })).toBeTruthy();
  });

  it("treats a blank label as no name, not as an empty one", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" label="   " onAddLink={() => {}} />);
    expect(screen.queryByRole("group")).toBeNull();
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
