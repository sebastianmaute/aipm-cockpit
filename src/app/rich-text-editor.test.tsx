import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { useRef } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import { RichTextEditor, EXTENSIONS, type RichTextEditorHandle } from "./rich-text-editor";
import { sanitizeRichHtml } from "./sanitize-html";

// ProseMirror touches layout APIs jsdom lacks; stub them so the editor mounts.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
  // userEvent's pointer press calls document.elementFromPoint (absent in jsdom).
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
});

function setup(over: Partial<React.ComponentProps<typeof RichTextEditor>> = {}) {
  const onChange = vi.fn();
  render(
    <RichTextEditor
      value="<p>Hi</p>"
      onChange={onChange}
      label="Body"
      lang="en-US"
      mergeFields={["taskName", "dueDate"]}
      fieldLabel={(f) => (f === "taskName" ? "Task name" : "Due date")}
      {...over}
    />,
  );
  return { onChange };
}

// ★★ Query the surface BY ROLE, never `findByLabelText`. `label` now names two
// things — the contenteditable AND the toolbar's `role="group"` wrapper, which
// is what tells the fifteen repeated control names apart when a form mounts
// several editors (see rich-text-toolbar.tsx). A label-text query matches both
// and throws "Found multiple elements"; the role pins which one is meant.
describe("RichTextEditor", () => {
  it("renders the editor surface with the given accessible label", async () => {
    setup();
    expect(await screen.findByRole("textbox", { name: "Body" })).toBeTruthy();
  });
  // There is ONE editor now, so there is ONE control set: the Tiptap "Simple"
  // template's. Headings are an icon-triggered menu button (rich-text-toolbar.tsx),
  // not a level <select> — the toolbar has been icon-only since the redesign.
  it("renders the core toolbar buttons with accessible names", async () => {
    setup();
    await screen.findByRole("textbox", { name: "Body" });
    for (const name of [
      "Bullet list", "Numbered list", "Quote", "Code block",
      "Bold", "Italic", "Underline", "Strikethrough", "Inline code",
      "Highlight", "Superscript", "Subscript",
      "Insert link", "Remove link",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Text style" })).toBeTruthy();
  });

  // ★★★ THE ONLY THING IN THIS FILE THAT SEES THE `label` -> TOOLBAR WIRE.
  // `RichTextEditor` forwards `label={label}` to `RichTextToolbar` at ONE site,
  // and that forward is the entire WCAG 2.4.6 fix: the toolbar's group is
  // named-or-ABSENT (`rich-text-toolbar.tsx`), so a cut wire silently drops
  // `role="group"` altogether and the fifteen repeated control names go back to
  // being indistinguishable in a form mounting two or three editors (the change
  // modal mounts three). Measured before this test existed: cutting the forward
  // left this file 33/33 GREEN, and `change-edit-modal.test.tsx` (28/28) and
  // `raid-edit-modal.test.tsx` (20/20) green too.
  // ★★ Asserted against a DISTINCTIVE label rather than `setup()`'s shared
  // "Body", so a hardcoded group name would fail as well as a cut wire; and
  // asserted THROUGH a control inside the group, so a `role="group"` on some
  // other empty wrapper could not satisfy it.
  // ★★ NO GATE CAN SEE THIS EITHER. None of the 90 axe scans reaches ANY of the
  // twelve `<RichTextEditor` mounts — measured, for four different reasons, and
  // axe is blind to a duplicate accessible name even where it does scan
  // (`docs/open-followups.md` §144 carries both).
  it("names the toolbar from the editor's own label prop", async () => {
    setup({ label: "Impact description" });
    await screen.findByRole("textbox", { name: "Impact description" });
    const toolbar = screen.getByRole("toolbar", { name: "Impact description" });
    expect(within(toolbar).getByRole("button", { name: "Bold" })).toBeTruthy();
  });

  it("renders a merge-field chip per field", async () => {
    setup();
    await screen.findByRole("textbox", { name: "Body" });
    expect(screen.getByRole("button", { name: "Task name" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Due date" })).toBeTruthy();
  });
  it("renders the initial HTML content as text", async () => {
    setup();
    const surface = await screen.findByRole("textbox", { name: "Body" });
    expect(surface.textContent).toContain("Hi");
  });
  it("does not emit onChange on mount (no spurious save)", async () => {
    const { onChange } = setup();
    await screen.findByRole("textbox", { name: "Body" });
    expect(onChange).not.toHaveBeenCalled();
  });

  // The markdown input rules are the reason the extensions were re-enabled: the
  // toolbar has a heading select, `sanitizeRichHtml` allows h1-h4, and it keeps
  // the text of anything it unwraps — so "# " must reach storage as an <h1>.
  it("still turns a markdown '# ' shortcut into a heading", async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ value: "" });
    const surface = await screen.findByRole("textbox", { name: "Body" });
    await user.click(surface);
    await user.keyboard("# Full heading");
    expect(surface.querySelector("h1")?.textContent).toBe("Full heading");
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h1>Full heading</h1>");
  });

  it.each([
    ["inline code", "ship `staging` now", "code", "staging"],
    ["strikethrough", "was ~~dropped~~ ok", "s", "dropped"],
    ["horizontal rule", "--- ", "hr", ""],
  ])("still applies the markdown %s shortcut", async (_name, typed, selector, kept) => {
    const user = userEvent.setup();
    const { onChange } = setup({ value: "" });
    const surface = await screen.findByRole("textbox", { name: "Body" });
    await user.click(surface);
    await user.keyboard(typed);
    expect(surface.querySelector(selector)).not.toBeNull();
    if (kept) {
      expect(surface.querySelector(selector)?.textContent).toBe(kept);
      // `sanitizeRichHtml` unwraps an unlisted tag but keeps its text, and all
      // three of these tags are on its list — so the word reaches storage either
      // way. The tag-level assertions live in the input-rule suite below.
      expect(onChange.mock.calls.at(-1)?.[0]).toContain(kept);
    }
  });
});

/** The note-log/narrative call shape: no merge fields, commit-on-Enter available.
 *  It renders the SAME editor and the SAME toolbar as `setup` — the lean/full
 *  split is gone — so these cases pin the inline-surface behaviour, not a variant. */
function setupNote(over: Partial<React.ComponentProps<typeof RichTextEditor>> = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <RichTextEditor
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

describe("RichTextEditor on an inline note surface", () => {
  it("renders the editor surface with the given accessible label", async () => {
    setupNote();
    expect(await screen.findByRole("textbox", { name: "Note" })).toBeTruthy();
  });

  // ★ This case used to assert the OPPOSITE — that an inline surface got a cut-down
  // toolbar with no underline and no headings. There is one editor now, so an
  // inline note gets the full control set; the assertion is inverted deliberately.
  it("renders the same full control set an embedded editor gets", async () => {
    setupNote();
    await screen.findByRole("textbox", { name: "Note" });
    for (const name of ["Bold", "Italic", "Bullet list", "Numbered list", "Insert link"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Underline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Text style" })).toBeTruthy();
  });

  it("renders the initial HTML content as text", async () => {
    setupNote();
    const surface = await screen.findByRole("textbox", { name: "Note" });
    expect(surface.textContent).toContain("Hi");
  });

  it("does not emit onChange on mount (no spurious save)", async () => {
    const { onChange } = setupNote();
    await screen.findByRole("textbox", { name: "Note" });
    expect(onChange).not.toHaveBeenCalled();
  });

  // ★★★ THIS SUITE ASSERTED THE OPPOSITE AND WAS INVERTED DELIBERATELY. It used
  // to pin that every markdown shortcut stayed LITERAL TEXT, because the retired
  // 8-tag note sanitizer ran KEEP_CONTENT:false: it deleted an unlisted node
  // together with its words, so the six extensions below were switched off to
  // stop the input rules building nodes the commit would then eat. One allow-list
  // and one KEEP_CONTENT-default sanitizer later, the shortcuts are the point —
  // so each one must now reach STORAGE as its tag, not merely as its text. The
  // tag-level assertion is what distinguishes this from the pre-fix behaviour;
  // a text-only one would pass either way.
  it.each([
    // typed, the node the editor must build, the fragment the SANITIZED commit carries
    ["heading", "# Q3 highlights", "h1", "<h1>Q3 highlights</h1>"],
    ["blockquote", "> quoted text", "blockquote", "<blockquote>"],
    ["code block", "``` fenced", "pre", "<pre>"],
    ["inline code", "ship `staging` now", "code", "<code>staging</code>"],
    ["strikethrough", "was ~~dropped~~ ok", "s", "<s>dropped</s>"],
    ["horizontal rule", "--- ", "hr", "<hr>"],
  ])(
    "applies the markdown %s shortcut and commits it as markup",
    async (_name, typed, selector, fragment) => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<RichTextEditor value="" onChange={onChange} label="Note" lang="en-US" />);
      const surface = await screen.findByRole("textbox", { name: "Note" });
      await user.click(surface);
      await user.keyboard(typed);
      expect(surface.querySelector(selector)).not.toBeNull();
      const html = (onChange.mock.calls.at(-1)?.[0] ?? "") as string;
      expect(html).toContain(fragment);
    },
  );

  // ★★★ INVERTED, LIKE THE SUITE ABOVE. This case used to assert `not.toContain
  // ("<u")` — the toolbar-parity property, when an inline surface had no
  // underline control and the mark was reachable only by Mod-U. The toolbar now
  // offers Underline everywhere, `u` is on RICH_ALLOWED_TAGS and the sanitizer
  // unwraps rather than deletes, so stored underline must SURVIVE a round trip.
  // Both assertions stay: the word one is the anti-vacuity guard for the tag one
  // (an empty editor would satisfy a tag assertion for free in the old
  // direction, and a lost word would satisfy neither).
  it("round-trips a stored underline through the sanitized commit", async () => {
    const onChange = vi.fn();
    function Harness() {
      const ref = useRef<RichTextEditorHandle>(null);
      return (
        <>
          <RichTextEditor
            value="<u>underlined</u> rest"
            onChange={onChange}
            label="Note"
            lang="en-US"
            editorRef={ref}
          />
          <button type="button" onClick={() => ref.current?.appendText("X")}>go</button>
        </>
      );
    }
    render(<Harness />);
    const surface = await screen.findByRole("textbox", { name: "Note" });
    // Anti-vacuity: a never-fired onChange would leave the payload assertions
    // unreached, and an editor that dropped the mark at PARSE time would make the
    // commit assertion say nothing about the sanitizer.
    expect(surface.textContent).toContain("underlined");
    expect(surface.querySelector("u")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = onChange.mock.calls.at(-1)![0] as string;
    expect(html).toContain("underlined");
    expect(html).toContain("<u>");
  });

  it("emits sanitized HTML through onChange when content changes via the toolbar", async () => {
    const { onChange } = setupNote();
    await screen.findByRole("textbox", { name: "Note" });
    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    expect(onChange).toHaveBeenCalled();
    const html = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(html).toContain("<ul>");
    expect(html).toContain("Hi");
  });
});

describe("RichTextEditor imperative handle", () => {
  it("appends dictated text through the imperative handle without remounting", async () => {
    const onChange = vi.fn();
    function Harness() {
      const ref = useRef<RichTextEditorHandle>(null);
      return (
        <>
          <RichTextEditor
            value="<p>Hello</p>"
            onChange={onChange}
            label="Note"
            lang="en-US"
            editorRef={ref}
          />
          <button type="button" onClick={() => ref.current?.appendText(" world")}>go</button>
        </>
      );
    }
    render(<Harness />);
    await screen.findByRole("textbox", { name: "Note" });
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)![0]).toContain("world");
  });

  it("inserts dictated text as text, never as markup", async () => {
    const onChange = vi.fn();
    function Harness() {
      const ref = useRef<RichTextEditorHandle>(null);
      return (
        <>
          <RichTextEditor value="<p></p>" onChange={onChange} label="Note" lang="en-US" editorRef={ref} />
          <button type="button" onClick={() => ref.current?.appendText("<b>x</b>")}>go</button>
        </>
      );
    }
    render(<Harness />);
    await screen.findByRole("textbox", { name: "Note" });
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = onChange.mock.calls.at(-1)![0] as string;
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });
});

describe("RichTextEditor commitOnEnter", () => {
  it("with commitOnEnter, plain Enter commits and Shift+Enter does not", async () => {
    const { onCommit } = setupNote({ commitOnEnter: true });
    const surface = await screen.findByRole("textbox", { name: "Note" });
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(surface, { key: "Enter", shiftKey: true });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("without commitOnEnter, Enter does not commit", async () => {
    const { onCommit } = setupNote({ commitOnEnter: false });
    const surface = await screen.findByRole("textbox", { name: "Note" });
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not commit on Enter fired during IME composition (isComposing)", async () => {
    const { onCommit } = setupNote({ commitOnEnter: true });
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

describe("RichTextEditor — CSP nonce on the injected Tiptap stylesheet", () => {
  // ★★★ createStyleTag DEDUPES on style[data-tiptap-style] and appends to
  // document.head, which RTL cleanup() does not touch. Without this reset the
  // FIRST editor mounted anywhere in this file wins and every assertion below
  // reads that tag — the test then passes with `injectNonce` deleted. Mutation
  // -proved: removing the option must turn this red.
  beforeEach(() => {
    document.head.querySelectorAll("style[data-tiptap-style]").forEach((el) => el.remove());
    document.head.querySelectorAll("script[nonce]").forEach((el) => el.remove());
  });

  it("puts the page's nonce on the style tag Tiptap injects", async () => {
    const script = document.createElement("script");
    script.setAttribute("nonce", "test-nonce");
    script.nonce = "test-nonce";
    document.head.appendChild(script);

    setup();

    await waitFor(() => {
      expect(document.head.querySelector("style[data-tiptap-style]")).not.toBeNull();
    });
    expect(
      document.head.querySelector("style[data-tiptap-style]")!.getAttribute("nonce"),
    ).toBe("test-nonce");
  });

  it("injects an un-nonced tag when the page has no nonce, rather than failing to mount", async () => {
    setup();

    await waitFor(() => {
      expect(document.head.querySelector("style[data-tiptap-style]")).not.toBeNull();
    });
    expect(
      document.head.querySelector("style[data-tiptap-style]")!.hasAttribute("nonce"),
    ).toBe(false);
  });
});

// ★★ SOURCE-TEXT ASSERTIONS, and they are weak by nature: they pin SPELLING, not
// behaviour, and they rot silently. They are here only for facts whose only other
// witness is a browser (a CSP nonce on an injected <style>, an extension list the
// jsdom mount cannot distinguish). Everything provable by rendering is asserted by
// rendering, above.
describe("RichTextEditor — structural facts the DOM cannot show", () => {
  const SRC = readFileSync("src/app/rich-text-editor.tsx", "utf8");

  it("exposes no variant prop", () => {
    expect(SRC).not.toContain("RichTextEditorVariant");
    expect(SRC).not.toContain("isLean");
  });

  it("registers the Simple-template extensions", () => {
    for (const ext of ["Highlight", "Subscript", "Superscript"]) expect(SRC).toContain(ext);
    expect(SRC).toContain("levels: [1, 2, 3, 4]");
  });

  it("no longer disables underline, strike, code, blockquote, codeBlock or headings", () => {
    for (const off of ["heading: false", "blockquote: false", "codeBlock: false",
                       "code: false", "strike: false", "horizontalRule: false",
                       "underline: false"]) {
      expect(SRC).not.toContain(off);
    }
  });

  it("sanitizes committed html with the one sanitizer", () => {
    expect(SRC).toContain("sanitizeRichHtml");
    expect(SRC).not.toContain("sanitizeNoteHtml");
    expect(SRC).not.toContain("sanitizeTemplateHtml");
  });

  it("keeps the CSP nonce on the injected ProseMirror stylesheet", () => {
    // The app's ONLY useEditor call, and createStyleTag dedupes on
    // style[data-tiptap-style] — one un-nonced mount poisons every later one.
    // Prod CSP is nonce-only on style-src-elem; dev is not (open-followups §54).
    expect(SRC).toContain("injectNonce: readCspNonce()");
  });
});

describe("alignment is stored as data-align, never as style (§140)", () => {
  it("serializes a centred paragraph with data-align and no style attribute", () => {
    const editor = new Editor({ extensions: EXTENSIONS, content: "<p>hello</p>" });
    editor.chain().selectAll().setTextAlign("center").run();
    const html = editor.getHTML();
    editor.destroy();
    expect(html).toContain('data-align="center"');
    expect(html).not.toContain("style=");
  });

  it("round-trips a stored data-align back into editor state", () => {
    const editor = new Editor({ extensions: EXTENSIONS, content: '<p data-align="right">hi</p>' });
    const active = editor.isActive({ textAlign: "right" });
    editor.destroy();
    expect(active).toBe(true);
  });

  it("survives the storage boundary unchanged", () => {
    const editor = new Editor({ extensions: EXTENSIONS, content: "<p>hello</p>" });
    editor.chain().selectAll().setTextAlign("justify").run();
    const html = editor.getHTML();
    editor.destroy();
    expect(sanitizeRichHtml(html)).toBe(html);
  });
});
