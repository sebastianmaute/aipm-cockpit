"use client";
import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { Ref } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { createPortal } from "react-dom";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import type { Editor } from "@tiptap/react";
import { sanitizeRichHtml } from "./sanitize-html";
import { readCspNonce } from "./csp-nonce";
import { isSafeHttpUrl } from "./document-link";
import { Button } from "./button";
import { RichTextToolbar } from "./rich-text-toolbar";
import { t, type Lang } from "./i18n";

/** The position a deferred append should land at: the end of the document's
 *  LAST TEXTBLOCK, so the text joins that block instead of starting a new one.
 *
 *  ★★★ NOT `doc.content.size`. That is a position at DOC level, AFTER the last
 *  block, and ProseMirror cannot place a text node there — its fitting algorithm
 *  wraps the text in a NEW PARAGRAPH. The dominant case (an empty note composer
 *  receiving a transcript before the editor chunk loads) therefore persisted as
 *  `<p></p><p>transcript</p>`, a stored leading blank line that
 *  `sanitizeRichHtml` does not strip. Measured against this repo's own
 *  prosemirror-model, not reasoned: `content.size` gave [paragraph,
 *  paragraph:"DICT"] on an empty doc and [paragraph:"existing",
 *  paragraph:"DICT"] on `<p>existing</p>`; this gives [paragraph:"DICT"] and
 *  [paragraph:"existingDICT"]. ★★ `content.size - 1` is NOT the fix either —
 *  measured wrong for a trailing list, where it opens a new list ITEM.
 *
 *  ★ Equivalent to prosemirror-state's `Selection.atEnd(doc).from` for every
 *  shape this editor can hold, verified case by case (empty paragraph, trailing
 *  text, trailing bullet list, nested list, paragraph-then-list, trailing code
 *  block, heading-only). It is computed here rather than imported because
 *  `prosemirror-state` is a TRANSITIVE dependency, reachable only through
 *  `@tiptap/pm`, which this package.json does not declare.
 *
 *  ★★ ONE MEASURED DIVERGENCE from `Selection.atEnd`, and it is deliberate: for a
 *  document whose last node is a horizontal rule, `atEnd` gives the doc-level
 *  position AFTER the rule (a new paragraph below it) while this gives the end of
 *  the paragraph above it. Text is placed one block earlier, never lost. A doc
 *  with NO textblock at all falls back to the doc end, where wrapping in a fresh
 *  paragraph is the correct outcome rather than the bug above. */
export function appendPos(doc: Editor["state"]["doc"]): number {
  let end: number | null = null;
  // `descendants` walks in document order, so the last textblock wins.
  doc.descendants((node, pos) => {
    if (node.isTextblock) end = pos + node.nodeSize - 1;
  });
  return end ?? doc.content.size;
}

