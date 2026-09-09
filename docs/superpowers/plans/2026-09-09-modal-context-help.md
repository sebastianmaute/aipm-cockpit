# Modal context help — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every modal that has a Help entry to point at a question-mark icon in its header that
opens that entry in a popover over the dialog, without switching the view behind it.

**Architecture:** One new optional prop pair on `ModalHeader` (`helpConceptId` + `helpTitle`), passed
through `EditModalShell` so the seven entity edit modals inherit it. The popover renders the entry
body through a component extracted from `help-content-pane.tsx`, so the Help view and the popover
cannot drift. Dismissal reuses `usePopoverDismiss`, which pushes `kind: "layer"` into the shared
dismissal stack, so Escape closes the popover and leaves the modal open.

**Tech Stack:** Next 16 / React / TypeScript, vitest + React Testing Library, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-09-modal-context-help-design.md` (committed `b299c3cc`).
**Branch:** `feat/modal-context-help`, cut off `origin/main` = `6ad4d18b`.

---

## Spec ambiguity resolved here

Spec §3.5 is titled "`MODAL_HELP` — the declarations" but its body says sites pass the id at the call
site. Those are different designs and the difference matters: **anti-vacuity floor 3 (a test that
every declared id resolves to a real entry) is impossible if the ids live scattered at 20 call
sites**, because nothing can enumerate them. This plan therefore builds the **central map**, and call
sites reference it (`MODAL_HELP.raidEdit`). That satisfies the section title, the floor, and the
spec's stated intent that a typo be catchable.

## Two limits that must not be paraphrased away

1. **The `HelpEntryId` union catches a MISTYPED id, never a well-spelled WRONG one.** Pointing the
   budget modal at `concept-resource` typechecks perfectly. Task 8 reviews the mapping as content.
   No step in this plan may describe a green `tsc` as validating the mapping.
2. **The axe gate cannot see two controls sharing an accessible name**, in any view at any seed size.
   The stacked-modal test in Task 6 is the only detector that can exist for the help icon's name.

## Standing constraints (apply to EVERY task)

- `src/app/**.ts(x)` and `src/test/**.ts` are **CRLF — Edit tool only, never `sed -i`**, which
  re-lines the whole file to LF invisibly to `git diff`. `docs/**` is LF-only.
- **Never read a gate's exit code through a pipe.** Redirect, `echo "EXIT=$?"` unpiped, grep the log.
- **Never run two vitest processes at once.**
- **Never** `git add -A` / `git add .`. **Never** stage `sample-workspace-huge.json` or
  `not-in-use.env.local.bak`. Stage the exact paths each task names.
- **Never** `--amend`, `git stash`, `git checkout -- <file>` or `git restore` (the last two are
  deny-blocked).
- Every commit ends with the trailer:
  `Claude-Session: https://[session link removed]`
- `size:check` LIMIT is 1600 counting `split("\n").length` = `wc -l` **plus one**. Measure with
  `node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"`. Starting
  counts: `modal-header.tsx` 130, `edit-modal-chrome.tsx` 276, `help-content.ts` 215,
  `help-body-markup.ts` 56. Ample, but measure, do not assume.
- `Lang` is `"en-US" | "en-GB" | "de"` — **never `"en"`** in a test.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/help-content.ts` | Modify | Drop the widening annotation, add `as const satisfies`, export `HelpEntryId` and `MODAL_HELP` |
| `src/app/help-body-text.tsx` | **Create** | The extracted segment renderer, consumed by both the pane and the popover |
| `src/app/help-content-pane.tsx` | Modify | Consume `HelpBodyText` at its two inline sites |
| `src/app/modal-header.tsx` | Modify | `helpConceptId` / `helpTitle` props, the icon, the popover |
| `src/app/edit-modal-chrome.tsx` | Modify | Pass both props through `EditModalShell` |
| `src/app/i18n.ts` / `i18n.de.ts` | Modify | One interpolated key, EN + DE |
| 20 modal files | Modify | Declare their id |
| `src/app/help-content.test.ts` | **Create** | Floor 3 — every `MODAL_HELP` id resolves |
| `src/app/help-body-text.test.tsx` | **Create** | The extracted renderer's own tests |
| `src/app/modal-header.test.tsx` | Modify | Icon presence/absence, popover, Escape, stacked names, DE |

---

## Task 1: The `HelpEntryId` union

**Files:**
- Modify: `src/app/help-content.ts` (the `export const HELP_ENTRIES` declaration and its closing `];`)

> **Why this is first and gates everything after it.** The shape was probed on a TWO-entry array, not
> the real 66. If the 66-entry case behaves differently, Step 4's fallback is what ships and every
> later task uses `string` instead of `HelpEntryId`. Do not start Task 2 until this task reaches a
> recorded verdict.

- [ ] **Step 1: Read the current declaration**

Run: `grep -n "export const HELP_ENTRIES" src/app/help-content.ts`
Expected: one hit, `export const HELP_ENTRIES: readonly HelpEntry[] = [`

**The explicit type annotation is the whole trap.** An annotated `const` widens `id` back to
`string` even with `as const` on the initialiser, so leaving it produces a `HelpEntryId` of `string`
— a union that compiles, exports, and catches nothing. It must be removed.

- [ ] **Step 2: Replace the declaration head with the Edit tool**

old_string:
```ts
export const HELP_ENTRIES: readonly HelpEntry[] = [
```
new_string:
```ts
export const HELP_ENTRIES = [
```

- [ ] **Step 3: Close it with `as const satisfies` and derive the union**

Find the declaration's closing bracket (`grep -n "^\];" src/app/help-content.ts` — take the FIRST hit
after the declaration line, which was 196 when this plan was written; re-derive it, do not trust the
number).

old_string (the closing bracket plus the blank line that follows it — include enough context that the
match is unique; verify with `grep -c` before editing):
```ts
];
```
new_string:
```ts
] as const satisfies readonly HelpEntry[];

/** Every id in `HELP_ENTRIES`, as a union.
 *
 *  ★ The `as const satisfies` above is what makes this a union rather than
 *  `string`, and an explicit `: readonly HelpEntry[]` annotation on the
 *  declaration would silently widen it back — which compiles, exports, and
 *  catches nothing. Do not reintroduce one.
 *
 *  ★★ IT CATCHES A MISTYPED ID, NEVER A WELL-SPELLED WRONG ONE. Pointing a
 *  modal at an entry that exists but describes something else typechecks
 *  perfectly. `MODAL_HELP` below is reviewed as CONTENT, and a green tsc says
 *  nothing about whether its mapping is right. */
