# Rich-text toolbar: icon-only controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `RichTextToolbar` (`src/app/rich-text-toolbar.tsx`) from text-labeled controls to an icon-only toolbar (lucide-react, scoped to this component), grouped into six dividered clusters, with the native heading `<select>` replaced by an icon-triggered popover menu.

**Architecture:** No new components beyond what already exists — `ToggleButton`'s existing `ariaLabel`/`title` props absorb the icon-only conversion, and the heading menu reuses `PopoverPanel` + `Button` in the exact composition `GanttViewMenu` already uses (`role="dialog"`, not `role="menu"`, matching this codebase's established refusal to declare ARIA roles whose keyboard contract it doesn't implement).

**Tech Stack:** React 19, Tiptap 3 (`@tiptap/react`), `lucide-react` (new dependency), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-11-rich-text-toolbar-icons-design.md`

---

## File Structure

- **Modify:** `package.json` — add `lucide-react` dependency.
- **Modify:** `src/app/rich-text-toolbar.tsx` — icon-only marks/blocks/link/unlink, grouped dividers, heading menu replacing the native `<select>`.
- **Modify:** `src/app/rich-text-toolbar.test.tsx` — rewrite the combobox-specific tests against the new menu; every other test's accessible-name assertions carry over unchanged (names move from visible text to `aria-label`, the string values themselves don't change).
- **Modify:** `AGENTS.md` — correct the rich-text-toolbar landmine bullet (lines ~951-991), which currently asserts facts this change makes false (2.5.3-by-visible-text, the native-`<select>`-specific mousedown reasoning).

No new files. `rich-text-toolbar.tsx` is ~245 lines today; after this change it will grow (new imports, the menu markup) but should stay well under the 800-line file-size-ratchet — verify with the size-check command in Task 6 rather than assuming.

---

### Task 1: Add the `lucide-react` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

Run: `npm install lucide-react@^1.31.0`

Expected: `package.json` gains a `"lucide-react": "^1.31.0"` entry under `dependencies` (alongside the existing `"@heroicons/react": "^2.2.0"` — both packages coexist; see the spec's Scope section for why), and `package-lock.json` updates.

- [ ] **Step 2: Verify the icon exports this plan relies on actually exist**

Run:
```bash
node -e "const m = require('lucide-react'); const names = ['BoldIcon','ItalicIcon','UnderlineIcon','StrikethroughIcon','CodeIcon','HighlighterIcon','SuperscriptIcon','SubscriptIcon','ListIcon','ListOrderedIcon','QuoteIcon','SquareCodeIcon','LinkIcon','UnlinkIcon','PilcrowIcon','Heading1Icon','Heading2Icon','Heading3Icon','Heading4Icon','ChevronDownIcon']; const missing = names.filter(n => typeof m[n] !== 'function' && typeof m[n] !== 'object'); console.log(missing.length === 0 ? 'ALL PRESENT' : 'MISSING: ' + missing.join(', '));"
```

Expected: `ALL PRESENT` (these were verified against lucide-react 1.31.0 in a scratch install during planning — this step re-verifies against whatever version actually resolved into this repo's lockfile, since a caret range can resolve newer).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add lucide-react for the rich-text toolbar icon set"
```

---

### Task 2: Icon-only mark/block controls, grouped with dividers

**Files:**
- Modify: `src/app/rich-text-toolbar.tsx`
- Test: `src/app/rich-text-toolbar.test.tsx` (existing tests must keep passing — no new test file needed for this task; Task 4 adds the divider-count test alongside the heading-menu rewrite)

- [ ] **Step 1: Run the existing test suite to confirm the starting baseline is green**