export interface RichTextEditorHandle {
  /** Insert plain text. WHERE it lands and WHETHER the editor takes focus are
   *  INDEPENDENT: position follows an `everFocused` ref (the caret if the user
   *  has ever been in this editor, otherwise the end of the last textblock),
   *  focus follows `opts.focus`. See the ★★★ block on the implementation and
   *  `docs/open-followups.md` §192 for why conflating the two was a defect.
   *  Used by the dictation mic — the editor binds `content` once at mount, so a
   *  new `value` cannot reach it.
   *
   *  ★★★ RETURNS WHETHER THE TEXT LANDED, and a caller that ignores it is the
   *  silent-data-loss bug this signature exists to make impossible. Holding a
   *  handle is NOT the same as the handle being usable: `useEditor` runs with
   *  `immediatelyRender: false`, so `editor` is null on the first render and
   *  this method is a NO-OP until Tiptap is live. Worse, `useImperativeHandle`
   *  below has deps `[editor]` — so a callback ref is attached ONCE with a dead
   *  handle, detached with `null`, and re-attached with the live one. Any
   *  "is the ref populated?" test therefore answers YES while appends vanish.
   *  ★★ THE QUEUE THAT ACTS ON THIS LIVES IN `rich-text-editor-lazy.tsx`, not in
   *  any consumer, so this return value has exactly ONE reader in the app. That
   *  is deliberate: a boolean nobody is forced to check is a convention, and the
   *  bug it replaced was a consumer forgetting one. Consumers get a handle whose
   *  `appendText` cannot lose text and always returns true.
   *
   *  ★★ `focus: false` DOES NOT DECIDE POSITION, and this paragraph used to say
   *  it did ("appends at the END of the document"). It no longer can: on an
   *  editor the user HAS been in, `{focus: false}` inserts at the CARET without
   *  moving focus. What the flag is FOR is a DEFERRED append, whose moment is
   *  decided by a network fetch rather than by the user — focusing then would
   *  yank the caret out of whatever they had moved on to.
   *  ★★ THE STALE-SELECTION WARNING IS THEREFORE MORE RELEVANT, NOT LESS: on a
   *  focused editor a deferred append splices at whatever selection was left
   *  behind. NOTHING REACHES THAT TODAY — the only `{focus: false}` caller is
   *  `flushPending`, which runs at attach, when `everFocused` is still false and
   *  the text goes to the end. A second caller, or a queue that outlives a focus,
   *  would reach it. */
  appendText(text: string, opts?: { focus?: boolean }): boolean;
}

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  label: string;
  /** Plain Enter commits instead of splitting the paragraph. */
  commitOnEnter?: boolean;
  onCommit?: () => void;
  /** Drives the toolbar labels and the link prompt. */
  lang: Lang;
  /** Comm templates only: `{{token}}` chips rendered under the toolbar. */
  mergeFields?: readonly string[];
  fieldLabel?: (field: string) => string;
  /** Imperative handle for appending dictated text (React 19 ref-as-prop). */
  editorRef?: Ref<RichTextEditorHandle>;
  /** Renders the toolbar into this element instead of inline above the
   *  contenteditable. ★★ OPT-IN, and it must stay opt-in: every other surface
   *  wants the toolbar attached to its own editor, and a portal moves DOM
   *  position, which is the recorded way to break Tab order. The one consumer
   *  (the documents block editor at a narrow pane) docks it ABOVE the document,
   *  i.e. the position it already occupies logically. */
  toolbarContainer?: HTMLElement | null;
}

// ★★ THE MARKDOWN INPUT RULES ARE DELIBERATELY ON. Seven StarterKit extensions
// used to be switched off here — heading, blockquote, the code block, inline
// code, strike, the horizontal rule and underline — because the lean surfaces
// sanitized with the retired 8-tag note sanitizer, which ran DOMPurify at
// KEEP_CONTENT:false: it DELETED an unlisted element together with its text. The
// input rules produce exactly those nodes from "# ", "> ", "```", "`x`", "~~x~~"
// and "--- ", so the keystroke left the formatting on screen while the committed
// value silently lost it — typing "# Q3 highlights" stored nothing at all (no
// error, no toast, and for the dashboard narrative Save stayed disabled because
// `unchanged` was then true). Underline was the same family, reachable only by
// Mod-U since no lean toolbar button offered it.
// Both reasons are gone: every surface now sanitizes with `sanitizeRichHtml` at
// DOMPurify's DEFAULT KEEP_CONTENT (unwrap an unlisted tag, keep its words), and
// this one toolbar carries a visible control for each of those seven bar the
// horizontal rule — so no mark is creatable by an invisible keystroke any more.
// ★ Headings are pinned to 1-4 because the extension's own default is 1-6, which
// would let "##### " build an h5 that RICH_ALLOWED_TAGS (h1-h4) unwraps on the
// way to storage. Constraining the schema keeps editor, toolbar and allow-list
// saying the same thing rather than relying on the unwrap to be lossless.
// ★ Exported so a test can drive a REAL editor through the same schema this
// component mounts. The toolbar's pressed states and heading value are
// derivations over live ProseMirror state, and a stubbed `isActive` returning a
// frozen record pins the derivation while being structurally unable to see that
// the derivation is never re-run — which is exactly the defect that shipped.
// ★ Named so the mount can reconfigure THIS entry by identity without
// restructuring EXTENSIONS (see the a11y.checkboxLabel wiring below).
export const TASK_ITEM = TaskItem.extend({
  renderHTML({ HTMLAttributes, node }) {
    return [
      "li",
      { ...HTMLAttributes, "data-type": "taskItem", "data-checked": String(node.attrs.checked === true) },
      0,
    ];
  },
});

