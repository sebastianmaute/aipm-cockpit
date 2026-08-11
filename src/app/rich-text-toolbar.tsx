"use client";

// Shared toolbar for the unified rich-text editor: the Tiptap "Simple" template
// control set, rendered as one presentational row over a live `Editor`.
//
// ★★★ Every stateful control is the shared ToggleButton, NEVER a hand-rolled
// aria-pressed button. The one this replaced was among the thirteen offenders in
// open-followups §55: its ON state rode colour alone, which measures 1.03-1.22:1
// against the unpressed border in the three DARK schemes and so fails WCAG 1.4.1.
// ToggleButton carries a non-colour data-pressed-marker glyph. axe has no rule
// for colour-as-sole-cue, so the unit test is the only coverage.
//
// ★ Task list and text alignment are deliberately ABSENT. Both need new HTML
// attributes, which is a shared security boundary and gets its own slice plus a
// security review. Do not add a control here without widening the sanitizer first.

import type { Editor } from "@tiptap/react";
// ★★ TYPE-ONLY SIDE-EFFECT IMPORTS, and they are load-bearing. Each of these
// three extensions declares its commands by AUGMENTING `@tiptap/core`'s
// `Commands` interface from inside its own module, so `toggleHighlight` /
// `toggleSuperscript` / `toggleSubscript` do not exist on `ChainedCommands`
// until that module is part of the program. Without these lines this file
// fails `tsc` with three TS2339s while vitest passes (the stub has no types).
// `import type {}` is elided at emit, so nothing is pulled into the bundle —
// the editor that mounts this toolbar owns the real runtime registration.
import type {} from "@tiptap/extension-highlight";
import type {} from "@tiptap/extension-subscript";
import type {} from "@tiptap/extension-superscript";
import { Button } from "./button";
import { Select } from "./form-controls";
import { t, type Lang, type TranslationKey } from "./i18n";
import { ToggleButton } from "./toggle-button";

/** One toggleable control: its label key, the Tiptap node/mark name `isActive`
 *  is asked about, and the command to run. `name` doubles as the React key. */
interface ControlSpec {
  key: TranslationKey;
  name: string;
  run: (editor: Editor) => void;
}

const MARKS: readonly ControlSpec[] = [
  { key: "commTplBold", name: "bold", run: (e) => e.chain().focus().toggleBold().run() },
  { key: "commTplItalic", name: "italic", run: (e) => e.chain().focus().toggleItalic().run() },
  { key: "commTplUnderline", name: "underline", run: (e) => e.chain().focus().toggleUnderline().run() },
  { key: "commTplStrike", name: "strike", run: (e) => e.chain().focus().toggleStrike().run() },
  { key: "commTplCode", name: "code", run: (e) => e.chain().focus().toggleCode().run() },
  { key: "commTplHighlight", name: "highlight", run: (e) => e.chain().focus().toggleHighlight().run() },
  { key: "commTplSuperscript", name: "superscript", run: (e) => e.chain().focus().toggleSuperscript().run() },
  { key: "commTplSubscript", name: "subscript", run: (e) => e.chain().focus().toggleSubscript().run() },
];

const BLOCKS: readonly ControlSpec[] = [
  { key: "commTplBulletList", name: "bulletList", run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: "commTplNumberedList", name: "orderedList", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: "commTplBlockquote", name: "blockquote", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { key: "commTplCodeBlock", name: "codeBlock", run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

const HEADING_LEVELS = [1, 2, 3, 4] as const;
type HeadingLevel = (typeof HEADING_LEVELS)[number];

const HEADING_KEY: Record<HeadingLevel, TranslationKey> = {
  1: "commTplHeading1",
  2: "commTplHeading2",
  3: "commTplHeading3",
  4: "commTplHeading4",
};

/** The `<option>` value standing for "not a heading" (a paragraph). */
const PARAGRAPH_VALUE = "0";

export interface RichTextToolbarProps {
  editor: Editor;
  lang: Lang;
  /** Opens the consumer's link prompt. The toolbar never owns that UI — the
   *  link flow differs per surface (modal vs inline), so it stays with the
   *  editor that mounts this row. */
  onAddLink: () => void;
}

export function RichTextToolbar({ editor, lang, onAddLink }: RichTextToolbarProps) {
  const activeLevel = HEADING_LEVELS.find((level) => editor.isActive("heading", { level }));

  function setLevel(raw: string) {
    const level = HEADING_LEVELS.find((candidate) => String(candidate) === raw);
    if (level === undefined) editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level }).run();
  }

  return (
    // ★ flex-wrap is required, not cosmetic: fifteen controls render inside four
    // modals with tight vertical space.
    <div className="flex flex-wrap items-center gap-1">
      {/* ★★ NO mousedown guard on the select, unlike every button beside it.
          Opening the picker IS the native mousedown default, so preventing it
          leaves a select that cannot be opened with a mouse in Chrome/Firefox —
          a total functional break, traded against a recoverable one: the
          commands below all start `.chain().focus()`, and ProseMirror keeps its
          selection in editor state across a blur, so `.focus()` restores it. */}
      <Select
        size="xs"
        aria-label={t(lang, "commTplHeadingLevel")}
        value={activeLevel === undefined ? PARAGRAPH_VALUE : String(activeLevel)}
        onChange={(event) => setLevel(event.target.value)}
      >
        <option value={PARAGRAPH_VALUE}>{t(lang, "commTplParagraph")}</option>
        {HEADING_LEVELS.map((level) => (
          <option key={level} value={String(level)}>
            {t(lang, HEADING_KEY[level])}
          </option>
        ))}
      </Select>

      {[...BLOCKS, ...MARKS].map((spec) => (
        <ToggleButton
          key={spec.name}
          pressed={editor.isActive(spec.name)}
          onToggle={() => spec.run(editor)}
          lang={lang}
          preventFocusSteal
        >
          {t(lang, spec.key)}
        </ToggleButton>
      ))}

      <Button
        variant="secondary"
        size="xs"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onAddLink}
      >
        {t(lang, "commTplLink")}
      </Button>
      <Button
        variant="secondary"
        size="xs"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.chain().focus().unsetLink().run()}
      >
        {t(lang, "commTplUnlink")}
      </Button>
    </div>
  );
}
