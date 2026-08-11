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
  /** The field name of the editor this row acts on — `RichTextEditor`'s own
   *  `label`, which it also puts on the contenteditable. Names the group so the
   *  fifteen repeated control names below are told apart by their container.
   *  Absent (or blank) renders NO group at all: see the wrapper. */
  label?: string;
  /** Opens the consumer's link prompt. The toolbar never owns that UI — the
   *  link flow differs per surface (modal vs inline), so it stays with the
   *  editor that mounts this row. */
  onAddLink: () => void;
}

export function RichTextToolbar({ editor, lang, label, onAddLink }: RichTextToolbarProps) {
  // ★★★ `group`, NEVER `toolbar`. The APG toolbar pattern is a KEYBOARD
  // contract — one tab stop for the whole row, roving tabindex, Left/Right
  // Arrow moving focus between controls — and this row implements none of it:
  // every control is its own tab stop. Declaring a role whose interaction the
  // widget does not honour is worse than declaring none, because it tells an AT
  // user to press arrow keys that do nothing. `group` carries no keyboard
  // contract and is exactly WCAG technique ARIA17 (grouping roles to identify
  // related controls). Adding `toolbar` later means implementing roving
  // tabindex first, which changes Tab behaviour in every editor in the app.
  const named = label !== undefined && label.trim() !== "";
  const activeLevel = HEADING_LEVELS.find((level) => editor.isActive("heading", { level }));

  function setLevel(raw: string) {
    const level = HEADING_LEVELS.find((candidate) => String(candidate) === raw);
    if (level === undefined) editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level }).run();
  }

  return (
    // ★ flex-wrap is required, not cosmetic: fifteen controls render inside four
    // modals with tight vertical space.
    // ★★ The group is named or ABSENT, never named generically. Three sibling
    // groups all called "Formatting" disambiguate nothing while making the code
    // look fixed, and an UNNAMED group is worse than none — it adds a boundary
    // announcement carrying no information. So an editor with no label keeps
    // the bare div. Every call site in `src/app` passes a real label today;
    // `RichTextEditor.label` is required, so only a blank string reaches here.
    // ★★ NOTHING GATES THIS. Measured against the installed axe-core 4.12.1:
    // of its 105 rules, 69 carry one of the four tags `e2e/a11y.spec.ts`
    // requests and not one flags two controls sharing an accessible name (the
    // only adjacent rule, identical-links-same-purpose, is links-only and
    // wcag2aaa, which the spec never asks for). The multi-editor test in
    // rich-text-toolbar.test.tsx is the only possible detector — a
    // single-editor fixture passes with the group deleted.
    <div
      className="flex flex-wrap items-center gap-1"
      role={named ? "group" : undefined}
      aria-label={named ? label : undefined}
    >
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