export const EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
  Highlight,
  Subscript,
  Superscript,
  // ★★★ REWIRED TO `data-align`, NOT the stock `style="text-align:…"`.
  // The storage boundary admits an attribute VALUE only from a fixed set
  // (sanitize-html.ts ATTR_VALUES). `style` survives DOMPurify — it is in
  // DEFAULT_URI_SAFE_ATTRIBUTES, so ALLOWED_URI_REGEXP never tests it — but
  // nothing parses a CSS value, so admitting `style` would let AI-writable
  // fields carry `position:fixed;inset:0;z-index:99999`. A 4-member string set
  // is a guard that cannot be widened a declaration at a time. §140.
  // ★ Only parseHTML/renderHTML change; the alignments filter, the commands
  // (setTextAlign / unsetTextAlign / toggleTextAlign) and the Mod-Shift-l/e/r/j
  // shortcuts are the stock extension's and are used as-is.
  // ★ `types` MUST be set — the extension's own default is [], i.e. inert.
  TextAlign.extend({
    addGlobalAttributes() {
      return [
        {
          types: this.options.types,
          attributes: {
            textAlign: {
              default: this.options.defaultAlignment,
              parseHTML: (element: HTMLElement) => {
                const alignment = element.getAttribute("data-align") ?? "";
                return this.options.alignments.includes(alignment)
                  ? alignment
                  : this.options.defaultAlignment;
              },
              renderHTML: (attributes: { textAlign?: string | null }) =>
                attributes.textAlign ? { "data-align": attributes.textAlign } : {},
            },
          },
        },
      ];
    },
  }).configure({ types: ["heading", "paragraph"] }),
  TaskList,
  // ★★★ renderHTML IS OVERRIDDEN AND THE NODEVIEW IS NOT. Read this before
  // "simplifying" it back to the stock extension.
  // The stock renderHTML emits
  //   <li data-type="taskItem" data-checked="…">
  //     <label><input type="checkbox"><span></span></label><div>…</div>
  //   </li>
  // — four tags (label/input/span/div) and two attrs (type/checked) beyond
  // RICH_ALLOWED_TAGS, on a list that SPREADS into DOCUMENT_ALLOWED_TAGS. And an
  // <input type=checkbox> whose only sibling is an empty <span> has no
  // accessible name, i.e. an axe-critical failure in Documents (an A11Y_VIEWS
  // member).
  // ★★ Overriding renderHTML costs NOTHING in editor UX, which is the whole
  // reason this is cheap: TaskItem also declares addNodeView, and the nodeView
  // owns the EDITING DOM (it builds the checkbox and sets checkbox.ariaLabel).
  // NodeViews are editor-only; getHTML() serializes through renderHTML. So the
  // editor keeps Tiptap's interactive labelled checkbox while storage gets
  // markup that needs zero new tags.
  // ★ The read-only consequence is handled in globals.css (a ::before glyph)
  // and in rich-text-plain.ts's markTaskItems (the "[x] " export prefix) —
  // both later tasks.
  TASK_ITEM,
];

