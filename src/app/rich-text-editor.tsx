"use client";
import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { Ref } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
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

export interface RichTextEditorHandle {
  /** Insert plain text at the caret. Used by the dictation mic — the editor
   *  binds `content` once at mount, so a new `value` cannot reach it. */
  appendText(text: string): void;
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
  });

  // insertContent with a TEXT NODE, not a string: a bare string is parsed as
  // HTML, so dictated text containing "<" or "&" would become markup.
  useImperativeHandle(
    props.editorRef,
    () => ({
      appendText(text: string) {
        if (!text) return;
        editor?.chain().focus().insertContent({ type: "text", text }).run();
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
      {editor && <RichTextToolbar editor={editor} lang={lang} label={label} onAddLink={addLink} />}
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
