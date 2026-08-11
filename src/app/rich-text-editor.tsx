"use client";
import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
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
const EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
  Highlight,
  Subscript,
  Superscript,
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

  const editor = useEditor({
    extensions: EXTENSIONS,
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
          buttons called "Bold" and three selects called "Text style". */}
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
