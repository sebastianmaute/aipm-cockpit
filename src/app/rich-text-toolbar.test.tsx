import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/react";
import { RichTextToolbar } from "./rich-text-toolbar";
import { EXTENSIONS } from "./rich-text-editor";

// ★★★ THE STUB BELOW IS STRUCTURALLY BLIND TO A WHOLE DEFECT CLASS, and one
// shipped behind it. Its `isActive` reads a FROZEN record, so every assertion
// over a pressed state or the heading value pins the DERIVATION and can never
// see that the derivation is not re-run when the caret moves. 16/16 passed
// while Bold reported "off" inside bold text and the select read "Normal text"
// inside an <h2>. Anything about a control REACTING to editor state belongs in
// the real-editor block at the bottom of this file; the stub stays for the
// naming/wiring assertions, which is all it can honestly carry.
// The `on`/`off` no-ops satisfy `useEditorState`'s transaction subscription.
function makeEditor(active: Record<string, boolean> = {}) {
  const run = vi.fn();
  const chain = {
    focus: () => chain,
    toggleBold: () => chain, toggleItalic: () => chain, toggleUnderline: () => chain,
    toggleStrike: () => chain, toggleCode: () => chain, toggleHighlight: () => chain,
    toggleSuperscript: () => chain, toggleSubscript: () => chain,
    toggleBulletList: () => chain, toggleOrderedList: () => chain,
    toggleBlockquote: () => chain, toggleCodeBlock: () => chain,
    setParagraph: () => chain, setHeading: () => chain,
    unsetLink: () => chain, extendMarkRange: () => chain, setLink: () => chain,
    run,
  };
  const editor = {
    isActive: (name: string, attrs?: { level?: number }) =>
      active[attrs?.level ? `${name}${attrs.level}` : name] ?? false,
    chain: () => chain,
    on: () => editor,
    off: () => editor,
  };
  return { run, editor: editor as never };
}

