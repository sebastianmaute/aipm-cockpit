"use client";

// Shared toolbar for the unified rich-text editor: icon-only controls in six
// dividered clusters, matching the tiptap "Simple" template look
// (https://template.tiptap.dev/preview/templates/simple). lucide-react is a
// new dependency, used ONLY in this file — see the design spec's Scope
// section for why the rest of the app still uses heroicons.
//
// ★★★ Every stateful control is the compact ToolbarButton (rich-text-toolbar-
// button.tsx), NEVER a hand-rolled aria-pressed button. The one this replaced
// was among the thirteen offenders in open-followups §55: its ON state rode
// colour alone, which measures 1.03-1.22:1 against the unpressed border in the
// three DARK schemes and so fails WCAG 1.4.1. ToolbarButton carries a
// non-colour data-pressed-marker glyph of its own. axe has no rule for
// colour-as-sole-cue, so the unit test is the only coverage.
//
// ★ Task list and text alignment are deliberately ABSENT. Both need new HTML
// attributes, which is a shared security boundary and gets its own slice plus a
// security review. Do not add a control here without widening the sanitizer first.
//
// ★★ Every control here is now ICON-ONLY: the accessible name lives in
// `ariaLabel` (and mirrored into `title` for a sighted hover tooltip), never in
// visible text. WCAG 2.5.3 (label-in-name) does not apply to any control in this
// file for exactly that reason — 2.5.3 only constrains a control that HAS a
// visible label, and none of these do. The heading menu's ITEMS are the one
// exception: they keep visible text (see the menu section below), so 2.5.3 holds
// there by construction the same way the old flat toolbar text used to.

import { useCallback, useRef, useState, Fragment } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { ElementType } from "react";
import {
  BoldIcon,
  ChevronDownIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  HighlighterIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  QuoteIcon,
  SquareCodeIcon,
  StrikethroughIcon,
  SubscriptIcon,
  SuperscriptIcon,
  UnderlineIcon,
  UnlinkIcon,
} from "lucide-react";
import { PopoverPanel } from "./popover-panel";
import { t, type Lang, type TranslationKey } from "./i18n";
import { ToolbarButton } from "./rich-text-toolbar-button";
import type { ToolbarButtonAccent } from "./rich-text-toolbar-button";

/** Shared icon sizing for every control in this toolbar (14px — the same size
 *  as GanttViewMenu's menu-row icons, sized for this toolbar's compact
 *  borderless buttons). */
const ICON_CLASS = "h-3.5 w-3.5 shrink-0";

/** One toggleable control: its label key (doubles as the accessible name AND
 *  the tooltip text, since the control is icon-only), the icon component, the
 *  Tiptap node/mark name `isActive` is asked about, and the command to run.
 *  `name` doubles as the React key. */
/** `accent` mirrors `ToolbarButtonProps.accent` (`ToolbarButtonAccent`) —
 *  omit for the default dark-blue family, set `"pink"` for the one control
 *  (Highlight) that uses the app's pink accent, matching the mockup the user
 *  approved. */
interface ControlSpec {
  key: TranslationKey;
  icon: ElementType;
  name: string;
  accent?: ToolbarButtonAccent;
  run: (editor: Editor) => void;
}

// Order matches the six-group toolbar layout below: MARKS is groups 2+3
// (six marks, then superscript/subscript), BLOCKS is groups 4+5 (two lists,
// then blockquote/code-block). CONTROLS concatenates them in that same
// order so `pressed[index]` below stays index-aligned with render order.
const MARKS: readonly ControlSpec[] = [
  { key: "commTplBold", icon: BoldIcon, name: "bold", run: (e) => e.chain().focus().toggleBold().run() },
  { key: "commTplItalic", icon: ItalicIcon, name: "italic", run: (e) => e.chain().focus().toggleItalic().run() },
  { key: "commTplUnderline", icon: UnderlineIcon, name: "underline", run: (e) => e.chain().focus().toggleUnderline().run() },
  { key: "commTplStrike", icon: StrikethroughIcon, name: "strike", run: (e) => e.chain().focus().toggleStrike().run() },
  { key: "commTplCode", icon: CodeIcon, name: "code", run: (e) => e.chain().focus().toggleCode().run() },
  { key: "commTplHighlight", icon: HighlighterIcon, name: "highlight", accent: "pink", run: (e) => e.chain().focus().toggleHighlight().run() },
  { key: "commTplSuperscript", icon: SuperscriptIcon, name: "superscript", run: (e) => e.chain().focus().toggleSuperscript().run() },
  { key: "commTplSubscript", icon: SubscriptIcon, name: "subscript", run: (e) => e.chain().focus().toggleSubscript().run() },
];