export type HelpEntryId = (typeof HELP_ENTRIES)[number]["id"];
```

★ If `];` is not unique in the file, extend the anchor with the last entry's line above it. Assert
uniqueness BOTH directions before and after: `grep -c "as const satisfies readonly HelpEntry\[\]" src/app/help-content.ts`
must go 0 → 1.

- [ ] **Step 4: Run the typecheck — this is the gate**

```bash
npx tsc --noEmit > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -c "^src/" /tmp/t1.log; grep "^src/" /tmp/t1.log | head -20
```

Expected: `EXIT=0` and `0` src errors.

**If it is NOT clean, read what actually failed before deciding.** Two different outcomes:

*(a) Errors about `readonly` / mutable arrays at CONSUMERS of `HELP_ENTRIES`.* Expected and fixable:
`as const` deep-freezes the literal, so a consumer typed for a mutable array now objects. Fix the
consumer's type to `readonly`, not the declaration. Re-run Step 4.

*(b) Errors on the declaration itself — the `satisfies` does not hold over 66 entries.* Then the
union is not available. **Take the fallback below, and record in the commit message that Task 1 fell
back**, because Tasks 5-7 then type `helpConceptId` as `string` and Task 2's runtime test becomes the
ONLY id guard in the slice.

**The fallback, in full.** Revert Steps 2-3 by anchored inverse Edit (swap old/new strings, assert
`grep -c "as const satisfies readonly HelpEntry\[\]" src/app/help-content.ts` goes 1 → 0 and the
original annotation returns), keep `HelpEntryId` as a plain alias, and rely on Task 2's test:

```ts
/** ★ FALLBACK SHAPE — `as const satisfies` did not hold over the real entry
 *  set, so this is an alias, NOT a union, and a mistyped id is invisible to
 *  tsc. `help-content.test.ts`'s "every MODAL_HELP id resolves" is the only
 *  detector; do not delete it. */
export type HelpEntryId = string;
```

- [ ] **Step 5: Prove the union actually narrows (skip if you took the fallback)**

Append this to `src/app/help-content.ts` TEMPORARILY, run tsc, then remove it:

```ts
const __probeGood: HelpEntryId = "concept-raid";
// @ts-expect-error a mistyped id must not compile
const __probeBad: HelpEntryId = "concept-raidz";
export const __probe = [__probeGood, __probeBad];
```

Run: `npx tsc --noEmit > /tmp/t1b.log 2>&1; echo "EXIT=$?"; grep -c "^src/" /tmp/t1b.log`
Expected: `EXIT=0`, `0` src errors.

★ **`EXIT=0` here is the whole assertion, and it is two claims at once:** the good id compiles, AND
the `@ts-expect-error` was CONSUMED. If the union had silently widened to `string`, the bad id would
compile too, the directive would be unused, and tsc would report **TS2578 "Unused '@ts-expect-error'
directive"** — a red run. A green run cannot happen unless the union really rejects the typo.

Now remove the three probe lines by anchored inverse Edit and re-run tsc, expecting `EXIT=0` / 0
errors. Confirm removal: `grep -c "__probeGood" src/app/help-content.ts` → `0`.

- [ ] **Step 6: Confirm the file is still CRLF and under the ratchet**

```bash
git ls-files --eol src/app/help-content.ts
node -e "console.log(require('fs').readFileSync('src/app/help-content.ts','utf8').split('\n').length)"
```
Expected: `i/lf w/crlf` (NOT `i/lf w/lf` — that means something re-lined it), and a count well under 1600.

- [ ] **Step 7: Commit**

```bash
git add src/app/help-content.ts
git commit -F- <<'EOF'
feat(help): derive HelpEntryId from HELP_ENTRIES so a mistyped id fails tsc

HelpEntry.id was `string` and HelpContentPane resolves it with a .find()
returning null on a miss, so a typo was silent at build time AND at runtime.
Dropping the widening `: readonly HelpEntry[]` annotation and closing the
literal with `as const satisfies` derives a real union.

Proved by probe, not assumed: a `@ts-expect-error` on a mistyped id was
CONSUMED (no TS2578), which is only possible if the union rejects it.

The union catches a MISTYPED id, never a well-spelled WRONG one -- the mapping
table is reviewed as content, and a green typecheck says nothing about it.

Claude-Session: https://[session link removed]
EOF
git status --porcelain
```

---

## Task 2: `MODAL_HELP` and the id-resolution test (anti-vacuity floor 3)

**Files:**
- Modify: `src/app/help-content.ts`
- Create: `src/app/help-content.test.ts`

> This test is the one guard that survives Task 1 having fallen back. Write it even if the union works.

- [ ] **Step 1: Write the failing test**

Create `src/app/help-content.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HELP_ENTRIES, MODAL_HELP } from "./help-content";