export function RichTextEditor(props: RichTextEditorProps) {
  const { value, onChange, label, lang, mergeFields, fieldLabel } = props;
  // useEditor binds onUpdate/handleKeyDown once at mount; route the live
  // callbacks + Enter-behaviour through refs so an inline caller isn't captured
  // stale and the editor isn't torn down and rebuilt on every render.
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(props.onCommit);
  const commitOnEnterRef = useRef(props.commitOnEnter);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onCommitRef.current = props.onCommit; }, [props.onCommit]);
  useEffect(() => { commitOnEnterRef.current = props.commitOnEnter; }, [props.commitOnEnter]);

  // ★★★ POSITION, NOT FOCUS. `appendText` used to let `opts.focus` decide BOTH
  //   where the text goes and whether to focus, which made the insert position a
  //   function of whether Tiptap's chunk had loaded — see the handle below and
  //   docs/open-followups.md §192. This ref carries the only question that should
  //   decide position: has the user ever been in this editor?
  // ★★ It lives HERE, in the editor that remounts per editing session, not in the
  //   lazy wrapper. A fresh mount has never been focused, which is exactly the
  //   state a queued replay arrives in — so both routes agree on "end of document"
  //   without the wrapper having to know anything about it.
  const everFocused = useRef(false);

  // ★★ Tiptap's TaskItem nodeView hardcodes an ENGLISH accessible name for its
  // checkbox (`Task item checkbox for …`, extension-list task-item/index.js).
  // The extension exposes an `a11y.checkboxLabel` option for exactly this, so
  // the label is localized HERE — the only place `lang` is in scope. EXTENSIONS
  // stays a module-level const (tests and the schema import it); only the
  // taskItem entry is reconfigured, matched by identity.
  // ★★★ The label interpolates the item's OWN text. Several checkboxes in one
  // editor would otherwise share one accessible name — a WCAG 2.4.6 failure the
  // axe gate cannot see at ANY seed size (AGENTS.md), so a flat "Task item
  // checkbox" would be a REGRESSION on Tiptap's default, which is at least
  // row-unique. A BLANK item gets its own `commTplTaskCheckboxEmpty` wording
  // rather than a bare trailing dash — Tiptap's default does the same, and
  // dropping it would make the localized label worse than the English one.
  // ★★ `.configure()` returns a NEW instance and must not mutate the shared
  // TASK_ITEM: several editors mount at once (change-edit-modal has three), so
  // a mutating configure would leak one field's language into its siblings.
  // Pinned by a test that mounts an en-US and a de editor together.
  // ★ useEditor binds its options at mount, so a lang change relabels on the
  // next mount, not immediately. Acceptable: switching language re-renders the
  // shell, and the memo only exists to keep the array identity stable.
  const extensions = useMemo(
    () =>
      EXTENSIONS.map((ext) =>
        ext === TASK_ITEM
          ? TASK_ITEM.configure({
              a11y: {
                checkboxLabel: (node) =>
                  t(
                    lang,
                    "commTplTaskCheckbox",
                    node.textContent || t(lang, "commTplTaskCheckboxEmpty"),
                  ),
              },
            })
          : ext,
      ),
    [lang],
  );

  const editor = useEditor({
    extensions,
    content: value,
    immediatelyRender: false,
    // @tiptap/core injects its ProseMirror base stylesheet with
    // document.createElement("style"); prod CSP is style-src-elem 'self'
    // 'nonce-...' (src/proxy.ts), so without this the tag is refused and every
    // rich-text surface renders unstyled in a production build — invisible in
    // dev, whose CSP is the permissive branch. open-followups.md §54.
    // This is the app's ONLY useEditor call, and createStyleTag dedupes on
    // style[data-tiptap-style], so one un-nonced mount anywhere would poison
    // every later one. Keep it that way.
    injectNonce: readCspNonce(),
    editorProps: {
      attributes: {
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
        // ★ One height for one editor. A caller needing more room passes a
        // class; do not reintroduce a size variant for it.
        class:
          `min-h-24 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green`,
      },
      handleKeyDown: (_view, event) => {
        // commitOnEnter: plain Enter commits (suppress Tiptap's paragraph split);
        // Shift+Enter falls through to Tiptap's default hard-break behaviour.
        // `isComposing` (keyCode 229 fallback) guards an IME candidate confirm —
        // a CJK user pressing Enter to accept a suggestion must not commit early.
        if (
          commitOnEnterRef.current &&
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.isComposing &&
          event.keyCode !== 229
        ) {
          event.preventDefault();
          onCommitRef.current?.();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }: { editor: Editor }) => onChangeRef.current(sanitizeRichHtml(editor.getHTML())),
    // Sets the ref above. Fires for a user click AND for our own chained
    // `.focus()`, which is correct: after we focus, the caret is meaningful, so
    // the NEXT append should go there.
    onFocus: () => {
      everFocused.current = true;
    },
  });

  // insertContent with a TEXT NODE, not a string: a bare string is parsed as
  // HTML, so dictated text containing "<" or "&" would become markup.
  useImperativeHandle(
    props.editorRef,
    () => ({
      appendText(text: string, opts?: { focus?: boolean }) {
        // Empty is "nothing to do", NOT a failure — reporting false would make a
        // buffering caller re-queue it forever.
        if (!text) return true;
        if (!editor) return false;
        // ★★★ POSITION AND FOCUS ARE SEPARATE QUESTIONS, and conflating them was
        // §192. `opts.focus` used to select both, so a dictated line landed at the
        // END when the queue replayed it (`{focus:false}`) and at the START when the
        // live path ran (no `opts`, selection at doc start on an unfocused editor) —
        // and which route ran was decided by whether Tiptap's chunk had arrived when
        // the user pressed the mic. Same note, same call, two results, nothing on
        // screen to say which.
        //   · position <- `everFocused`: the caret if the user has ever been in this
        //     editor, otherwise the end of the last textblock.
        //   · focus    <- `opts.focus`: unchanged meaning.
        // A queued line is BY DEFINITION dictated before the editor existed, so on
        // replay `everFocused` is false and both routes now agree.
        // ★★★ READ THE REF BEFORE BUILDING THE CHAIN — THIS LINE IS LOAD-BEARING,
        // NOT STYLE. An earlier revision of this comment claimed chain commands
        // "do not run until .run()" and concluded the ordering was cosmetic. Both
        // halves are false against @tiptap/core 3.x: createChain runs each
        // command's body AT CALL TIME and defers only view.dispatch, and the focus
        // command calls view.dom.focus() SYNCHRONOUSLY on Safari/iOS/Android
        // (elsewhere it is rAF-deferred). That DOM focus reaches FocusEvents ->
        // emit("focus") -> the onFocus handler above, so a read taken after
        // chain.focus() would see true on those platforms and let this call's own
        // focus decide this call's position. That is §192 again, on three
        // platforms.
        // ★★ NO TEST HERE CAN CATCH THAT, which is why it is written down. jsdom
        // is none of those three user agents, so focus is rAF-only and the two
        // orderings are indistinguishable in this suite. Do not read the tests as
        // covering it, and do not "tidy" this read down into the ternary.
        const atCaret = everFocused.current;
        let chain = editor.chain();
        if (opts?.focus !== false) chain = chain.focus();
        // ★★ RETURN the chain's verdict rather than an unconditional true.
        // `insertContentAt` returns false on a content error (it catches and emits
        // `contentError` instead of throwing). ★ A false command does NOT abort the
        // chain: `run()` dispatches regardless and returns `callbacks.every(cb =>
        // cb === true)`, so "nothing lands" is a claim about THIS chain only, where
        // the only other command is `focus` and nothing else touches the
        // transaction. The wrapper's queue treats this return as "the text landed",
        // so reporting an unconditional true drops it — the exact silent-loss class
        // the queue exists to close.
        return (
          atCaret
            ? chain.insertContent({ type: "text", text })
            : chain.insertContentAt(appendPos(editor.state.doc), { type: "text", text })
        ).run();
      },
    }),
    [editor],
  );

  function addLink() {
    const url = window.prompt(t(lang, "commTplLinkPrompt"), "");
    if (!url) return;
    const trimmed = url.trim();
    if (!isSafeHttpUrl(trimmed)) return;
    editor?.chain().focus().extendMarkRange("link").setLink({ href: trimmed, target: "_blank", rel: "noopener noreferrer" }).run();
  }

  return (
    <div className="flex flex-col gap-2">
      {/* `label` names the toolbar as well as the contenteditable: several
          surfaces mount two or three of these editors as siblings in one form
          (the change modal has three), so without it each form carries three
          buttons called "Bold" and three selects called "Text style".
          ★★ The `editor &&` guard is load-bearing for the toolbar's
          `useEditorState`, not just cosmetic: its selector dereferences the
          live editor unconditionally, so mounting that row while `editor` is
          null throws. `editor` IS null on the hydration render — but
          ★★★ `immediatelyRender: false` IS NOT WHAT MAKES THAT SAFE, and an
          earlier revision of this comment said flipping the flag "makes
          hydration a TypeError". Measured against @tiptap/react 3.27.1: a
          `hydrateRoot` probe renders `editor === null` FIRST in both settings,
          because `useEditor`'s own `getServerSnapshot()` returns null
          unconditionally with no reference to the flag, and `getInitialEditor`
          forces the flag false under SSR anyway. The GUARD is the whole
          protection: hoist the toolbar out of it and `EditorStateManager` seeds
          its snapshot with the null it was handed, so the selector's
          `live.isActive(...)` throws on that render. */}
      {editor &&
        (() => {
          // ★ Built ONCE into a local rather than spelled twice: the duplication
          //  gate compares TOTAL duplicated lines across the repo, so a repeated
          //  JSX element is a needless contribution to a number that gates merges.
          const toolbar = (
            <RichTextToolbar editor={editor} lang={lang} label={label} onAddLink={addLink} />
          );
          return props.toolbarContainer ? createPortal(toolbar, props.toolbarContainer) : toolbar;
        })()}
      {editor && (mergeFields?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {(mergeFields ?? []).map((field) => (
            <Button
              key={field}
              variant="secondary"
              size="xs"
              // A chip must NEVER take focus from the contenteditable it writes
              // into: mousedown would blur the surface, and a commit-on-blur
              // consumer re-renders — or remounts — the editor between mousedown
              // and mouseup, so no `click` is dispatched and the insert is lost.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().insertContent(`{{${field}}}`).run()}
            >
              {fieldLabel ? fieldLabel(field) : field}
            </Button>
          ))}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
