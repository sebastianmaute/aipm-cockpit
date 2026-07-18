"use client";
import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Editor } from "@tiptap/react";
import { sanitizeTemplateHtml } from "./sanitize-html";
import { isSafeHttpUrl } from "./document-link";
import { Button } from "./button";

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
  mergeFields: readonly string[];
  fieldLabel: (field: string) => string;
  labels: RichTextEditorLabels;
}

const BTN = "rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-muted";
const BTN_ON = "rounded-md border border-line bg-ui-dark-blue px-2 py-1 text-xs text-white";

function ToolbarButton(props: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.active ?? false}
      onClick={props.onClick}
      className={props.active ? BTN_ON : BTN}
    >
      {props.label}
    </button>
  );
}

export function RichTextEditor(props: RichTextEditorProps) {
  const { value, onChange, label, mergeFields, fieldLabel, labels } = props;
  // useEditor binds onUpdate once at mount; route onChange through a ref so a
  // future caller passing an inline callback isn't captured stale.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
        class:
          "min-h-40 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green",
      },
    },
    onUpdate: ({ editor }: { editor: Editor }) => onChangeRef.current(sanitizeTemplateHtml(editor.getHTML())),
  });

  function addLink() {
    const url = window.prompt(labels.linkPrompt, "");
    if (!url) return;
    const trimmed = url.trim();
    if (!isSafeHttpUrl(trimmed)) return;
    editor?.chain().focus().extendMarkRange("link").setLink({ href: trimmed, target: "_blank", rel: "noopener noreferrer" }).run();
  }

  return (
    <div className="flex flex-col gap-2">
      {editor && (
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
            {mergeFields.map((field) => (
              <Button
                key={field}
                variant="secondary"
                size="xs"
                onClick={() => editor.chain().focus().insertContent(`{{${field}}}`).run()}
              >
                {fieldLabel(field)}
              </Button>
            ))}
          </div>
        </>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