describe("MODAL_HELP", () => {
  it("maps every declared modal to an id that exists in HELP_ENTRIES", () => {
    const known = new Set(HELP_ENTRIES.map((e) => e.id));
    const entries = Object.entries(MODAL_HELP);

    // ★ ANTI-VACUITY: an empty or truncated map would satisfy the loop below
    // trivially. This floor is the positive observable -- it fails if the map
    // is emptied, and it is the reason a "0 unresolvable" result means
    // anything at all.
    expect(entries.length).toBe(20);

    const unresolvable = entries.filter(([, id]) => !known.has(id));
    expect(unresolvable).toEqual([]);
  });

  it("resolves each declared id to exactly one entry", () => {
    for (const id of Object.values(MODAL_HELP)) {
      expect(HELP_ENTRIES.filter((e) => e.id === id)).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/help-content.test.ts > /tmp/t2a.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Error" /tmp/t2a.log
```
Expected: FAIL — `MODAL_HELP` is not exported from `./help-content` yet.

- [ ] **Step 3: Add the map**

Append to `src/app/help-content.ts`, after the `HelpEntryId` export:

```ts
/** Which Help entry each modal's header help icon opens.
 *
 *  ★ A modal absent from this map renders NO icon — that is how confirmations
 *  and gates (confirm-dialog, type-to-confirm-dialog, secret-unlock-gate,
 *  project-empty-state) stay clean without an exclusion list.
 *
 *  ★★ THE VALUES ARE A JUDGEMENT CALL, NOT A TYPECHECK RESULT. `HelpEntryId`
 *  rejects a mistyped id; nothing rejects a well-spelled wrong one. Review a
 *  change here by reading the entry, not by running tsc.
 *
 *  ★ `help-content.test.ts` pins that every value resolves AND that the map
 *  still has 20 rows — the count is the anti-vacuity floor, so update it
 *  deliberately when adding a modal, never to make a red run green. */
export const MODAL_HELP = {
  raidEdit: "concept-raid",
  changeEdit: "concept-change",
  milestoneEdit: "concept-milestone",
  stakeholderEdit: "concept-stakeholder",
  resourceEdit: "concept-resource",
  absenceEdit: "feature-resources",
  calendarEvent: "feature-resources",
  taskForm: "feature-tasks",
  taskLinkedTask: "concept-dependency",
  taskTimeTracking: "feature-timelog",
  budgetBucket: "concept-budget",
  documentsHistory: "feature-document-history",
  documentsRename: "feature-documents",
  assetLibrary: "feature-documents",
  assetPreview: "feature-documents",
  jiraConflicts: "feature-jira",
  backendConfig: "feature-storage",
  backendSetupWizard: "feature-setup-wizard",
  tursoProjectPicker: "feature-projects",
  projectEdit: "feature-projects",
} as const satisfies Record<string, HelpEntryId>;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/help-content.test.ts > /tmp/t2b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2b.log
```
Expected: `EXIT=0`, `Test Files 1 passed`, `Tests 2 passed`.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit > /tmp/t2c.log 2>&1; echo "EXIT=$?"; grep -c "^src/" /tmp/t2c.log
```
Expected: `EXIT=0`, `0`.

★ If Task 1 took the fallback, `Record<string, HelpEntryId>` is `Record<string, string>` and this
constrains nothing — which is exactly why Step 1's test exists.

- [ ] **Step 6: Commit**

```bash
git add src/app/help-content.ts src/app/help-content.test.ts
git commit -F- <<'EOF'
feat(help): declare MODAL_HELP and pin that every id resolves

Central map rather than 20 scattered call-site literals, because a scattered
id cannot be enumerated and the "every declared id resolves" floor would be
unwritable. The row count is asserted alongside the resolution check: without
it an emptied map would satisfy the filter trivially.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 3: Extract `HelpBodyText`

**Files:**
- Create: `src/app/help-body-text.tsx`
- Create: `src/app/help-body-text.test.tsx`
- Modify: `src/app/help-content-pane.tsx`

> **The two current call sites are NOT identical and the difference is load-bearing.** Locate them
> with `grep -n "parseHelpBody" src/app/help-content-pane.tsx` (never a line number). The primer
> renders labels as `font-medium`; the body renders them as `font-medium text-foreground`. Both carry
> ★★ comments saying the WEIGHT is the entire visual effect because `--foreground` and
> `--muted-foreground` are the same colour by construction. So the extracted component takes the
> label class as a prop; hardcoding one silently changes the other site.

- [ ] **Step 1: Write the failing test**

Create `src/app/help-body-text.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelpBodyText } from "./help-body-text";

describe("HelpBodyText", () => {
  it("renders a marked label in its own element with the given class", () => {
    const { container } = render(
      <HelpBodyText body="Open [[Settings]] to continue" labelClass="font-medium text-foreground" />,
    );
    const label = container.querySelector("span.font-medium");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("Settings");
    expect(label?.className).toContain("text-foreground");
    // Positive observable: the surrounding prose rendered too, so a component
    // that emitted ONLY the label could not pass.
    expect(container.textContent).toBe("Open Settings to continue");
  });

  it("renders plain text unmarked when no query is passed", () => {
    const { container } = render(<HelpBodyText body="Plain sentence" labelClass="font-medium" />);
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("Plain sentence");
  });

  it("highlights the query when one is passed", () => {
    const { container } = render(
      <HelpBodyText body="Plain sentence" labelClass="font-medium" query="sent" />,
    );
    const mark = container.querySelector("mark");
    expect(mark?.textContent).toBe("sent");
    // The unmatched remainder must survive, or "highlight" degraded to "filter".
    expect(container.textContent).toBe("Plain sentence");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/help-body-text.test.tsx > /tmp/t3a.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Error" /tmp/t3a.log
```
Expected: FAIL — cannot resolve `./help-body-text`.

- [ ] **Step 3: Create the component**

Create `src/app/help-body-text.tsx`:

```tsx
"use client";

import { parseHelpBody } from "./help-body-markup";
import { highlightSegments } from "./help-search";

/** Renders one help body's `[[label]]` segments.
 *
 *  ★ EXTRACTED so the Help view and the modal help popover cannot drift. It is
 *  consumed by `help-content-pane.tsx` (with its live search query) and by
 *  `modal-header.tsx` (with none).
 *
 *  ★★ `labelClass` IS A PROP, NOT A CONSTANT, because the pane's two sites
 *  differ: the primer uses `font-medium`, the body `font-medium text-foreground`.
 *  Hardcoding either one silently restyles the other.
 *
 *  ★★ THE WEIGHT IS THE WHOLE EFFECT. `scheme-tokens.ts` derives
 *  `--muted-foreground` FROM `--foreground`, so they are identical by
 *  construction in every built-in scheme — a "simplification" that keeps the
 *  colour class and drops `font-medium` renders labels invisible. */
export function HelpBodyText({
  body,
  labelClass,
  query = "",
}: {
  body: string;
  labelClass: string;
  /** Omitted by the popover; `highlightSegments` returns one unmatched segment
   *  for an empty query, so no `<mark>` is emitted. */
  query?: string;
}) {
  return (
    <>
      {parseHelpBody(body).map((seg, i) =>
        seg.isLabel ? (
          <span key={i} className={labelClass}>
            <Highlighted text={seg.text} query={query} />
          </span>
        ) : (
          <Highlighted key={i} text={seg.text} query={query} />
        ),
      )}
    </>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightSegments(text, query).map((seg, k) =>
        seg.match ? (
          <mark key={k} className="bg-ui-green/20 text-inherit">
            {seg.text}
          </mark>
        ) : (
          <span key={k}>{seg.text}</span>
        ),
      )}
    </>
  );
}
```

★ Compare this `Highlighted` against the one in `help-content-pane.tsx` before writing it
(`grep -n "function Highlighted" -A 16 src/app/help-content-pane.tsx`) and copy that body verbatim.
If they differ, the pane's rendering changes when it adopts this component, which is a regression
this task is specifically not allowed to introduce.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/help-body-text.test.tsx > /tmp/t3b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3b.log
```
Expected: `EXIT=0`, `Tests 3 passed`.

- [ ] **Step 5: Make the pane consume it**

In `src/app/help-content-pane.tsx`, replace the primer's inline map with:

```tsx
<HelpBodyText body={primerFor(e)} labelClass="font-medium" query={query} />
```

and the body's inline map with:

```tsx
<HelpBodyText body={t(lang, e.bodyKey)} labelClass="font-medium text-foreground" query={query} />
```

Add the import `import { HelpBodyText } from "./help-body-text";`. Delete the pane's now-unused local
`Highlighted` **only if nothing else in the file uses it** — check first:

```bash
grep -c "Highlighted" src/app/help-content-pane.tsx
```

If the count is above the two sites you just replaced plus its declaration, it has other callers;
leave it. `npm run lint` is `--max-warnings=0`, so an unused local is FATAL, not a warning — an
orphaned `Highlighted` fails the build and a still-used one must stay.

- [ ] **Step 6: Run the pane's own suite plus the new one**

```bash
npx vitest run src/app/help-content-pane.test.tsx src/app/help-body-text.test.tsx > /tmp/t3c.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3c.log
```
Expected: `EXIT=0`, `Test Files 2 passed`.

★ Assert `Test Files 2`, not just the test tally — a mistyped path is dropped SILENTLY when mixed
with a real one, and the run still exits 0.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit > /tmp/t3d.log 2>&1; echo "EXIT=$?"; grep -c "^src/" /tmp/t3d.log
npx eslint src; echo "EXIT=$?"
git add src/app/help-body-text.tsx src/app/help-body-text.test.tsx src/app/help-content-pane.tsx
git commit -F- <<'EOF'
refactor(help): extract HelpBodyText so the pane and the popover share one renderer

The segment rendering was inline in help-content-pane.tsx at two sites, coupled
to the search query through a local Highlighted. The modal help popover needs
the same rendering with no query, and a second copy would drift.

labelClass is a prop because the two sites genuinely differ -- the primer uses
font-medium, the body font-medium text-foreground -- and the weight is the whole
visual effect, since --muted-foreground is derived FROM --foreground and the two
are the same colour in every built-in scheme.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 4: The i18n key (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

> **BLOCKING COORDINATION STEP — do this before touching either file.** A peer session
> (`aipm-wt-a-b7`, branch `feat/ai-cost-basis-task-list`) is editing BOTH dictionaries. Two sessions
> writing the same CRLF file is how a whole-file re-line or a lost key happens.

- [ ] **Step 1: Ask the peer before editing**

Send, via SendMessage to `aipm-wt-a-b7`:

> I need to add ONE key to `i18n.ts` and `i18n.de.ts` on branch `feat/modal-context-help`:
> `modalHelpAbout` ("Help – {0}" / "Hilfe – {0}"), inserted next to `modalResetSize`. You said you
> touch both dictionaries. Are you mid-edit on either right now, and is that anchor clear? I will
> wait for your reply before writing.

**Do not proceed until the peer replies.** If it is mid-edit, wait or agree a different anchor.

- [ ] **Step 2: Add the EN key with the Edit tool**

In `src/app/i18n.ts`, anchored on the `modalResetSize` line (verify uniqueness first:
`grep -c "modalResetSize:" src/app/i18n.ts` → `1`):

old_string:
```ts
  modalResetSize: "Reset dialog size",
```
new_string:
```ts
  modalResetSize: "Reset dialog size",
  /** Accessible name for a modal header's help icon. {0} is the modal's own
   *  title, which is what makes two stacked modals' icons distinguishable —
   *  speech input does not scope by aria-modal, and axe has no rule that flags
   *  two controls sharing an accessible name. Same reason `closeLabel` and
   *  `hideVoiceCommand` exist on ModalHeader. */
  modalHelpAbout: "Help – {0}",
```

★ The dash is an EN DASH, U+2013, matching the repo's row-token convention. Not a hyphen, not an em
dash.

- [ ] **Step 3: Add the DE key with a node utf8 write — NOT the Edit tool**

The Edit tool corrupts umlauts and curls double quotes in `i18n.de.ts`, and the file is CRLF so a
`\n` anchor silently no-ops. Run this exact script:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const s = fs.readFileSync(p, "utf8");
const anchor = "  modalResetSize: \"Dialoggröße zurücksetzen\",\r\n";
if (s.split(anchor).length !== 2) { console.error("ANCHOR NOT UNIQUE OR NOT FOUND"); process.exit(1); }
const add = anchor + "  modalHelpAbout: \"Hilfe – {0}\",\r\n";
fs.writeFileSync(p, s.replace(anchor, add), "utf8");
console.log("OK");
'
echo "EXIT=$?"
```

- [ ] **Step 4: Verify the DE bytes and the line endings**

```bash
node -e '
const s = require("fs").readFileSync("src/app/i18n.de.ts", "utf8");
const m = s.match(/modalHelpAbout: "([^"]*)"/);
console.log("value:", JSON.stringify(m && m[1]));
console.log("loneLF:", (s.match(/(?<!\r)\n/g) || []).length, "NUL:", (s.match(/\u0000/g) || []).length);
console.log("curlyDbl:", (s.match(/[“”]/g) || []).length);
'
git ls-files --eol src/app/i18n.de.ts
```

Expected: `value: "Hilfe – {0}"` with a real U+2013, `loneLF: 0`, `NUL: 0`, `curlyDbl: 0`, and
`i/lf w/crlf`. A non-zero `loneLF` means the file was re-lined — stop and repair before committing.

- [ ] **Step 5: Typecheck (this is what enforces EN/DE key parity)**

```bash
npx tsc --noEmit > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -c "^src/" /tmp/t4.log
```
Expected: `EXIT=0`, `0`. A key present in one dictionary and not the other fails here.

- [ ] **Step 6: Run the i18n encoding guard**

```bash
npx vitest run src/app/i18n-encoding.test.ts > /tmp/t4b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4b.log
```
Expected: `EXIT=0`. This test BANS ASCII umlaut substitutions (`fuer`, `druecken`).

- [ ] **Step 7: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F- <<'EOF'
feat(i18n): add modalHelpAbout for the modal header help icon

One interpolated key rather than a per-modal string: the modal's own title
qualifies the name, so two stacked modals cannot collide unless their titles do
-- the same guarantee closeLabel and hideVoiceCommand already buy ModalHeader.

DE written by node utf8 write with \r\n anchors, since the Edit tool corrupts
umlauts and curls quotes in that file.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 5: The icon and popover on `ModalHeader`

**Files:**
- Modify: `src/app/modal-header.tsx`
- Modify: `src/app/modal-header.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/modal-header.test.tsx` (read its existing imports and reuse them; it has 8 tests
today — `grep -c "it(" src/app/modal-header.test.tsx`):

```tsx
describe("ModalHeader help icon", () => {
  it("renders no help icon when no helpConceptId is passed", () => {
    render(<ModalHeader lang="en-US" title="Edit risk" onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /^Help/ })).toBeNull();
    // ★ ANTI-VACUITY: the negative above passes on a header that rendered
    // nothing at all. This asserts the header DID render, so the absence is
    // a real absence.
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("renders a help icon named after the modal when helpConceptId is passed", () => {
    render(
      <ModalHeader
        lang="en-US"
        title="Edit risk"
        onClose={() => {}}
        helpConceptId="concept-raid"
        helpTitle="Edit risk"
      />,
    );
    expect(screen.getByRole("button", { name: "Help – Edit risk" })).toBeInTheDocument();
  });

  it("shows the entry's own body when the icon is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ModalHeader
        lang="en-US"
        title="Edit risk"
        onClose={() => {}}
        helpConceptId="concept-raid"
        helpTitle="Edit risk"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Help – Edit risk" }));
    const entry = HELP_ENTRIES.find((e) => e.id === "concept-raid")!;
    expect(screen.getByText(t("en-US", entry.titleKey))).toBeInTheDocument();
  });

  it("gives two stacked headers distinct help-icon names", () => {
    render(
      <>
        <ModalHeader
          lang="en-US"
          title="Edit risk"
          onClose={() => {}}
          helpConceptId="concept-raid"
          helpTitle="Edit risk"
        />
        <ModalHeader
          lang="en-US"
          title="Edit change"
          onClose={() => {}}
          helpConceptId="concept-change"
          helpTitle="Edit change"
        />
      </>,
    );
    // ★ COLLISION SEED: two headers with genuinely DIFFERENT titles. A
    // single-header fixture satisfies a distinctness check trivially and is
    // vacuous. Both names are asserted individually, so a bare "Help" on
    // either one turns this red.
    expect(screen.getByRole("button", { name: "Help – Edit risk" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Help – Edit change" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Help" })).toBeNull();
  });
});
```

★ Add whatever imports these need (`HELP_ENTRIES`, `t`, `userEvent`) to the file's existing import
block. `lang` must be `"en-US"` — `"en"` is not a valid `Lang`.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/modal-header.test.tsx > /tmp/t5a.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5a.log
```
Expected: FAIL — 4 failing, `helpConceptId` is not a prop yet.

- [ ] **Step 3: Add the props and the control**

In `src/app/modal-header.tsx`:

Add to the imports:
```tsx
import { useRef, useState, type ReactNode } from "react";
import { ArrowsPointingInIcon, QuestionMarkCircleIcon, XMarkIcon } from "./icons";
import { HELP_ENTRIES, type HelpEntryId } from "./help-content";
import { HelpBodyText } from "./help-body-text";
import { usePopoverDismiss } from "./use-popover-dismiss";
```
(replacing the existing `import { type ReactNode } from "react";` and the existing icons import).

Add to `ModalHeaderProps`:
```tsx
  /** When set, render a help icon opening this Help entry in a popover over
   *  the dialog. Absent ⇒ no icon, which is how confirmations and gates stay
   *  clean without an exclusion list.
   *
   *  ★ The popover opens IN PLACE rather than deep-linking the Help view,
   *  because `requestHelpConcept` sets activeTab = "help" and would switch the
   *  view BEHIND the still-open dialog (docs/open-followups.md §424). */
  helpConceptId?: HelpEntryId;
  /** Qualifies the help icon's accessible name. Pass the modal's own title.
   *  ★ SAME REASON AS `closeLabel` ONE PROP UP: two stacked headers otherwise
   *  put two controls named "Help" in one document, speech input does not
   *  scope by aria-modal, and axe has no rule that flags it. */
  helpTitle?: string;
```

Add to the destructured params: `helpConceptId,` and `helpTitle,`.

Inside the component, before the `return`:
```tsx
  const [helpOpen, setHelpOpen] = useState(false);
  const helpWrapRef = useRef<HTMLDivElement | null>(null);
  // ★ SHARED PRIMITIVE, never a hand-rolled Escape/outside-click pair: this
  // pushes kind "layer" into dismissal-stack.ts, so only the topmost layer
  // claims Escape and the popover closes while the MODAL stays open.
  usePopoverDismiss(helpOpen, helpWrapRef, () => setHelpOpen(false));
  const helpEntry = helpConceptId ? HELP_ENTRIES.find((e) => e.id === helpConceptId) : undefined;
```

In the right cluster, between `{headerExtra}` and the voice block:
```tsx
        {helpEntry && (
          <div ref={helpWrapRef} className="relative">
            <button
              type="button"
              onClick={() => setHelpOpen((v) => !v)}
              aria-expanded={helpOpen}
              aria-label={t(lang, "modalHelpAbout", helpTitle ?? title)}
              title={t(lang, "modalHelpAbout", helpTitle ?? title)}
              className={`rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:hover:text-ui-light-grey ${INTERACTIVE}`}
            >
              <QuestionMarkCircleIcon aria-hidden="true" className="h-4 w-4" />
            </button>
            {helpOpen && (
              <div
                role="dialog"
                aria-label={t(lang, helpEntry.titleKey)}
                className="absolute right-0 top-full z-20 mt-1 w-80 max-w-[90vw] rounded-md border border-line bg-surface p-3 text-left"
              >
                <p className="mb-1 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
                  {t(lang, helpEntry.titleKey)}
                </p>
                <p className="max-w-[64ch] whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  <HelpBodyText body={t(lang, helpEntry.bodyKey)} labelClass="font-medium text-foreground" />
                </p>
              </div>
            )}
          </div>
        )}
```

★ No `shadow-*` class — the palette gate forbids shadows and gradients, and `box-shadow` via a
Tailwind class passes the CSS sweep while still being forbidden.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/modal-header.test.tsx > /tmp/t5b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5b.log
```
Expected: `EXIT=0`, `Tests 12 passed` (8 existing + 4 new).

- [ ] **Step 5: Add the Escape test**

Append:

```tsx
  it("closes the popover on Escape without closing the modal", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ModalHeader
        lang="en-US"
        title="Edit risk"
        onClose={onClose}
        helpConceptId="concept-raid"
        helpTitle="Edit risk"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Help – Edit risk" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    // The modal's own close must NOT have fired -- that is the whole point of
    // the "layer" kind.
    expect(onClose).not.toHaveBeenCalled();
  });
```

Run it: `npx vitest run src/app/modal-header.test.tsx > /tmp/t5c.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5c.log`
Expected: `EXIT=0`, `Tests 13 passed`.

★ `ModalHeader` alone does not own the modal's Escape — `Modal` does. If this test cannot observe the
distinction in isolation, do NOT weaken it to `expect(true)`. Render it inside the real `Modal`
instead, so the two layers are genuinely stacked, and say so in a comment.

- [ ] **Step 6: DE test**

```tsx
  it("names the help icon in German", async () => {
    await loadI18n("de");
    render(
      <ModalHeader
        lang="de"
        title="Risiko bearbeiten"
        onClose={() => {}}
        helpConceptId="concept-raid"
        helpTitle="Risiko bearbeiten"
      />,
    );
    expect(screen.getByRole("button", { name: "Hilfe – Risiko bearbeiten" })).toBeInTheDocument();
  });
```

★ The DE dictionary is LAZY — without `await loadI18n("de")` this asserts the EN string and passes
for the wrong reason.

- [ ] **Step 7: Gates and commit**

```bash
npx vitest run src/app/modal-header.test.tsx > /tmp/t5d.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5d.log
npx tsc --noEmit > /tmp/t5e.log 2>&1; echo "EXIT=$?"; grep -c "^src/" /tmp/t5e.log
npx eslint src; echo "EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/modal-header.tsx','utf8').split('\n').length)"
git ls-files --eol src/app/modal-header.tsx
git add src/app/modal-header.tsx src/app/modal-header.test.tsx
git commit -F- <<'EOF'
feat(modal): add an optional help icon opening its entry in a popover

One prop pair on ModalHeader reaches all 20 header sites. The popover opens in
place over the dialog rather than deep-linking the Help view, because
requestHelpConcept sets activeTab = "help" and would switch the view behind the
still-open modal (open-followups 424).

Dismissal is the shared usePopoverDismiss, which pushes kind "layer" into
dismissal-stack.ts, so Escape closes the popover and leaves the modal open. No
hand-rolled Escape or outside-click handling.

The accessible name interpolates the modal's own title, so two stacked headers
cannot collide -- the same reason closeLabel and hideVoiceCommand exist. axe has
no rule that flags two controls sharing a name, so the stacked-header unit test
is the only detector that can exist.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 6: `EditModalShell` passthrough

**Files:**
- Modify: `src/app/edit-modal-chrome.tsx`
- Modify: `src/app/edit-modal-chrome.test.tsx` (create if absent)

> This is what carries the seven entity modals. Their `headerExtra` is occupied by
> `ModalFieldControls`, so per-site composition is not available to them.

- [ ] **Step 1: Write the failing test**

```tsx
it("forwards helpConceptId to the modal header", () => {
  render(
    <EditModalShell
      lang="en-US"
      title="Edit risk"
      modalId="raid"
      onClose={() => {}}
      onSubmit={(e) => e.preventDefault()}
      offset={{ x: 0, y: 0 }}
      onDragReset={() => {}}
      sizeKey="raid-edit"
      helpConceptId="concept-raid"
    >
      <div />
    </EditModalShell>,
  );
  expect(screen.getByRole("button", { name: "Help – Edit risk" })).toBeInTheDocument();
});
```

★ Read `EditModalShellProps` first and pass whatever is genuinely required — the prop list above is
taken from the declaration as it stands, but a required prop added since would make this fail for the
wrong reason.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/edit-modal-chrome.test.tsx > /tmp/t6a.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Error" /tmp/t6a.log
```
Expected: FAIL — `helpConceptId` is not a prop of `EditModalShell`.

- [ ] **Step 3: Add the prop and forward it**

Add to `EditModalShellProps`:
```tsx
  /** Forwarded to ModalHeader's help icon. The shell owns the header, so the
   *  seven entity edit modals can only reach it through here — their
   *  `headerExtra` is already occupied by ModalFieldControls. */
  helpConceptId?: HelpEntryId;
```
Add `helpConceptId,` to the destructured params, import `type HelpEntryId` from `./help-content`,
and pass to the `ModalHeader` call:
```tsx
          helpConceptId={helpConceptId}
          helpTitle={title}
```

★ `helpTitle={title}` uses the shell's own title, so no consumer has to pass it twice and none can
forget it.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/edit-modal-chrome.test.tsx > /tmp/t6b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t6b.log
```
Expected: `EXIT=0`.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit > /tmp/t6c.log 2>&1; echo "EXIT=$?"; grep -c "^src/" /tmp/t6c.log
git add src/app/edit-modal-chrome.tsx src/app/edit-modal-chrome.test.tsx
git commit -F- <<'EOF'
feat(modal): forward helpConceptId through EditModalShell

Six of the shell's seven consumers render neither <Modal nor <ModalHeader
directly, so they are unreachable except through here -- and their headerExtra
is occupied by ModalFieldControls, so per-site composition is not an option.
helpTitle is taken from the shell's own title so no consumer can forget it.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 7: Declare the ids at the 20 sites

**Files:** the 20 modal files named in `MODAL_HELP`.

- [ ] **Step 1: Add the prop at each site**

For each row of `MODAL_HELP`, add to that file's `ModalHeader` or `EditModalShell` call:

```tsx
helpConceptId={MODAL_HELP.raidEdit}
```

with `import { MODAL_HELP } from "./help-content";`. For direct `ModalHeader` call sites that are NOT
the shell, also pass `helpTitle={<that modal's title expression>}` — reuse whatever expression the
call already passes as `title`.

The 20 sites, by file: `raid-edit-modal` · `change-edit-modal` · `milestone-edit-modal` ·
`stakeholder-edit-modal` · `resource-edit-modal` · `absence-edit-modal` · `calendar-event-modal`
(these seven via `EditModalShell`) · `task-form-modal` · `task-linked-task-modal` ·
`task-time-tracking-modal` · `budget-bucket-modal` · `documents-history-modal` ·
`documents-rename-modal` · `asset-library-modal` · `asset-preview-modal` · `jira-conflicts-modal` ·
`backend-config-modal` · `backend-setup-wizard` · `turso-project-picker` · `project-edit-modal`.

**Declare nothing** in `confirm-dialog`, `type-to-confirm-dialog`, `secret-unlock-gate`,
`project-empty-state`, `sharepoint-picker-modal`.

- [ ] **Step 2: Verify every declaration landed**

```bash
grep -rn "helpConceptId={MODAL_HELP\." src/app --include=*.tsx | grep -v test | wc -l
```
Expected: `20`.

★ If it is not 20, find which row has no site rather than adjusting the number. A count that
disagrees with `MODAL_HELP`'s 20 rows means either a missed file or a row with no modal.

- [ ] **Step 3: Gates**

```bash
npx tsc --noEmit > /tmp/t7a.log 2>&1; echo "EXIT=$?"; grep -c "^src/" /tmp/t7a.log
npx eslint src; echo "EXIT=$?"
npm run test:run > /tmp/t7b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t7b.log
```
Expected: tsc `EXIT=0` / 0 errors, eslint `EXIT=0`, suite `EXIT=0`.

★ Several of these modals have their own tests that count header buttons or assert on button names.
A new icon can turn those red legitimately. Fix the TEST to expect the icon; never drop the icon to
keep an old assertion green.

- [ ] **Step 4: Verify no file was re-lined**

```bash
git diff --name-only | while read f; do echo "$f $(git ls-files --eol "$f" | awk '{print $2}')"; done
```
Expected: every line ends `w/crlf`. A `w/lf` means something re-lined a source file.

- [ ] **Step 5: Commit**

```bash
git add \
  src/app/raid-edit-modal.tsx src/app/change-edit-modal.tsx src/app/milestone-edit-modal.tsx \
  src/app/stakeholder-edit-modal.tsx src/app/resource-edit-modal.tsx src/app/absence-edit-modal.tsx \
  src/app/calendar-event-modal.tsx src/app/task-form-modal.tsx src/app/task-linked-task-modal.tsx \
  src/app/task-time-tracking-modal.tsx src/app/budget-bucket-modal.tsx \
  src/app/documents-history-modal.tsx src/app/documents-rename-modal.tsx \
  src/app/asset-library-modal.tsx src/app/asset-preview-modal.tsx src/app/jira-conflicts-modal.tsx \
  src/app/backend-config-modal.tsx src/app/backend-setup-wizard.tsx \
  src/app/turso-project-picker.tsx src/app/project-edit-modal.tsx
git status --porcelain   # every line must be "M " on one of the 20 above, nothing else
```

★ If Step 3 required fixing any modal's own test to expect the new icon, add those `*.test.tsx`
paths to the `git add` above **explicitly by name**. Do not reach for `git add -A` to sweep them up.

```bash
git commit -F- <<'EOF'
feat(modal): declare a help entry on the twenty prop-reachable modals

A modal absent from MODAL_HELP renders no icon, so confirmations and gates
(confirm-dialog, type-to-confirm-dialog, secret-unlock-gate,
project-empty-state) stay clean without an exclusion list.
sharepoint-picker-modal declares nothing because no entry describes it.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 8: Review the mapping as content

**Files:** none changed unless the review finds a wrong pairing.

> `tsc` cannot do this. The union rejects a mistyped id and accepts a well-spelled wrong one.

- [ ] **Step 1: Print each pairing with the entry's actual title and body**

★ **`vite-node` takes FILE ARGUMENTS ONLY — there is no `-e`.** Measured: `npx vite-node -e '…'`
prints `No files specified.` **and exits 0**, so an `-e` recipe here would look like a clean review
that never ran. Write a scratch file and run that:

```bash
cat > /tmp/review-mapping.ts <<'TS'
import { MODAL_HELP, HELP_ENTRIES } from "../src/app/help-content";
import { t } from "../src/app/i18n";
for (const [modal, id] of Object.entries(MODAL_HELP)) {
  const e = HELP_ENTRIES.find((x) => x.id === id);
  if (!e) { console.log(modal + " -> " + id + "  *** UNRESOLVABLE ***"); continue; }
  console.log("\n=== " + modal + " -> " + id);
  console.log("TITLE: " + t("en-US", e.titleKey));
  console.log("BODY:  " + t("en-US", e.bodyKey).slice(0, 200));
}
TS
```

Put the file where its relative imports resolve — `scripts/review-mapping.ts` with `../src/app/...`
works; adjust the import paths to wherever you actually put it, and confirm the output has **20
blocks** before reading them. A run printing fewer than 20 did not review the map.

```bash
npx vite-node scripts/review-mapping.ts > /tmp/mapping.log 2>&1; echo "EXIT=$?"; grep -c "^=== " /tmp/mapping.log; cat /tmp/mapping.log
```
Expected: `EXIT=0` and `20`. Delete the scratch file when done: `rm -f scripts/review-mapping.ts`.

- [ ] **Step 2: Read all 20 and judge each one**

For each: *would a user who opened this modal and clicked help find this entry useful?* Flag any
where the entry describes a different surface. Known weak pairings to scrutinise first, because they
were chosen by elimination rather than by a clean match:

- `absenceEdit` and `calendarEvent` both point at `feature-resources`. There is no calendar-specific
  entry. Judge whether that entry actually describes absences and meetings, or merely the Resources
  directory.
- `documentsRename`, `assetLibrary` and `assetPreview` all point at `feature-documents`. Three
  different modals, one entry.
- `tursoProjectPicker` and `projectEdit` both point at `feature-projects`.

- [ ] **Step 3: Record the verdict**

Write the outcome into the Task 9 commit message: either "all 20 pairings reviewed, N changed" or the
specific rows changed and why. If a modal has no good entry, REMOVE its row from `MODAL_HELP`,
update the count in `help-content.test.ts`, and say so — a wrong entry is worse than no icon.

---

## Task 9: Mutation acceptance — the six mutants

**Files:** temporary edits only; the tree must end clean.

> Each mutant: place it, run the suite, record `N failed / M passed` with the SUM equal to that
> file's runtime test count, then revert by anchored inverse Edit asserting uniqueness in BOTH
> directions, ending on an empty `git diff --stat`.
>
> ★ Run ONE vitest at a time. ★ Never read the exit code through a pipe.

First record the baseline so every sum can be checked against it:

```bash
npx vitest run src/app/modal-header.test.tsx src/app/help-content.test.ts src/app/help-body-text.test.tsx > /tmp/m0.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/m0.log
```
Record the per-file test counts. Every mutant's `failed + passed` must equal the count for the file
it targets.

| # | Mutant (the exact edit) | Must turn red | Run this file |
|---|---|---|---|
| 1 | In `raid-edit-modal.tsx`, delete `helpConceptId={MODAL_HELP.raidEdit}` | Task 7's count check; that modal's own test | `src/app/raid-edit-modal.test.tsx` |
| 2 | In `modal-header.tsx`, change `{helpEntry && (` to `{true && (` | "renders no help icon when no helpConceptId is passed" | `src/app/modal-header.test.tsx` |
| 3 | In `modal-header.tsx`, change the popover's `helpEntry.bodyKey` to `helpEntry.titleKey` | "shows the entry's own body" | `src/app/modal-header.test.tsx` |
| 4 | In `use-popover-dismiss.ts`, change `kind: "layer"` to `kind: "modal"` | "closes the popover on Escape without closing the modal" | `src/app/modal-header.test.tsx` |
| 5 | In `modal-header.tsx`, change `t(lang, "modalHelpAbout", helpTitle ?? title)` to `"Help"` | "gives two stacked headers distinct help-icon names" | `src/app/modal-header.test.tsx` |
| 6 | In `i18n.de.ts`, change `modalHelpAbout` to the EN string `"Help – {0}"` | "names the help icon in German" | `src/app/modal-header.test.tsx` |

★ Mutant 1's target test file must be one that actually renders that modal. If
`raid-edit-modal.test.tsx` does not exist, run the count check from Task 7 Step 2 instead and record
its before/after numbers (`20` → `19`) as that mutant's evidence.

★ Mutant 6 edits `i18n.de.ts` — revert it with a **node utf8 write**, never the Edit tool, for the
same umlaut/curly-quote reason Task 4 gives.

- [ ] **Step 1-6: For each mutant in turn**

```bash
# after placing mutant N with the Edit tool:
npx vitest run <the "Run this file" path for mutant N from the table above> > /tmp/mN.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/mN.log
```
Record the `N failed / M passed` line. Then revert by inverse Edit and confirm:

```bash
git diff --stat; echo "EXIT=$?"
```
Expected after each revert: **no output** from `git diff --stat`.

★ Mutant 4 edits a SHARED primitive used by other popovers. Run the full suite after reverting it,
not just the target file, and confirm the tree is clean before continuing:

```bash
npm run test:run > /tmp/m4-after.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/m4-after.log
git status --porcelain
```

★ **A mutant that does NOT turn its assertion red is a finding, not a formality.** It means the
assertion is vacuous. Report it; do not adjust the mutant until it passes.

- [ ] **Step 7: Record the scorecard**

Write all six results into the Task 10 commit message as `mutant N: X failed / Y passed (file total Z)`.

---

## Task 10: Gate chain, §424 update, done

**Files:**
- Modify: `docs/open-followups.md` (§424 Status line only — LF-only file)

- [ ] **Step 1: Full local gate chain**

Run these ONE AT A TIME. Never two vitest processes at once.

```bash
npx tsc --noEmit > /tmp/g1.log 2>&1; echo "EXIT=$?"; grep -c "^src/" /tmp/g1.log
npx eslint src; echo "EXIT=$?"
npm run test:run > /tmp/g2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/g2.log
npm run test:shuffle > /tmp/g3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/g3.log
npm run size:check > /tmp/g4.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/g4.log
npm run docs:symbols:check > /tmp/g5.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/g5.log
npm run followups:index:check > /tmp/g6.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/g6.log
npm run followups:status:check > /tmp/g7.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/g7.log
```

★ `test:shuffle` is the ONLY local reproduction of the blocking `unit-tests-shuffled` job, and this
slice adds tests, so it is not optional.

- [ ] **Step 2: axe on the affected views**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points|RAID|Documents" --workers=1 > /tmp/g8.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed" /tmp/g8.log
```

★ `--workers=1` is mandatory whenever more than one view is matched: local runs default to CPU-count
while CI runs serially, and over-subscription produces `Test timeout of 60000ms exceeded` failures
that name no rule and no impact. **A timeout is NOT a violation** — read the failure body before
recording anything as red.

★ The seeded e2e workspace renders these modals only if something opens them; a green run here does
not prove the help icon was scanned. It proves nothing regressed.

- [ ] **Step 3: Update §424**

Edit the `**Status:**` line of §424 in `docs/open-followups.md` to record what landed and what
remains, keeping the entry **OPEN**. It must state: the 20 prop-reachable sites now carry an icon via
`helpConceptId`; the 14 bespoke `Modal` sites and the two hand-rolled floating windows
(`help-menu`, `notes-window`) are untouched; gap 4 (`HelpMenu` has no deep-link input) is untouched;
and gap 3 is closed by the `HelpEntryId` union **for mistyped ids only**.

★ `docs/**` is LF-only. Verify after editing:
```bash
node -e "const s=require('fs').readFileSync('docs/open-followups.md','utf8');console.log('CRLF',(s.match(/\r\n/g)||[]).length)"
```
Expected: `CRLF 0`.

★ Do NOT renumber the entry and do NOT mint a new follow-up number unless the implementation
surfaced a defect. Numbers 440-449 were the reserved range for the previous slice; re-derive the
register max on `origin/main` before minting anything:
```bash
git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
```

- [ ] **Step 4: Final commit**

```bash
git add docs/open-followups.md
git commit -F- <<'EOF'
docs(followups): record what 424's prop-reachable half landed

Twenty modals now carry a help icon opening their own entry in a popover over
the dialog. Still open: the 14 bespoke Modal sites, the two hand-rolled
floating windows, and gap 4 -- HelpMenu still has no deep-link input.

Gap 3 is closed for MISTYPED ids only. A well-spelled wrong id still
typechecks; MODAL_HELP's pairings were reviewed by eye.

Paste here the six measured mutant lines recorded in Task 9 Step 7, one per
line, in the form "mutant N: X failed / Y passed (file total Z)", followed by
the Task 8 verdict in the form "all 20 pairings reviewed, N changed" or the
specific rows changed and why. These are measurements taken during execution,
not text to invent -- if a mutant was not run, say so rather than omitting it.

Claude-Session: https://[session link removed]
EOF
git status --porcelain
```

- [ ] **Step 5: STOP**

The slice ends here. **No version bump, no CHANGELOG entry, no `version:sync`, no push, no MR, no
merge.** Releasing is a separate explicit instruction from the user.

Report: every gate's exit code, the six mutant scorecards with their sums, the Task 8 mapping
verdict, and whether Task 1 used the union or the fallback.
