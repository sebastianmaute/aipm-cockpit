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

import { useCallback, useId, useRef, useState, Fragment } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type {
  ElementType,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
import { moveToolbarFocus } from "./toolbar-roving";

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

// Roving-tabindex positions, in DOM order: the heading trigger leads, then the
// twelve CONTROLS, then Insert link and Remove link. Derived from
// CONTROLS.length rather than hardcoded, so adding a mark or block cannot
// silently desync the arithmetic from the JSX below.
const HEADING_INDEX = 0;
const CONTROLS_OFFSET = 1;
const LINK_INDEX = CONTROLS.length + 1;
const UNLINK_INDEX = CONTROLS.length + 2;

/** How many focusable controls the row renders WITH THE HEADING MENU CLOSED.
 *  Derived from UNLINK_INDEX so the count and the indices cannot drift apart.
 *  Exported so a test can pin the arithmetic against the real DOM (§144a). */
export const TOOLBAR_CONTROL_COUNT = UNLINK_INDEX + 1;

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
  // ★★★ `toolbar`, and ONLY because the row now honours the contract. The APG
  // toolbar pattern is a KEYBOARD contract — one tab stop for the row, roving
  // tabindex, Left/Right moving focus between controls — and until §144(a) this
  // row implemented none of it, so it correctly declared `group` instead:
  // declaring a role whose interaction the widget does not honour is worse than
  // declaring none, because it tells an AT user to press arrow keys that do
  // nothing. The contract now lives in handleRowKeyDown + the tabIndex wiring
  // below. If either is ever removed, this must go back to `group` in the same
  // commit.
  // ★★ Named or ABSENT, never named generically — see the wrapper's comment.
  const named = label !== undefined && label.trim() !== "";

  // useId, not a literal string: change-edit-modal mounts up to three
  // RichTextEditor siblings, and a hardcoded id would collide across them
  // (duplicate DOM ids — invalid HTML and an aria-controls that points at
  // the wrong panel).
  const headingMenuId = useId();

  // ★★★ `isActive()` IS A DERIVATION OVER LIVE EDITOR STATE, SO IT CANNOT BE
  // READ DURING RENDER WITHOUT SUBSCRIBING TO THAT STATE. `useEditor` does not
  // re-render on a transaction (`shouldRerenderOnTransaction` defaults to
  // FALSE in Tiptap 3) and the editor's only other channel into React is
  // `onUpdate`, which core gates on `docChanged` — so a caret MOVE changes what
  // every call below would return and nothing re-renders. Measured in jsdom
  // against a real editor: caret into an existing bold run left Bold at
  // aria-pressed="false" with ToolbarButton's title still reading "Currently off
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

  // Which control holds the row's single tab stop. The DOM is the source of
  // truth for MOVEMENT (the keydown handler reads document.activeElement); this
  // exists only to decide which button renders tabIndex=0.
  const [activeIndex, setActiveIndex] = useState(0);

  // ★★★ THE TAB STOP FOLLOWS FOCUS, AND IT HAS TO — an earlier revision moved
  // it on KEYDOWN ONLY, justified by "every control passes preventFocusSteal,
  // so a click never focuses a toolbar button". That premise is FALSE: the
  // heading trigger deliberately omits `preventFocusSteal` (opening a popover
  // is not a mark command, so there is no editor selection to protect), and
  // `rich-text-toolbar-button.tsx` documents the omission. Measured
  // consequence: Tab in, ArrowRight twice (tab stop → Italic), then click the
  // heading trigger twice to open and close its menu — focus lands on the
  // trigger while the tab stop is still on Italic, so the next Tab moves focus
  // WITHIN the row instead of leaving it. Two tab stops, i.e. the exact defect
  // §144(a) exists to close, on a mixed mouse/keyboard path.
  // ★ This is also the APG-recommended shape: it covers every route into a
  // control — click, programmatic .focus(), a future control that opts out of
  // preventFocusSteal — rather than only the one the keydown handler knows.
  // ★★ The `=== -1` bail is the same portal guard the keydown handler needs and
  // for the same reason: React focus events bubble the REACT tree, so focusing
  // an item in the portaled heading menu fires this with a target that is not
  // one of the row's own children. Without it the tab stop would chase the menu.
  // ★ Typed at HTMLElement, not HTMLDivElement: React types a FocusEvent's
  // `target` as `EventTarget & <the generic>`, so a HTMLDivElement handler
  // claims the target IS the row and comparing it to a button is a tsc error
  // ("no overlap"). Widening the generic keeps the comparison honest without an
  // assertion. Contravariance still lets this sit on the row's onFocus.
  const syncActiveIndex = useCallback((e: ReactFocusEvent<HTMLElement>) => {
    const buttons = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > button"),
    );
    // Compared by identity rather than cast: React types a FocusEvent's
    // `target` as the ROW element, so `indexOf` would need a double assertion
    // through `unknown` to compile — which would also silence a genuine mistake.
    const focused = buttons.findIndex((button) => button === e.target);
    if (focused === -1) return;
    setActiveIndex(focused);
  }, []);

  const handleRowKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    // `e.currentTarget` is the row this handler is attached to, so the handler
    // is inherently per-row — the three rows change-edit-modal mounts each
    // drive their own, with no ref needed.
    // `:scope >` so only THIS row's own controls count. The heading menu is a
    // PopoverPanel portaled to document.body, so its items are never in here.
    const buttons = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > button"),
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    // ★★★ THE PORTAL GUARD. React synthetic events bubble the REACT tree, not
    // the DOM tree, so a keydown inside the OPEN heading menu — whose panel
    // lives under document.body — can still arrive here. Without this, arrowing
    // inside the menu would silently rove the row underneath it while the menu
    // appeared to ignore the key. Returning BEFORE preventDefault is essential:
    // the menu's own handling must still see the event. It also covers focus
    // sitting anywhere else entirely, e.g. in the editor.
    if (current === -1) return;

    const next = moveToolbarFocus(buttons.length, current, e.key, e);
    if (next === null) return;
    e.preventDefault();
    setActiveIndex(next);
    buttons[next]?.focus();
  }, []);

  function pickLevel(value: string) {
    setLevel(value);
    closeHeadingMenu();
  }

  const TriggerIcon = activeLevel === undefined ? PilcrowIcon : HEADING_ICON[activeLevel];

  return (
    // ★ flex-wrap is required, not cosmetic: fifteen controls render inside four
    // modals with tight vertical space.
    // ★★ The toolbar is named or ABSENT, never named generically. Three sibling
    // toolbars all called "Formatting" disambiguate nothing while making the
    // code look fixed, and an UNNAMED toolbar is worse than none — it adds a
    // boundary announcement carrying no information. So an editor with no label
    // keeps the bare div. Every call site in `src/app` passes a real label
    // today; `RichTextEditor.label` is required, so only a blank string reaches
    // here.
    // ★★ NOTHING GATES THIS. Measured against the installed axe-core 4.12.1:
    // of its 105 rules, 69 carry one of the four tags `e2e/a11y.spec.ts`
    // requests and not one flags two controls sharing an accessible name (the
    // only adjacent rule, identical-links-same-purpose, is links-only and
    // wcag2aaa, which the spec never asks for). The multi-editor test in
    // rich-text-toolbar.test.tsx is the only possible detector — a
    // single-editor fixture passes with the role deleted.
    <div
      className="flex flex-wrap items-center gap-0.5"
      role={named ? "toolbar" : undefined}
      aria-label={named ? label : undefined}
      onKeyDown={handleRowKeyDown}
      onFocus={syncActiveIndex}
    >
      <ToolbarButton
        ref={headingTriggerRef}
        stateKind="disclosure"
        active={headingMenuOpen}
        onClick={() => setHeadingMenuOpen((open) => !open)}
        ariaLabel={t(lang, "commTplHeadingLevel")}
        title={t(lang, "commTplHeadingLevel")}
        ariaControls={headingMenuId}
        tabIndex={activeIndex === HEADING_INDEX ? 0 : -1}
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
        id={headingMenuId}
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
            tabIndex={activeIndex === index + CONTROLS_OFFSET ? 0 : -1}
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
        tabIndex={activeIndex === LINK_INDEX ? 0 : -1}
      >
        <LinkIcon aria-hidden="true" className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        preventFocusSteal
        onClick={() => editor.chain().focus().unsetLink().run()}
        ariaLabel={t(lang, "commTplUnlink")}
        title={t(lang, "commTplUnlink")}
        tabIndex={activeIndex === UNLINK_INDEX ? 0 : -1}
      >
        <UnlinkIcon aria-hidden="true" className={ICON_CLASS} />
      </ToolbarButton>
    </div>
  );
}
