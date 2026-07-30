"use client";
import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Editor } from "@tiptap/react";
import { sanitizeTemplateHtml, sanitizeNoteHtml } from "./sanitize-html";
import { isSafeHttpUrl } from "./document-link";
import { Button } from "./button";
import { t, type Lang } from "./i18n";

export type RichTextEditorVariant = "full" | "lean";

export interface RichTextEditorHandle {
  /** Insert plain text at the caret. Used by the dictation mic — the editor
   *  binds `content` once at mount, so a new `value` cannot reach it. */
  appendText(text: string): void;
}

export interface RichTextEditorLabels {
  bold: string;
  italic: string;
  underline: string;
  heading1: string;
  heading2: string;
  bulletList: string;
  numberedList: string;
  link: string;
  unlink: string;
  linkPrompt: string;
}

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  label: string;
  /** "full" (default) = full toolbar + merge fields + template sanitizer;
   *  "lean" = Bold/Italic/lists/link only + note sanitizer. */
  variant?: RichTextEditorVariant;
  /** lean: plain Enter commits instead of splitting the paragraph. */
  commitOnEnter?: boolean;
  onCommit?: () => void;
  /** required for the lean variant (drives its i18n toolbar labels + link prompt). */
  lang?: Lang;
  /** full-variant only (omitted by lean callers). */
  mergeFields?: readonly string[];
  fieldLabel?: (field: string) => string;
  labels?: RichTextEditorLabels;
  /** Imperative handle for appending dictated text (React 19 ref-as-prop). */
  editorRef?: Ref<RichTextEditorHandle>;
}

// ★★ The LEAN variant sanitizes with `sanitizeNoteHtml`, whose allow-list has no
// h1-h6 / blockquote / pre / code / s / hr AND which drops a disallowed node's
// TEXT with it (KEEP_CONTENT: false). StarterKit's markdown input rules produce
// exactly those nodes from "# ", "> ", "```", "`x`", "~~x~~" and "--- ", so the
// keystroke left the formatting on screen while the committed value silently lost
// it: a whole block collapsed to "" for the block rules (typing "# Q3 highlights"
// stored nothing at all — no error, no toast, and for the dashboard narrative
// Save stayed disabled because `unchanged` was then true), and the marked WORD
// vanished for the inline ones ("ship `staging` now" -> "ship  now").
// Disabling the extensions removes the input rules at the source, so the markdown
// punctuation now stays literal text. This is deliberately NOT a widening of
// NOTE_ALLOWED_TAGS: that list is security-relevant and widening it would also
// change how already-stored note HTML renders, whereas dropping an input rule
// cannot touch stored data. It also matches the lean toolbar, which offers
// Bold/Italic/lists/link and nothing else — a mark with no visible control should
// not be creatable by an invisible keystroke either.
// The FULL variant is untouched: it has heading toolbar buttons, its sanitizer
// allows h1/h2, and it keeps the text of anything it unwraps (KEEP_CONTENT).
const LEAN_EXTENSIONS = [
  StarterKit.configure({
    heading: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    strike: false,
    horizontalRule: false,
  }),
];
const FULL_EXTENSIONS = [StarterKit];

const BTN = "rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-muted";
const BTN_ON = "rounded-md border border-line bg-ui-dark-blue px-2 py-1 text-xs text-white";

function ToolbarButton(props: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.active ?? false}
      // ★★ A toolbar button must NEVER take focus from the contenteditable it
      // formats. Without this, mousedown blurs the editor surface, and any
      // consumer that commits on blur (the dashboard narrative, notes-window)
      // re-renders — or worse, remounts — the editor BETWEEN mousedown and
      // mouseup, so no `click` is ever dispatched and the format command never
      // runs. Keeping focus in the editor also preserves the selection the
      // command applies to.
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
      className={props.active ? BTN_ON : BTN}
    >
      {props.label}
    </button>
  );
}

export function RichTextEditor(props: RichTextEditorProps) {
  const { value, onChange, label, mergeFields, fieldLabel, labels } = props;
  const variant = props.variant ?? "full";
  const isLean = variant === "lean";
  const lang: Lang = props.lang ?? "en-US";
  // useEditor binds onUpdate/handleKeyDown once at mount; route the live
  // callbacks + Enter-behaviour through refs so an inline caller isn't captured
  // stale and the editor isn't torn down and rebuilt on every render.
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(props.onCommit);
  const commitOnEnterRef = useRef(props.commitOnEnter);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onCommitRef.current = props.onCommit; }, [props.onCommit]);
  useEffect(() => { commitOnEnterRef.current = props.commitOnEnter; }, [props.commitOnEnter]);

  const sanitize = isLean ? sanitizeNoteHtml : sanitizeTemplateHtml;
  const minH = isLean ? "min-h-24" : "min-h-40";

  const editor = useEditor({
    extensions: isLean ? LEAN_EXTENSIONS : FULL_EXTENSIONS,
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
        class:
          `${minH} w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green`,
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
    onUpdate: ({ editor }: { editor: Editor }) => onChangeRef.current(sanitize(editor.getHTML())),
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
    const prompt = isLean ? t(lang, "commTplLinkPrompt") : (labels?.linkPrompt ?? "");
    const url = window.prompt(prompt, "");
    if (!url) return;
    const trimmed = url.trim();
    if (!isSafeHttpUrl(trimmed)) return;
    editor?.chain().focus().extendMarkRange("link").setLink({ href: trimmed, target: "_blank", rel: "noopener noreferrer" }).run();
  }

  return (
    <div className="flex flex-col gap-2">
      {editor && isLean && (
        <div className="flex flex-wrap gap-1">
          <ToolbarButton label={t(lang, "commTplBold")} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
          <ToolbarButton label={t(lang, "commTplItalic")} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <ToolbarButton label={t(lang, "commTplBulletList")} active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <ToolbarButton label={t(lang, "commTplNumberedList")} active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
          <ToolbarButton label={t(lang, "commTplLink")} active={editor.isActive("link")} onClick={addLink} />
        </div>
      )}
      {editor && !isLean && labels && (
        <>
          <div className="flex flex-wrap gap-1">
            <ToolbarButton label={labels.bold} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
            <ToolbarButton label={labels.italic} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
            <ToolbarButton label={labels.underline} active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} />
            <ToolbarButton label={labels.heading1} active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
            <ToolbarButton label={labels.heading2} active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
            <ToolbarButton label={labels.bulletList} active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
            <ToolbarButton label={labels.numberedList} active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
            <ToolbarButton label={labels.link} active={editor.isActive("link")} onClick={addLink} />
            <ToolbarButton label={labels.unlink} onClick={() => editor.chain().focus().unsetLink().run()} />
          </div>
          <div className="flex flex-wrap gap-1">
            {(mergeFields ?? []).map((field) => (
              <Button
                key={field}
                variant="secondary"
                size="xs"
                // Same reason as ToolbarButton: these chips are a SEPARATE
                // element (the shared Button primitive), so they need the same
                // don't-steal-focus treatment or the insert lands after a blur.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().insertContent(`{{${field}}}`).run()}
              >
                {fieldLabel ? fieldLabel(field) : field}
              </Button>
            ))}
          </div>
        </>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