// A REAL Tiptap editor over the app's own EXTENSIONS. Destroyed after each test
// so the ProseMirror view and its transaction listeners cannot leak across.
const live: Editor[] = [];
function realEditor(content: string): Editor {
  const editor = new Editor({
    extensions: EXTENSIONS,
    content,
    element: document.createElement("div"),
  });
  live.push(editor);
  return editor;
}
afterEach(() => {
  while (live.length > 0) live.pop()?.destroy();
});

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

  // -------------------------------------------------------------------------
  // Live editor state — the stub above CANNOT see any of this
  // -------------------------------------------------------------------------
  //
  // ★★★ These drive a REAL Tiptap editor over the app's own EXTENSIONS. Every
  // assertion here is about the toolbar REACTING to editor state, which is a
  // property of the subscription, not of the derivation — and a stub whose
  // `isActive` reads a frozen record can only ever pin the derivation. Both
  // defects below shipped with the stub suite fully green.

  it("re-reads pressed state when the caret MOVES — a selection-only transaction", () => {
    const editor = realEditor("<p>plain <strong>bold</strong></p>");
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    const bold = () => screen.getByRole("button", { name: "Bold" });
    expect(bold().getAttribute("aria-pressed")).toBe("false");

    let sawDocChanged = true;
    editor.on("transaction", ({ transaction }) => {
      sawDocChanged = transaction.docChanged;
    });
    // Position 9 sits inside the bold run ("plain " is 1-7, "bold" is 7-11).
    act(() => {
      editor.commands.setTextSelection(9);
    });

    // ★ The DOCUMENT did not change. That is the whole point: `onUpdate` — the
    //   editor's only other channel into React — is gated on `docChanged` by
    //   core, so this transaction cannot reach the toolbar through it.
    expect(sawDocChanged).toBe(false);
    expect(editor.isActive("bold")).toBe(true);

    expect(bold().getAttribute("aria-pressed")).toBe("true");
    // ★★ WCAG 4.1.2: `title` is the accessible DESCRIPTION and rode the same
    //    stale read. "Currently off — click to turn on" while the caret sits in
    //    bold text tells a screen-reader user to press Bold to turn it ON,
    //    which turns it off.
    expect(bold().getAttribute("title")).toContain("Currently on");
    // ★ The non-colour marker is the sighted counterpart of the same state and
    //   is `invisible` when off, so it must have moved too.
    expect(bold().querySelector("[data-pressed-marker]")?.className).not.toContain("invisible");
  });

  it("re-reads the heading value when the caret MOVES into a heading", () => {
    const editor = realEditor("<p>intro</p><h2>section</h2>");
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    const select = screen.getByRole("combobox", { name: "Text style" }) as HTMLSelectElement;
    expect(select.value).toBe("0");
    // Position 10 sits inside the <h2> (paragraph is 0-7, heading content 8-15).
    act(() => {
      editor.commands.setTextSelection(10);
    });
    expect(select.value).toBe("2");
  });

  // ★★★ THE CONTENT-LOSS CASE. The select DISPLAYS "Heading 2"; picking the
  //     option already shown must be a no-op. `toggleHeading` demoted the block
  //     instead — measured `<p>intro</p><h2>section</h2>` → `<p>intro</p><p>section</p>`.
  it("picking the level the caret is already in does not demote the block", () => {
    const editor = realEditor("<p>intro</p><h2>section</h2>");
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    act(() => {
      editor.commands.setTextSelection(10);
    });
    const select = screen.getByRole("combobox", { name: "Text style" });
    expect((select as HTMLSelectElement).value).toBe("2");
    // Snapshot AFTER the caret move: StarterKit's trailing-node plugin appends
    // an empty paragraph behind a document-final heading on the first
    // transaction, which is its own behaviour and not the toolbar's.
    const before = editor.getHTML();
    expect(before).toContain("<h2>section</h2>");

    fireEvent.change(select, { target: { value: "2" } });

    expect(editor.getHTML()).toBe(before);
    expect((select as HTMLSelectElement).value).toBe("2");
  });

  // ★★★ The mechanism behind dropping `.focus()`: a CLOSED <select> fires
  //     `change` on every arrow keypress in Chrome/Firefox, so a chain starting
  //     `.focus()` applied Heading 1 AND pulled DOM focus out of the select,
  //     stranding the user in the editor with Headings 2-4 unreachable. The
  //     command needs no DOM focus — ProseMirror keeps its selection in editor
  //     state across a blur.
  it("applies a level with DOM focus parked outside the editor, and leaves it there", async () => {
    const editor = realEditor("<p>hello</p>");
    render(
      <>
        <button type="button">outside</button>
        <RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />
      </>,
    );
    const outside = screen.getByRole("button", { name: "outside" });
    outside.focus();
    expect(document.activeElement).toBe(outside);

    // Tiptap's `focus` command defers to requestAnimationFrame, so the spy has
    // to survive a frame — a synchronous assertion would pass either way.
    const focusSpy = vi.spyOn(editor.view, "focus");
    fireEvent.change(screen.getByRole("combobox", { name: "Text style" }), {
      target: { value: "3" },
    });

    // `toContain`: StarterKit's trailing-node plugin appends an empty paragraph
    // behind the now document-final heading.
    expect(editor.getHTML()).toContain("<h3>hello</h3>");

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    // ★★ THE SPY IS THE ONLY DETECTOR HERE, and `document.activeElement` is
    //    NOT a second one. Measured by reordering the two assertions under a
    //    mutation that restores `.chain().focus()`: `view.focus` fires, and
    //    `document.activeElement` STILL reads `outside` — jsdom does not treat
    //    ProseMirror's contenteditable as a focusable area, so the real-browser
    //    consequence (focus leaves the select mid-arrow-key) is invisible to
    //    every layer of this suite. An `activeElement` assertion here would be
    //    vacuous, so it is deliberately absent rather than reassuring.
    expect(focusSpy).not.toHaveBeenCalled();

    // ★★ THE OTHER BRANCH, and it is the one the guard exists for: arrowing UP
    //    out of a heading fires `change` with "0", so `setParagraph` is reached
    //    by exactly the keyboard sequence that strands the user. Restoring
    //    `.chain().focus()` on that branch ALONE left this file 20/20 green
    //    until this second change was added.
    fireEvent.change(screen.getByRole("combobox", { name: "Text style" }), {
      target: { value: "0" },
    });
    expect(editor.getHTML()).toContain("<p>hello</p>");
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(focusSpy).not.toHaveBeenCalled();
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
