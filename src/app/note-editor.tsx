"use client";
import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Editor } from "@tiptap/react";
import { sanitizeNoteHtml } from "./sanitize-html";
import { isSafeHttpUrl } from "./document-link";
import { t, type Lang } from "./i18n";

export interface NoteEditorProps {
  value: string;
  onChange: (html: string) => void;
  onCommit?: () => void;
  commitOnEnter?: boolean;
  label: string;
  lang: Lang;
  disabled?: boolean;
}

const BTN = "rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-muted";
const BTN_ON = "rounded-md border border-line bg-ui-dark-blue px-2 py-1 text-xs text-white";

function ToolbarButton(props: { label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.active ?? false}
      disabled={props.disabled}
      onClick={props.onClick}
      className={props.active ? BTN_ON : BTN}
    >
      {props.label}
    </button>
  );
}

export function NoteEditor(props: NoteEditorProps) {
  const { value, onChange, onCommit, commitOnEnter, label, lang, disabled } = props;
  // useEditor binds onUpdate/handleKeyDown once at mount; route the live
  // callbacks + Enter-behaviour through refs so an inline caller isn't captured
  // stale and the editor isn't torn down and rebuilt on every render.
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const commitOnEnterRef = useRef(commitOnEnter);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);
  useEffect(() => { commitOnEnterRef.current = commitOnEnter; }, [commitOnEnter]);

  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    immediatelyRender: false,
    editable: !disabled,
    editorProps: {
      attributes: {
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
        class:
          "min-h-24 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green",
      },
      handleKeyDown: (_view, event) => {
        // commitOnEnter: plain Enter commits (suppress Tiptap's paragraph split);
        // Shift+Enter falls through to Tiptap's default hard-break behaviour.
        if (commitOnEnterRef.current && event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onCommitRef.current?.();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }: { editor: Editor }) => onChangeRef.current(sanitizeNoteHtml(editor.getHTML())),
  });

  useEffect(() => {
    if (editor) editor.setEditable(!disabled, false);
  }, [editor, disabled]);

  function addLink() {
    const url = window.prompt(t(lang, "commTplLinkPrompt"), "");
    if (!url) return;
    const trimmed = url.trim();
    if (!isSafeHttpUrl(trimmed)) return;
    editor?.chain().focus().extendMarkRange("link").setLink({ href: trimmed, target: "_blank", rel: "noopener noreferrer" }).run();
  }

  return (
    <div className="flex flex-col gap-2">
      {editor && !disabled && (
        <div className="flex flex-wrap gap-1">
          <ToolbarButton label={t(lang, "commTplBold")} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
          <ToolbarButton label={t(lang, "commTplItalic")} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <ToolbarButton label={t(lang, "commTplBulletList")} active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <ToolbarButton label={t(lang, "commTplNumberedList")} active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
          <ToolbarButton label={t(lang, "commTplLink")} active={editor.isActive("link")} onClick={addLink} />
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