const BLOCKS: readonly ControlSpec[] = [
  { key: "commTplBulletList", icon: ListIcon, name: "bulletList", run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: "commTplNumberedList", icon: ListOrderedIcon, name: "orderedList", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: "commTplBlockquote", icon: QuoteIcon, name: "blockquote", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { key: "commTplCodeBlock", icon: SquareCodeIcon, name: "codeBlock", run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

/** Every toggle in the row, in render order. The `pressed` array below is
 *  index-aligned with this list, so the two cannot drift. */
const CONTROLS: readonly ControlSpec[] = [...MARKS, ...BLOCKS];

/** Indices (into `CONTROLS`) that get a divider rendered BEFORE them — the
 *  boundary between groups 2/3 (after the 6 marks, index 6), groups 3/4
 *  (after superscript/subscript, index 8), and groups 4/5 (after the two
 *  lists, index 10). The heading-trigger/marks boundary and the
 *  marks-or-blocks/link boundary are unconditional JSX below, not part of
 *  this set. */
const GROUP_DIVIDER_BEFORE = new Set([6, 8, 10]);

const HEADING_LEVELS = [1, 2, 3, 4] as const;
type HeadingLevel = (typeof HEADING_LEVELS)[number];

const HEADING_KEY: Record<HeadingLevel, TranslationKey> = {
  1: "commTplHeading1",
  2: "commTplHeading2",
  3: "commTplHeading3",
  4: "commTplHeading4",
};

/** The menu-item value standing for "not a heading" (a paragraph). */
const PARAGRAPH_VALUE = "0";

const HEADING_ICON: Record<HeadingLevel, ElementType> = {
  1: Heading1Icon,
  2: Heading2Icon,
  3: Heading3Icon,
  4: Heading4Icon,
};

interface HeadingMenuItem {
  /** The value `setLevel` expects — `PARAGRAPH_VALUE` or a level as a string. */
  value: string;
  /** `undefined` for the paragraph entry, matching `activeLevel`'s own shape. */
  level: HeadingLevel | undefined;
  key: TranslationKey;
  icon: ElementType;
}

/** Paragraph plus all four heading levels, in menu order. Computed once at
 *  module scope — every field is static. */
const HEADING_ITEMS: readonly HeadingMenuItem[] = [
  { value: PARAGRAPH_VALUE, level: undefined, key: "commTplParagraph", icon: PilcrowIcon },
  ...HEADING_LEVELS.map((level) => ({
    value: String(level),
    level,
    key: HEADING_KEY[level],
    icon: HEADING_ICON[level],
  })),
];

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

/** A thin vertical rule between control clusters, matching the tiptap
 *  reference toolbar's grouping. `aria-hidden` — it carries no semantic
 *  meaning, the `role="group"` wrapper (or its absence) is what a screen
 *  reader needs. */
function ToolbarDivider() {
  return <div aria-hidden="true" className="w-px self-stretch bg-line" />;
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

  // ★★★ `isActive()` IS A DERIVATION OVER LIVE EDITOR STATE, SO IT CANNOT BE
  // READ DURING RENDER WITHOUT SUBSCRIBING TO THAT STATE. `useEditor` does not
  // re-render on a transaction (`shouldRerenderOnTransaction` defaults to
  // FALSE in Tiptap 3) and the editor's only other channel into React is
  // `onUpdate`, which core gates on `docChanged` — so a caret MOVE changes what
  // every call below would return and nothing re-renders. Measured in jsdom
  // against a real editor: caret into an existing bold run left Bold at
  // aria-pressed="false" with ToggleButton's title still reading "Currently off
  // — click to turn on" (WCAG 4.1.2 — a screen-reader user is told bold is off,
  // presses Bold to turn it on, and turns it off), and caret into an <h2> left
  // the select on "Normal text".
  // ★★ `useEditorState` and NOT `shouldRerenderOnTransaction: true` on the
  // `useEditor` call: it subscribes to the editor's `transaction` event
  // (EditorStateManager.watch) but scopes the re-render to THIS component and
  // to a change in the SELECTED value, whereas the flag re-renders
  // `RichTextEditor` and `EditorContent` on every transaction including every
  // arrow keypress.
  // ★★★ ANY NEW `editor.` READ AT RENDER MUST JOIN THIS SELECTOR — the scoping
  // above is exactly what makes an outsider stale. `useSyncExternalStoreWithSelector`
  // re-renders only when the SELECTED value deep-differs, so a render-time read
  // left outside (an `isActive("link")` disabled state for Unlink, an
  // `editor.can()` gate) is refreshed only in the cases where some ALREADY
  // selected value happened to move, and is stale in every other — with the
  // suite green, since a fixture that moves a selected value hides it. Every
  // other `editor` read in this file today is inside an event handler (setLevel
  // twice, `spec.run(editor)`, Unlink), where it is fresh by construction.
  const { activeLevel, pressed } = useEditorState({
    editor,
    selector: ({ editor: live }) => ({
      activeLevel: HEADING_LEVELS.find((level) => live.isActive("heading", { level })),
      pressed: CONTROLS.map((spec) => live.isActive(spec.name)),
    }),
  });

  // ★★★ `setHeading`, NEVER `toggleHeading`. A <select> says "set this level",
  // not "flip it": picking the level the caret is ALREADY in must be a no-op.
  // With toggle, `<p>intro</p><h2>section</h2>` + caret in the h2 + picking
  // "Heading 2" (which is what the control DISPLAYS) demoted the block —
  // measured output `<p>intro</p><p>section</p>`, i.e. silent content loss from
  // choosing the option already shown. `setParagraph` is already idempotent.
  // ★★★ AND NO `.focus()`. A CLOSED <select> fires `change` on EVERY arrow
  // keypress in Chrome and Firefox, so `.chain().focus()` applied Heading 1 AND
  // pulled DOM focus into the contenteditable on the first ArrowDown — the user
  // could not arrow onward and Headings 2-4 were unreachable by keyboard.
  // ★★ THE HALVES OF THAT ARE VERIFIED DIFFERENTLY. What IS measured here: the
  // command needs no DOM focus (a level applies with focus parked on another
  // element — the test below pins it), and `.chain().focus()` really does reach
  // `view.focus()` (spied, via Tiptap's requestAnimationFrame). What is NOT
  // measured in this repo is the arrow-key `change` firing — that is documented
  // browser behaviour and jsdom has no <select> picker, so nothing in the unit
  // or e2e layer can observe it. Re-check by eye before ever undoing this.
  function setLevel(raw: string) {
    const level = HEADING_LEVELS.find((candidate) => String(candidate) === raw);
    if (level === undefined) editor.chain().setParagraph().run();
    else editor.chain().setHeading({ level }).run();
  }

  const [headingMenuOpen, setHeadingMenuOpen] = useState(false);
  const headingTriggerRef = useRef<HTMLButtonElement>(null);
  const closeHeadingMenu = useCallback(() => setHeadingMenuOpen(false), []);

  function pickLevel(value: string) {
    setLevel(value);
    closeHeadingMenu();
  }

  const TriggerIcon = activeLevel === undefined ? PilcrowIcon : HEADING_ICON[activeLevel];

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
      className="flex flex-wrap items-center gap-0.5"
      role={named ? "group" : undefined}
      aria-label={named ? label : undefined}
    >
      <ToolbarButton
        ref={headingTriggerRef}
        stateKind="disclosure"
        active={headingMenuOpen}
        onClick={() => setHeadingMenuOpen((open) => !open)}
        ariaLabel={t(lang, "commTplHeadingLevel")}
        title={t(lang, "commTplHeadingLevel")}
      >
        <TriggerIcon aria-hidden="true" className={ICON_CLASS} />
        <ChevronDownIcon aria-hidden="true" className="h-2.5 w-2.5 shrink-0" />
      </ToolbarButton>
      <PopoverPanel
        open={headingMenuOpen}
        anchorRef={headingTriggerRef}
        onClose={closeHeadingMenu}
        role="dialog"
        ariaLabel={t(lang, "commTplHeadingLevel")}
        className="w-40 p-1"
      >
        <div className="flex flex-col gap-0.5">
          {HEADING_ITEMS.map((item) => {
            const active = item.level === activeLevel;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => pickLevel(item.value)}
                aria-current={active ? "true" : undefined}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-muted ${
                  active ? "font-semibold text-ui-dark-blue" : "text-foreground"
                }`}
              >
                <item.icon aria-hidden="true" className={ICON_CLASS} />
                {t(lang, item.key)}
              </button>
            );
          })}
        </div>
      </PopoverPanel>
      <ToolbarDivider />

      {CONTROLS.map((spec, index) => (
        <Fragment key={spec.name}>
          {GROUP_DIVIDER_BEFORE.has(index) && <ToolbarDivider />}
          <ToolbarButton
            stateKind="toggle"
            active={pressed[index]}
            onClick={() => spec.run(editor)}
            lang={lang}
            preventFocusSteal
            accent={spec.accent}
            ariaLabel={t(lang, spec.key)}
            title={t(lang, spec.key)}
          >
            <spec.icon aria-hidden="true" className={ICON_CLASS} />
          </ToolbarButton>
        </Fragment>
      ))}

      <ToolbarDivider />
      <ToolbarButton
        preventFocusSteal
        onClick={onAddLink}
        ariaLabel={t(lang, "commTplLink")}
        title={t(lang, "commTplLink")}
      >
        <LinkIcon aria-hidden="true" className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        preventFocusSteal
        onClick={() => editor.chain().focus().unsetLink().run()}
        ariaLabel={t(lang, "commTplUnlink")}
        title={t(lang, "commTplUnlink")}
      >
        <UnlinkIcon aria-hidden="true" className={ICON_CLASS} />
      </ToolbarButton>
    </div>
  );
}
