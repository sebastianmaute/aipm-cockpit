import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/react";
import { RichTextToolbar, TOOLBAR_CONTROL_COUNT } from "./rich-text-toolbar";
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

  it("gives the heading trigger a real accessible name", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    expect(screen.getByRole("button", { name: "Text style" })).toBeTruthy();
  });

  it("opens the heading menu on click, offering Normal text plus headings 1-4 and nothing else", async () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Text style" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const dialog = screen.getByRole("dialog", { name: "Text style" });
    // The trigger's aria-controls must reference the panel that actually
    // opened, not a fabricated string — the real regression the two ids
    // being wired via a shared useId() prevents.
    expect(trigger.getAttribute("aria-controls")).toBe(dialog.id);
    expect(dialog.id).toBeTruthy();
    const items = within(dialog)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(items).toEqual(["Normal text", "Heading 1", "Heading 2", "Heading 3", "Heading 4"]);
  });

  // ★ The trigger reflects the DOCUMENT's state, so a caret inside an <h2>
  //   must mark "Heading 2" active — a menu that always showed paragraph as
  //   active would pass every other test here.
  it("marks the heading level the caret sits in as the active menu item", async () => {
    const { editor } = makeEditor({ heading2: true });
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Text style" }));
    const dialog = screen.getByRole("dialog", { name: "Text style" });
    expect(within(dialog).getByRole("button", { name: "Heading 2" }).getAttribute("aria-current")).toBe("true");
    expect(within(dialog).getByRole("button", { name: "Normal text" }).hasAttribute("aria-current")).toBe(false);
  });

  it("runs the heading command and closes the menu when an item is picked", async () => {
    const { editor, run } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Text style" }));
    await userEvent.click(screen.getByRole("button", { name: "Heading 3" }));

    expect(run).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Text style" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog", { name: "Text style" })).toBeNull();
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
  //    is ever dispatched. The guard lives in ToolbarButton behind an opt-in prop.
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
    expect(screen.getAllByRole("button", { name: "Text style" })).toHaveLength(2);

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
    expect(within(mitigation).getAllByRole("button", { name: "Text style" })).toHaveLength(1);

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
    //   carries `opacity-0` when off, so it must have moved too.
    expect(bold().querySelector("[data-pressed-marker]")?.className).not.toContain("opacity-0");
  });

  it("re-reads the active heading item when the caret MOVES into a heading", async () => {
    const editor = realEditor("<p>intro</p><h2>section</h2>");
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    // Position 10 sits inside the <h2> (paragraph is 0-7, heading content 8-15).
    act(() => {
      editor.commands.setTextSelection(10);
    });
    await userEvent.click(screen.getByRole("button", { name: "Text style" }));
    const dialog = screen.getByRole("dialog", { name: "Text style" });
    expect(within(dialog).getByRole("button", { name: "Heading 2" }).getAttribute("aria-current")).toBe("true");
  });

  // ★★★ THE CONTENT-LOSS CASE, carried over from the native-select version.
  //     The menu shows "Heading 2" as ACTIVE; picking it must be a no-op.
  //     `toggleHeading` would demote the block instead — measured
  //     `<p>intro</p><h2>section</h2>` → `<p>intro</p><p>section</p>`.
  it("picking the level the caret is already in does not demote the block", async () => {
    const editor = realEditor("<p>intro</p><h2>section</h2>");
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    act(() => {
      editor.commands.setTextSelection(10);
    });
    const before = editor.getHTML();
    expect(before).toContain("<h2>section</h2>");

    await userEvent.click(screen.getByRole("button", { name: "Text style" }));
    await userEvent.click(screen.getByRole("button", { name: "Heading 2" }));

    expect(editor.getHTML()).toBe(before);
  });

  // ★ The rewritten combobox→menu tests all click a HEADING item, leaving the
  //   `level === undefined` branch of `setLevel` (setParagraph) with no
  //   interaction coverage at all — a click on "Normal text" that silently
  //   did nothing (or threw) would have passed the whole suite. This pins it.
  it("picking Normal text demotes a heading to a paragraph", async () => {
    const editor = realEditor("<p>intro</p><h2>section</h2>");
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    act(() => {
      editor.commands.setTextSelection(10);
    });
    expect(editor.getHTML()).toContain("<h2>section</h2>");

    await userEvent.click(screen.getByRole("button", { name: "Text style" }));
    await userEvent.click(screen.getByRole("button", { name: "Normal text" }));

    expect(editor.getHTML()).toContain("<p>section</p>");
    expect(editor.getHTML()).not.toContain("<h2>");
  });

  // ★ `setLevel` never calls `.chain().focus()` (unchanged from the native
  //   select's own no-focus rule — see the deleted comment this replaces in
  //   rich-text-toolbar.tsx), so picking a menu item must not pull DOM focus
  //   into the editor. There is no arrow-key-fires-change landmine for a menu
  //   of buttons (that was `<select>`-specific), so this is a narrower,
  //   simpler regression test than the one it replaces.
  it("does not pull DOM focus into the editor when a heading item is picked", async () => {
    const editor = realEditor("<p>hello</p>");
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    const focusSpy = vi.spyOn(editor.view, "focus");

    await userEvent.click(screen.getByRole("button", { name: "Text style" }));
    await userEvent.click(screen.getByRole("button", { name: "Heading 3" }));

    expect(editor.getHTML()).toContain("<h3>hello</h3>");
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("separates the six control groups with five dividers", () => {
    const { editor } = makeEditor();
    const { container } = render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    // Dividers are the only `aria-hidden` DIRECT children of the row besides
    // the pressed-marker bars (which live inside each ToolbarButton, not as
    // direct row children) — querying the row's own direct-child divs by
    // class is more robust than counting `[aria-hidden]` broadly.
    const row = container.firstElementChild as HTMLElement;
    const dividers = Array.from(row.children).filter((el) => el.className.includes("bg-line"));
    expect(dividers).toHaveLength(5);
  });

  // ★ Even though this control now shares ToolbarButton's preventFocusSteal
  //    mechanism with the toggle controls above, it's a distinct call site
  //    (Link/Unlink, not a mark/block toggle) and worth its own regression pin.
  it("does not steal focus from the link controls either", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    for (const name of ["Insert link", "Remove link"]) {
      const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      screen.getByRole("button", { name }).dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
  });

  // ★★ `<button>` is NATIVELY tabbable, so marking one control tabIndex={0}
  // does nothing on its own — every other control stays reachable and the
  // tab-stop count is unchanged. The -1 on the other fourteen is the line the
  // whole slice's user-visible claim rests on.
  it("puts every control but the active one out of the tab order", () => {
    const { editor } = makeEditor();
    const { container } = render(
      <RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(buttons.filter((b) => b.tabIndex === -1)).toHaveLength(buttons.length - 1);
  });

  // ★ Pins the index arithmetic against the DOM. The constants below are
  // derived from CONTROLS.length rather than hardcoded, and this is what stops
  // them drifting from the JSX if a control is added or removed.
  // ★★ It ALSO pins the no-disabled invariant: no control in this row is ever
  // disabled today, which is why the roving engine needs no skip-disabled
  // logic. Adding a disabled control turns this red and forces that decision
  // rather than silently breaking the arrow order.
  it("has TOOLBAR_CONTROL_COUNT enabled buttons and no disabled one", () => {
    const { editor } = makeEditor();
    const { container } = render(
      <RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons).toHaveLength(TOOLBAR_CONTROL_COUNT);
    expect(buttons.filter((b) => b.disabled)).toHaveLength(0);

    // ★★ The count alone does NOT pin the ORDER, and the order is what the
    // roving arithmetic indexes into. Moving Link/Unlink ahead of the CONTROLS
    // map keeps the count at 15 and would silently redirect every arrow key.
    expect(buttons[0].getAttribute("aria-label")).toBe("Text style");
    expect(buttons[TOOLBAR_CONTROL_COUNT - 2].getAttribute("aria-label")).toBe("Insert link");
    expect(buttons[TOOLBAR_CONTROL_COUNT - 1].getAttribute("aria-label")).toBe("Remove link");
  });

  // ★★★ THE SECOND TAB IS THE ASSERTION. A first Tab lands on control 1
  // whether or not the roving works — only the second one distinguishes a
  // single-tab-stop row from fifteen tab stops.
  it("is a single tab stop: a second Tab leaves the row entirely", async () => {
    const user = userEvent.setup();
    const { editor } = makeEditor();
    render(
      <>
        <RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />
        <button type="button">after the row</button>
      </>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Text style" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "after the row" }));
  });

  // ★★★ THE PIN THAT CATCHES REUSING useTablistRoving, whose move ends in
  // `target.click()`. Under that helper this ArrowRight would have run
  // toggleBold and mutated the document. A toolbar moves focus and nothing else.
  it("moves focus with ArrowRight and runs no command", async () => {
    const user = userEvent.setup();
    const { editor, run } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bold" }));
    expect(run).not.toHaveBeenCalled();
  });

  it("wraps with ArrowLeft and jumps with Home/End", async () => {
    const user = userEvent.setup();
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />);
    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove link" }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Text style" }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove link" }));
  });

  // ★★ A SINGLE-TOOLBAR FIXTURE CANNOT SEE THIS. change-edit-modal.tsx mounts
  // three rows; each must rove within itself.
  it("keeps two mounted rows roving independently", async () => {
    const user = userEvent.setup();
    const a = makeEditor();
    const b = makeEditor();
    render(
      <>
        <RichTextToolbar editor={a.editor} lang="en-US" label="Description" onAddLink={() => {}} />
        <RichTextToolbar editor={b.editor} lang="en-US" label="Mitigation" onAddLink={() => {}} />
      </>,
    );
    const rowB = screen.getByRole("group", { name: "Mitigation" });
    await user.tab();
    await user.tab(); // out of row A, into row B's single stop
    expect(within(rowB).getByRole("button", { name: "Text style" })).toBe(document.activeElement);
    await user.keyboard("{ArrowRight}");
    expect(within(rowB).getByRole("button", { name: "Bold" })).toBe(document.activeElement);
  });
});