Run: `npx vitest run src/app/rich-text-toolbar.test.tsx`
Expected: all tests PASS (this is the pre-change baseline — every subsequent step in Tasks 2-4 should keep the still-relevant tests green, per the spec's "Test impact" section).

- [ ] **Step 2: Replace the imports and `ControlSpec` type**

In `src/app/rich-text-toolbar.tsx`, replace lines 1-30 (from `"use client";` through the `ControlSpec` interface close) with:

```tsx
"use client";

// Shared toolbar for the unified rich-text editor: icon-only controls in six
// dividered clusters, matching the tiptap "Simple" template look
// (https://template.tiptap.dev/preview/templates/simple). lucide-react is a
// new dependency, used ONLY in this file — see the design spec's Scope
// section for why the rest of the app still uses heroicons.
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
import { Button } from "./button";
import { PopoverPanel } from "./popover-panel";
import { t, type Lang, type TranslationKey } from "./i18n";
import { ToggleButton } from "./toggle-button";

/** Shared icon sizing for every control in this toolbar (16px — one step up
 *  from GanttViewMenu's 14px menu-row icons, sized for this toolbar's primary,
 *  always-visible role rather than a secondary menu list). */
const ICON_CLASS = "h-4 w-4 shrink-0";

/** One toggleable control: its label key (doubles as the accessible name AND
 *  the tooltip text, since the control is icon-only), the icon component, the
 *  Tiptap node/mark name `isActive` is asked about, and the command to run.
 *  `name` doubles as the React key. */
/** `accent` mirrors `ToggleButtonProps.accent` — omit for the default
 *  dark-blue family, set `"pink"` for the one control (Highlight) that uses
 *  the app's pink accent, matching the mockup the user approved. */
interface ControlSpec {
  key: TranslationKey;
  icon: ElementType;
  name: string;
  accent?: ToggleAccent;
  run: (editor: Editor) => void;
}
```

Also add `import type { ToggleAccent } from "./toggle-button";` to the import block above (alongside the existing `import { ToggleButton } from "./toggle-button";`).

- [ ] **Step 3: Update `MARKS`, `BLOCKS`, and `CONTROLS` to carry icons and the new group order**

Replace the `MARKS`, `BLOCKS`, and `CONTROLS` declarations (originally lines 32-52) with:

```tsx
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
```

- [ ] **Step 4: Add the divider element and update icon-only rendering for the `CONTROLS` map**

Locate the existing `{CONTROLS.map((spec, index) => ( ... ))}` block (originally around line 215) and replace it with:

```tsx
{CONTROLS.map((spec, index) => (
  <Fragment key={spec.name}>
    {GROUP_DIVIDER_BEFORE.has(index) && <ToolbarDivider />}
    <ToggleButton
      pressed={pressed[index]}
      onToggle={() => spec.run(editor)}
      lang={lang}
      preventFocusSteal
      accent={spec.accent}
      ariaLabel={t(lang, spec.key)}
      title={t(lang, spec.key)}
    >
      <spec.icon aria-hidden="true" className={ICON_CLASS} />
    </ToggleButton>
  </Fragment>
))}
```

Add the `ToolbarDivider` helper above the `RichTextToolbar` function:

```tsx
/** A thin vertical rule between control clusters, matching the tiptap
 *  reference toolbar's grouping. `aria-hidden` — it carries no semantic
 *  meaning, the `role="group"` wrapper (or its absence) is what a screen
 *  reader needs. */
function ToolbarDivider() {
  return <div aria-hidden="true" className="mx-0.5 w-px self-stretch bg-line" />;
}
```

- [ ] **Step 5: Run the mark/block-related tests**

Run: `npx vitest run src/app/rich-text-toolbar.test.tsx -t "mark control|block control|pressed state|NON-COLOUR|bold command|does not steal focus from the editor"`

Expected: PASS. These tests query by accessible name (`getByRole("button", { name: "Bold" })` etc.) — the name is unchanged (still `t(lang, spec.key)`, still resolves to the same string, e.g. "Bold"), only *where* it lives changed (visible text → `aria-label`), so these assertions hold without modification.

- [ ] **Step 6: Commit**

```bash
git add src/app/rich-text-toolbar.tsx
git commit -m "feat: convert rich-text-toolbar mark/block controls to icon-only, grouped"
```

---

### Task 3: Icon-only Link/Unlink controls

**Files:**
- Modify: `src/app/rich-text-toolbar.tsx`

- [ ] **Step 1: Replace the Link/Unlink `Button`s**

Locate the two trailing `<Button variant="secondary" ...>` elements (originally lines 227-242) and replace with:

```tsx
<ToolbarDivider />
<Button
  variant="secondary"
  size="xs"
  onMouseDown={(event) => event.preventDefault()}
  onClick={onAddLink}
  aria-label={t(lang, "commTplLink")}
  title={t(lang, "commTplLink")}
>
  <LinkIcon aria-hidden="true" className={ICON_CLASS} />
</Button>
<Button
  variant="secondary"
  size="xs"
  onMouseDown={(event) => event.preventDefault()}
  onClick={() => editor.chain().focus().unsetLink().run()}
  aria-label={t(lang, "commTplUnlink")}
  title={t(lang, "commTplUnlink")}
>
  <UnlinkIcon aria-hidden="true" className={ICON_CLASS} />
</Button>
```

- [ ] **Step 2: Run the link-related tests**

Run: `npx vitest run src/app/rich-text-toolbar.test.tsx -t "onAddLink|link controls"`

Expected: PASS — `getByRole("button", { name: "Insert link" })` / `{ name: "Remove link" }` resolve via `aria-label` now instead of text content; the string values (`t(lang, "commTplLink")` = "Insert link", `t(lang, "commTplUnlink")` = "Remove link") are unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/app/rich-text-toolbar.tsx
git commit -m "feat: convert rich-text-toolbar link/unlink controls to icon-only"
```

---

### Task 4: Heading menu replacing the native `<select>`

**Files:**
- Modify: `src/app/rich-text-toolbar.tsx`
- Modify: `src/app/rich-text-toolbar.test.tsx`

- [ ] **Step 1: Add the heading-icon map and the combined menu-item list**

Locate the existing `HEADING_LEVELS` / `HeadingLevel` / `HEADING_KEY` / `PARAGRAPH_VALUE` declarations (originally lines 54-65) and add directly beneath them:

```tsx
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
```

- [ ] **Step 2: Add menu open-state and replace the `<Select>` with a trigger + `PopoverPanel`**

Inside the `RichTextToolbar` function body, after the `setLevel` function definition, add:

```tsx
const [headingMenuOpen, setHeadingMenuOpen] = useState(false);
const headingTriggerRef = useRef<HTMLButtonElement>(null);
const closeHeadingMenu = useCallback(() => setHeadingMenuOpen(false), []);

function pickLevel(value: string) {
  setLevel(value);
  closeHeadingMenu();
}

const TriggerIcon = activeLevel === undefined ? PilcrowIcon : HEADING_ICON[activeLevel];
```

Replace the `<Select ...>...</Select>` block (originally lines 201-213) with:

```tsx
<Button
  ref={headingTriggerRef}
  variant="secondary"
  size="xs"
  onClick={() => setHeadingMenuOpen((open) => !open)}
  aria-label={t(lang, "commTplHeadingLevel")}
  aria-expanded={headingMenuOpen}
  title={t(lang, "commTplHeadingLevel")}
  className="inline-flex items-center gap-1"
>
  <TriggerIcon aria-hidden="true" className={ICON_CLASS} />
  <ChevronDownIcon aria-hidden="true" className="h-3 w-3 shrink-0" />
</Button>
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
```

Remove the now-unused `Select` import (from `./form-controls`) if Task 2's Step 2 left it in — it should already be gone from the replaced import block.

- [ ] **Step 3: Delete the obsolete `<select>`-specific comment block**

The long comment above the removed `<Select>` (originally lines 171-200, covering the "no mousedown guard on the select" / arrow-key `change` event reasoning) described a native-`<select>`-specific landmine that no longer exists — a menu of buttons has no arrow-key-fires-change behavior. Delete that comment block; it no longer describes real code. (This exact reasoning also needs to be corrected out of `AGENTS.md` — Task 5.)

- [ ] **Step 4: Rewrite the combobox-specific tests**

In `src/app/rich-text-toolbar.test.tsx`, replace these six tests:
- `"gives the heading select a real accessible name, not a visible span"`
- `"offers Normal plus headings 1-4 and nothing else"`
- `"preselects the heading level the caret sits in"`
- `"re-reads the heading value when the caret MOVES into a heading"`
- `"picking the level the caret is already in does not demote the block"`
- `"applies a level with DOM focus parked outside the editor, and leaves it there"`

with:

```tsx
  it("gives the heading trigger a real accessible name", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    expect(screen.getByRole("button", { name: "Text style" })).toBeTruthy();
  });

  it("opens the heading menu on click, offering Normal text plus headings 1-4 and nothing else", async () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Text style" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const dialog = screen.getByRole("dialog", { name: "Text style" });
    const items = within(dialog)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(items).toEqual(["Normal text", "Heading 1", "Heading 2", "Heading 3", "Heading 4"]);
  });

  // ★ The trigger reflects the DOCUMENT's state, so a caret inside an <h2>
  //   must mark "Heading 2" active — a menu that always showed paragraph as
  //   active would pass every other test here.
  it("marks the heading level the caret sits in as the active menu item", async () => {
    const { editor } = makeEditor({ heading2: true });
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Text style" }));
    const dialog = screen.getByRole("dialog", { name: "Text style" });
    expect(within(dialog).getByRole("button", { name: "Heading 2" }).getAttribute("aria-current")).toBe("true");
    expect(within(dialog).getByRole("button", { name: "Normal text" }).hasAttribute("aria-current")).toBe(false);
  });

  it("runs the heading command and closes the menu when an item is picked", async () => {
    const { editor, run } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Text style" }));
    await userEvent.click(screen.getByRole("button", { name: "Heading 3" }));

    expect(run).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Text style" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog", { name: "Text style" })).toBeNull();
  });

  it("re-reads the active heading item when the caret MOVES into a heading", async () => {
    const editor = realEditor("<p>intro</p><h2>section</h2>");
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    // Position 10 sits inside the <h2> (paragraph is 0-7, heading content 8-15).
    act(() => {
      editor.commands.setTextSelection(10);
    });
    await userEvent.click(screen.getByRole("button", { name: "Text style" }));
    const dialog = screen.getByRole("dialog", { name: "Text style" });
    expect(within(dialog).getByRole("button", { name: "Heading 2" }).getAttribute("aria-current")).toBe("true");
  });

  // ★★★ THE CONTENT-LOSS CASE, carried over from the native-select version.
  //     The menu shows "Heading 2" as ACTIVE; picking it must be a no-op.
  //     `toggleHeading` would demote the block instead — measured
  //     `<p>intro</p><h2>section</h2>` → `<p>intro</p><p>section</p>`.
  it("picking the level the caret is already in does not demote the block", async () => {
    const editor = realEditor("<p>intro</p><h2>section</h2>");
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    act(() => {
      editor.commands.setTextSelection(10);
    });
    const before = editor.getHTML();
    expect(before).toContain("<h2>section</h2>");

    await userEvent.click(screen.getByRole("button", { name: "Text style" }));
    await userEvent.click(screen.getByRole("button", { name: "Heading 2" }));

    expect(editor.getHTML()).toBe(before);
  });

  // ★ `setLevel` never calls `.chain().focus()` (unchanged from the native
  //   select's own no-focus rule — see the deleted comment this replaces in
  //   rich-text-toolbar.tsx), so picking a menu item must not pull DOM focus
  //   into the editor. There is no arrow-key-fires-change landmine for a menu
  //   of buttons (that was `<select>`-specific), so this is a narrower,
  //   simpler regression test than the one it replaces.
  it("does not pull DOM focus into the editor when a heading item is picked", async () => {
    const editor = realEditor("<p>hello</p>");
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    const focusSpy = vi.spyOn(editor.view, "focus");

    await userEvent.click(screen.getByRole("button", { name: "Text style" }));
    await userEvent.click(screen.getByRole("button", { name: "Heading 3" }));

    expect(editor.getHTML()).toContain("<h3>hello</h3>");
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(focusSpy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 5: Add a test for the group dividers**

Add a new test to the same `describe` block:

```tsx
  it("separates the six control groups with five dividers", () => {
    const { editor } = makeEditor();
    const { container } = render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    // Dividers are the only `aria-hidden` DIRECT children of the row besides
    // the check-marker glyphs (which live inside each ToggleButton, not as
    // direct row children) — querying the row's own direct-child divs by
    // class is more robust than counting `[aria-hidden]` broadly.
    const row = container.firstElementChild as HTMLElement;
    const dividers = Array.from(row.children).filter((el) => el.className.includes("bg-line"));
    expect(dividers).toHaveLength(5);
  });
```

- [ ] **Step 6: Run the full toolbar test file**

Run: `npx vitest run src/app/rich-text-toolbar.test.tsx`
Expected: all tests PASS, including the still-unmodified ones from Tasks 2/3.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. This is the step that catches the deliberate `@tiptap/react` import mistake left in Task 2 Step 2 if it wasn't corrected.

- [ ] **Step 8: Commit**

```bash
git add src/app/rich-text-toolbar.tsx src/app/rich-text-toolbar.test.tsx
git commit -m "feat: replace rich-text-toolbar heading select with an icon menu"
```

---

### Task 5: Correct the stale `AGENTS.md` landmine text

**Files:**
- Modify: `AGENTS.md`

The "Rich-text register descriptions" bullet (search for `THE TOOLBAR IS A NAMED` to locate it — do not rely on a line number, per this file's own citation-rot warnings) contains claims this change makes false. `AGENTS.md` is gated by `docs:symbols:check` (every backticked name must resolve in the codebase) and `docs:claims:check` (no new/broken `path:LINE` citations) — neither of these paragraphs cites a line number, so neither gate is at risk here, but every backticked symbol referenced below must still exist.

- [ ] **Step 1: Update the "FIFTEEN controls" paragraph**

Find:
```
  ★★ **THE TOOLBAR IS A NAMED `role="group"`, AND THE NAME IS THE EDITOR'S OWN `label`.**
  `RichTextToolbar` renders FIFTEEN controls whose names repeat verbatim in every editor — eight marks
  (`MARKS`), four blocks (`BLOCKS`), Link, Unlink, and the heading `<select>` — and several surfaces
```

Replace with:
```
  ★★ **THE TOOLBAR IS A NAMED `role="group"`, AND THE NAME IS THE EDITOR'S OWN `label`.**
  `RichTextToolbar` renders FIFTEEN controls whose names repeat verbatim in every editor — eight marks
  (`MARKS`), four blocks (`BLOCKS`), Link, Unlink, and the heading menu trigger (an icon-triggered
  `PopoverPanel`, not a `<select>`, since the icon-only redesign) — and several surfaces
```

- [ ] **Step 2: Replace the WCAG 2.5.3 paragraph**

Find:
```
  ★ WCAG 2.5.3 holds by CONSTRUCTION for the fourteen buttons: each accessible name IS its visible text
  (the toolbar passes no `ariaLabel`, and `ToggleButton` puts state in `title`, the DESCRIPTION). The
  `<select>` sits OUTSIDE 2.5.3 rather than satisfying it — it has an `aria-label` and no visible text
  label, so there is no label to contain. Worth stating because the gate cannot see a 2.5.3 violation
  either (same bullet above).
```

Replace with:
```
  ★ WCAG 2.5.3 does NOT apply to any control in this row — every one is icon-only (`ariaLabel` carries
  the accessible name, `title` mirrors it as a hover tooltip; `ToggleButton` also appends the on/off
  state to `title`, the DESCRIPTION), and 2.5.3 only constrains a control that HAS a visible label. This
  reverses an earlier version of this bullet, which said the opposite: that 2.5.3 held BY CONSTRUCTION
  because the visible text WAS the accessible name. That was true of the pre-icon-only toolbar and of
  the native `<select>` it has since replaced — the select itself already sat OUTSIDE 2.5.3 the same way
  these buttons now do, since it too carried an `aria-label` with no visible text to contain. The one
  place 2.5.3 still applies is the heading menu's ITEMS (`role="dialog"`, not the trigger) — those keep
  visible text ("Heading 2" etc.) as their accessible name, holding by construction the same way the old
  flat toolbar text used to. Worth stating because the gate cannot see a 2.5.3 violation either (same
  bullet above).
```

- [ ] **Step 3: Update the mousedown-guard population comment**

Find:
```
  ★★ OPT-IN IS LOAD-BEARING: 25 other `<ToggleButton` call sites across 14 files rely on native
```

Leave this line as-is (the population count is about OTHER files, unaffected by this change) — but the sentence immediately after it needs a check: re-run the cited grep and confirm the count is still accurate, since this toolbar's own `ToggleButton` call sites are excluded from that count already (`grep -v rich-text-toolbar`) and stay excluded regardless of the icon-only change. No text change expected here; this step is a verification, not an edit.

Run: `grep -rn "<ToggleButton" src/app --include="*.tsx" | grep -v "\.test\." | grep -v rich-text-toolbar | wc -l`
Expected: matches whatever number is currently in the bullet. If it doesn't match, update the number in the same commit (per this file's own "cite the symbol, verify the count" rule) — don't leave a stale count.

- [ ] **Step 4: Replace the native-`<select>`-specific mousedown paragraph**

Find:
```
  ★ The heading `<select>` deliberately gets NO guard: opening the picker IS the native mousedown
  default, so preventing it leaves a select that cannot be opened with a mouse. It relies on the
  commands' `.chain().focus()` restoring the ProseMirror selection instead — REASONED, NOT MEASURED
  (jsdom has no picker, and no browser check has been run).
```

Replace with:
```
  ★ The heading menu TRIGGER also gets no mousedown guard, but for a different reason than the
  `<select>` it replaced: opening a `PopoverPanel` is a normal click, not a native form-control picker,
  so there is no analogous "preventing default breaks the picker" failure mode to guard against. Neither
  the trigger nor the menu items call `.chain().focus()` — `setLevel` never has — since ProseMirror keeps
  its selection in editor state across a blur regardless of where DOM focus sits.
```

- [ ] **Step 5: Verify every backticked symbol in the edited paragraphs still resolves**

Run: `npm run docs:symbols:check`
Expected: PASS. (This also re-scans the untouched parts of `AGENTS.md`, so a failure here could be pre-existing — check the reported symbol against this task's diff before assuming you broke it.)

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md
git commit -m "docs: correct rich-text-toolbar landmine claims after the icon-only redesign"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS, zero errors.

- [ ] **Step 2: Lint at the CI gate's actual strictness**

Run: `npx eslint --max-warnings=0 src/app`
Expected: PASS. (Per `AGENTS.md`'s own warning, plain `npm run lint` does NOT enforce `--max-warnings=0` and will falsely read green — use this exact command.)

- [ ] **Step 3: Run the full unit suite**

Run: `npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log`
Expected: `EXIT=0`, all test files passing. (Redirected and checked unpiped, per `AGENTS.md`'s pipe-exit-code warning.)

- [ ] **Step 4: File-size ratchet**

Run: `npm run size:check`
Expected: PASS. If `rich-text-toolbar.tsx` is flagged, that means the icon/menu additions pushed it over its baseline — the fix is splitting the heading-menu markup into its own file (e.g. `rich-text-heading-menu.tsx`, following the gantt-panel-split precedent `AGENTS.md` documents), not suppressing the gate.

- [ ] **Step 5: Duplication gate**

Run: `npm run dup:check`
Expected: PASS.

- [ ] **Step 6: Eye-verify in the browser**

jsdom cannot see CSS layout, portal positioning, hover tooltips, or the divider rendering with real height — these need a real browser check per `AGENTS.md`'s own repeated pattern for CSS-adjacent changes:

Run: `npm run dev`, open any surface that mounts `RichTextEditor` (e.g. a Task's Description field, or the RAID edit modal's Description/Mitigation fields), and confirm:
- All six groups render with visible dividers between them, matching the approved mockup.
- Every icon has a hover tooltip showing its label + on/off state where applicable.
- The heading menu opens below the trigger, shows the correct active item (bold/accent + `aria-current`), and closes on: clicking an item, clicking outside, and Escape.
- Tab order moves through the row left-to-right, one stop per control (no roving-tabindex surprises — this row still deliberately doesn't implement the `toolbar` keyboard contract).
- In a form mounting multiple editors as siblings (e.g. the Change edit modal, which mounts three), opening one editor's heading menu doesn't visually collide with another's.

This step has no automated pass/fail — record what you saw (or didn't check) rather than silently skipping it, per this repo's own convention of never letting an owed eye-verify pass as done.

- [ ] **Step 7: Final commit (only if Step 6 or the gates above required fixes)**

If every gate in Steps 1-5 was already green after Task 5 and Step 6 found no issues, there is nothing left to commit — the four commits from Tasks 1-5 stand as the complete change. If a fix was needed, commit it with a message describing what the gate or eye-verify caught.
