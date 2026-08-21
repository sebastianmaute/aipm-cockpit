# Help Content Truth Pass + Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify all 51 Help entries against the code they describe, correct the false ones in EN and DE, and land a gate blocking the two rot classes a machine can detect.

**Architecture:** A pure marker parser (`help-body-markup.ts`) turns `[[label]]` spans in help bodies into segments; the Help pane renders label segments styled and feeds the *stripped* body to search. One vitest file gates two properties: nav-view coverage against an explicit self-draining baseline, and resolution of every `[[label]]` against the live i18n dictionaries.

**Tech Stack:** TypeScript, React 19, Next 16, vitest 4.1.8, existing i18n (`i18n.ts` / `i18n.de.ts`).

**Spec:** `docs/superpowers/specs/2026-08-05-help-content-truth-and-gate-design.md`

---

## Hard constraints (read before the first edit)

- **Never read a gate's exit code through a pipe.** `npm run test:run | tail` returns *tail's* status. Redirect, check unpiped, then read the file.
- **Never edit `i18n.de.ts` with the Edit tool.** It corrupts umlauts and curls quotes. Patch via a node UTF-8 write; the file is CRLF, so anchors must use `\r\n`. Verify afterwards at codepoint level.
- **`--reporter=basic` does not exist** in vitest 4.1.8. Use `--reporter=dot`.
- **Run gates serially.** `test:coverage` beside `dup:check` has produced a spurious exit 1 with every test passing.
- **No push, MR, merge, or version bump** is part of this plan. Those need their own explicit go-ahead.
- **`matchAll` is unavailable** — the tsc target is below ES2018 (the `/s` dotAll flag already fails here). Use a `RegExp.exec` loop.

## File Structure

| File | Responsibility |
|---|---|
| `src/app/help-body-markup.ts` (create) | Pure, i18n-free, DOM-free. Parse/strip/extract `[[label]]` markers. No `.tsx` sibling exists — checked, per the `.ts`-shadows-`.tsx` resolution trap. |
| `src/app/help-body-markup.test.ts` (create) | Parser unit tests including malformed input. |
| `src/app/help-content-gate.test.ts` (create) | Both gate halves. Not a new npm script: the unit job is already blocking, so a new CI stage would add no enforcement and would force an AGENTS.md CI-line edit. |
| `src/app/help-content-pane.tsx` (modify) | Render label segments; feed stripped body to `matchesQuery`. |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` (modify) | Corrected bodies + markers. |
| `docs/AGENTS/ui-shell.md` (modify) | Record the marker convention and the gate's real limits. |

---

### Task 1: Marker parser

**Files:**
- Create: `src/app/help-body-markup.ts`
- Test: `src/app/help-body-markup.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { parseHelpBody, stripHelpMarkers, helpBodyLabels } from "./help-body-markup";

describe("parseHelpBody", () => {
  it("splits a marker out of surrounding text", () => {
    expect(parseHelpBody("Click [[Take the tour]] below.")).toEqual([
      { text: "Click ", isLabel: false },
      { text: "Take the tour", isLabel: true },
      { text: " below.", isLabel: false },
    ]);
  });

  it("returns one plain segment when there is no marker", () => {
    expect(parseHelpBody("Nothing here.")).toEqual([{ text: "Nothing here.", isLabel: false }]);
  });

  it("returns one empty segment for an empty body", () => {
    expect(parseHelpBody("")).toEqual([{ text: "", isLabel: false }]);
  });

  // A malformed marker must degrade to literal text. Throwing or returning []
  // would blank a help body in the UI — worse than showing the brackets.
  it("treats an unclosed marker as literal text", () => {
    expect(parseHelpBody("Click [[Take the tour")).toEqual([
      { text: "Click [[Take the tour", isLabel: false },
    ]);
  });

  it("treats an empty marker as literal text", () => {
    expect(parseHelpBody("a [[]] b")).toEqual([{ text: "a [[]] b", isLabel: false }]);
  });

  it("handles two markers in one body", () => {
    expect(parseHelpBody("[[Print]] then [[Reset]]")).toEqual([
      { text: "Print", isLabel: true },
      { text: " then ", isLabel: false },
      { text: "Reset", isLabel: true },
    ]);
  });
});

describe("stripHelpMarkers", () => {
  it("removes the brackets and keeps the label text", () => {
    expect(stripHelpMarkers("Click [[Take the tour]] below.")).toBe("Click Take the tour below.");
  });

  it("is a no-op on unmarked text", () => {
    expect(stripHelpMarkers("Nothing here.")).toBe("Nothing here.");
  });
});

describe("helpBodyLabels", () => {
  it("returns every marked label in order", () => {
    expect(helpBodyLabels("[[Print]] then [[Reset]]")).toEqual(["Print", "Reset"]);
  });

  it("returns an empty list when there are no markers", () => {
    expect(helpBodyLabels("Nothing here.")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/help-body-markup.test.ts --reporter=dot`
Expected: FAIL — `Failed to resolve import "./help-body-markup"`.

- [ ] **Step 3: Write the implementation**

```ts
// Pure, i18n-free, DOM-free parser for the `[[label]]` markers help bodies use
// to name a UI control the reader can see on screen.
//
// ★★ Why markers exist at all: `help-content-gate.test.ts` resolves every
// marked label against the live i18n dictionaries, so a body naming a control
// that was renamed or deleted fails the build. Bare quotes cannot be checked —
// help bodies also quote ordinary phrases, and a checker that could not tell
// the two apart would either miss the real cases or fail correct sentences.
//
// ★ Markers are for UI LABELS ONLY. Ordinary quoted prose stays in quotes.
// When it is unclear whether a quoted string is a label, leave it quoted: a
// false marker turns a true sentence into a build failure.

export interface HelpBodySegment {
  /** Segment text, with the `[[ ]]` delimiters already removed. */
  text: string;
  isLabel: boolean;
}

/** Split a body into label and non-label segments, in source order.
 *
 *  ★ A malformed marker (unclosed, or empty like `[[]]`) degrades to LITERAL
 *  text rather than throwing. A parser that threw here would blank the help
 *  body it was meant to describe. */
export function parseHelpBody(body: string): HelpBodySegment[] {
  // ★ Built per call, not hoisted: a `g`-flagged regex carries `lastIndex`
  // across calls, so a shared instance would skip matches on every second body.
  // ★ `exec` loop, not `matchAll` — the tsc target predates ES2020.
  const re = /\[\[([^[\]]+)\]\]/g;
  const out: HelpBodySegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) out.push({ text: body.slice(last, m.index), isLabel: false });
    out.push({ text: m[1], isLabel: true });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last), isLabel: false });
  return out.length > 0 ? out : [{ text: body, isLabel: false }];
}

/** The body as the user reads it, markers removed. Feed this to SEARCH — the
 *  raw body would let a query match `[[` markup that is never rendered. */
export function stripHelpMarkers(body: string): string {
  return parseHelpBody(body)
    .map((s) => s.text)
    .join("");
}

/** Every marked label in a body. Consumed by the gate. */
export function helpBodyLabels(body: string): string[] {
  return parseHelpBody(body)
    .filter((s) => s.isLabel)
    .map((s) => s.text);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/help-body-markup.test.ts --reporter=dot`
Expected: PASS, 10 tests.

- [ ] **Step 5: Mutation-prove the malformed-input tests**

Change `out.length > 0 ? out : [{ text: body, isLabel: false }]` to just `out`.
Run the same command. Expected: the empty-body test FAILS by name (`returns one empty segment for an empty body`). Restore the line and re-run to green.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
```
Expected: `TSC=0`, `LINT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/app/help-body-markup.ts src/app/help-body-markup.test.ts
git commit -m "feat(help): add the [[label]] marker parser"
```

---

### Task 2: Feed the stripped body to search

**Files:**
- Modify: `src/app/help-content-pane.tsx:49`
- Test: `src/app/help-content-pane.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/help-content-pane.test.tsx`:

```ts
import { stripHelpMarkers } from "./help-body-markup";

describe("search over marked bodies", () => {
  // ★ Searching the RAW body lets a query match `[[` markup the user never
  // sees. Searching the STRIPPED body must still find the label's own words.
  it("strips markers before matching so markup is unsearchable", () => {
    const body = "Click [[Take the tour]] below.";
    expect(stripHelpMarkers(body)).toBe("Click Take the tour below.");
    expect(stripHelpMarkers(body)).not.toContain("[[");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/help-content-pane.test.tsx --reporter=dot`
Expected: FAIL — `Failed to resolve import "./help-body-markup"` is already gone (Task 1 landed), so this passes immediately. **That is expected**: this step's test guards the helper contract. The behavioural guard is Step 3's call-site change, proven by Step 5.

- [ ] **Step 3: Change the call site**

In `src/app/help-content-pane.tsx`, add to the imports:

```ts
import { parseHelpBody, stripHelpMarkers } from "./help-body-markup";
```

Replace line 49:

```ts
      matchesQuery(t(lang, e.titleKey), t(lang, e.bodyKey), query),
```

with:

```ts
      matchesQuery(t(lang, e.titleKey), stripHelpMarkers(t(lang, e.bodyKey)), query),
```

(`parseHelpBody` is imported here for Task 3; if lint runs between the two tasks it will flag the unused import as fatal, so land Tasks 2 and 3 together before running `eslint`.)

- [ ] **Step 4: Run the test file**

Run: `npx vitest run src/app/help-content-pane.test.tsx --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Do not commit yet**

Task 3 completes the pair. Committing here leaves an unused import that fails CI lint.

---

### Task 3: Render label segments

**Files:**
- Modify: `src/app/help-content-pane.tsx:136-138`
- Test: `src/app/help-content-pane.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/help-content-pane.test.tsx`. This asserts a property over the *whole* rendered pane — no marker exists yet, so it passes today and becomes load-bearing the moment Task 9 adds one. Task 9 Step 5 proves it can fail.

```tsx
it("renders a marked label as styled text, never as raw brackets", () => {
  render(<HelpContentPane lang="en-US" query="" />);
  // No help body may ever show bracket markup to a user.
  expect(screen.queryByText(/\[\[/)).toBeNull();
  expect(screen.queryByText(/\]\]/)).toBeNull();
});
```

- [ ] **Step 2: Run to verify it passes trivially today**

Run: `npx vitest run src/app/help-content-pane.test.tsx --reporter=dot`
Expected: PASS — there are no markers yet. This test is a **regression guard for Task 9**, and Step 5 of Task 9 proves it can fail.

- [ ] **Step 3: Change the renderer**

In `src/app/help-content-pane.tsx`, replace lines 136-138:

```tsx
                  <p className="max-w-[64ch] whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    <Highlighted text={t(lang, e.bodyKey)} query={query} />
                  </p>
```

with:

```tsx
                  <p className="max-w-[64ch] whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {/* ★ Segments, not one string: a label renders emphasised
                        against the muted body. `Highlighted` runs PER segment,
                        so a search term spanning a label boundary matches (the
                        search body is stripped) but highlights only within its
                        own segment. Accepted — see the spec. */}
                    {parseHelpBody(t(lang, e.bodyKey)).map((seg, i) =>
                      seg.isLabel ? (
                        <span key={i} className="font-medium text-foreground">
                          <Highlighted text={seg.text} query={query} />
                        </span>
                      ) : (
                        <Highlighted key={i} text={seg.text} query={query} />
                      ),
                    )}
                  </p>
```

`font-medium text-foreground` is deliberate: no new colour token, no shadow, nothing off-palette. The pane is not in `A11Y_VIEWS`, so contrast here is eye-verified — `text-foreground` on the card background is the same pairing the entry titles already use.

- [ ] **Step 4: Run tests, typecheck, lint**

```bash
npx vitest run src/app/help-content-pane.test.tsx src/app/help-view.test.tsx --reporter=dot > /tmp/help.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/help.log
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
```
Expected: `EXIT=0`, `TSC=0`, `LINT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/help-content-pane.tsx src/app/help-content-pane.test.tsx
git commit -m "feat(help): render [[label]] markers styled and keep them out of search"
```

---

### Task 4: Structural coverage ratchet

**Files:**
- Create: `src/app/help-content-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { HELP_ENTRIES } from "./help-content";
import { allNavViews } from "./nav-config";
import type { AppView } from "./nav-config";

// ★★★ THIS GATE PROVES STRUCTURE, NOT TRUTH. It proves an entry EXISTS for a
// view and that a marked label RESOLVES. It cannot tell whether a sentence is
// correct: `helpSecAiBody` claimed the Anthropic key "is stored in this
// browser's localStorage" when it is AES-256-GCM encrypted in IndexedDB, and
// that claim passes every assertion in this file. A green run here is NOT
// evidence that help content is trustworthy — same limit as
// `docs:symbols:check`, which proves a name is real and never that a claim
// about it holds.

/** Nav views with no Help entry pointing at them. Slice 3 writes those entries
 *  and empties this list.
 *
 *  ★★ The assertion below is set EQUALITY, not subset. A new gap fails (the
 *  point of a ratchet) AND a CLOSED gap fails until its id is deleted from
 *  here. Equality is what makes the baseline self-draining; a subset check
 *  would let it outlive the gaps and quietly become a permanent exemption — a
 *  defeated gate that reports success.
 *
 *  ★ Ids, never a count: a count lets one gap be swapped for another. */
const KNOWN_UNCOVERED: readonly AppView[] = [
  "projects",
  "portfolio-health",
  "insights",
  "directory",
  "calendar",
  "manage-roles",
  "stakeholder-map",
  "timelog",
  "reports",
  "raid-report",
  "change-report",
  "activity",
  "history",
  "help",
];

describe("help coverage ratchet", () => {
  it("uncovered nav views match the baseline exactly", () => {
    const covered = new Set<AppView>(HELP_ENTRIES.flatMap((e) => e.relatedViews ?? []));
    // ★ `allNavViews()` flattens nested `children`. A hand-rolled walk over
    // `NAV_GROUPS` items alone sees only half the sidebar — that mistake
    // measured 7 gaps when there are 14, and would have seeded this baseline
    // at half its true size, blessing seven real gaps.
    const uncovered = allNavViews()
      .filter((v) => !covered.has(v))
      .sort();
    expect(uncovered).toEqual([...KNOWN_UNCOVERED].sort());
  });
});
```

- [ ] **Step 2: Run to verify it passes against today's tree**

Run: `npx vitest run src/app/help-content-gate.test.ts --reporter=dot`
Expected: PASS, 1 test. (The baseline was measured from this tree.)

- [ ] **Step 3: Mutation-prove BOTH directions**

The ratchet is worthless if either direction is vacuous.

*New gap fails:* temporarily delete `"gantt"` from `concept-dependency`'s `relatedViews` in `help-content.ts`. Re-run. Expected: FAIL, with `gantt` in the received array. Restore.

*Closed gap fails:* temporarily add `relatedViews: ["activity"]` to the `automated-tracking` entry. Re-run. Expected: FAIL, because `activity` is still in `KNOWN_UNCOVERED` but is no longer uncovered. Restore.

Both must fail. If the second passes, the assertion is a subset check and the baseline will rot.

- [ ] **Step 4: Commit**

```bash
git add src/app/help-content-gate.test.ts
git commit -m "test(help): ratchet nav-view coverage against an explicit baseline"
```

---

### Task 5: Marker resolution gate

**Files:**
- Modify: `src/app/help-content-gate.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/help-content-gate.test.ts`:

```ts
import { beforeAll } from "vitest";
import { t, loadI18n, type Lang } from "./i18n";
import { de } from "./i18n.de";
import { helpBodyLabels } from "./help-body-markup";

// ★ All three langs, not just EN + DE. `enGB` is `{ ...enUS }` with zero
// overrides today, so it is byte-identical — but walking it costs nothing and
// survives the day someone adds a GB spelling.
const LANGS: readonly Lang[] = ["en-US", "en-GB", "de"];

describe("help marker resolution", () => {
  // ★★ The DE dictionary is LAZY. Without this await, `t("de", k)` silently
  // falls back to en-US and the DE assertion below passes by testing English
  // twice — vacuous, and it would hide exactly the drift it exists to catch.
  beforeAll(async () => {
    await loadI18n("de");
  });

  const valuesFor = (lang: Lang): Set<string> =>
    new Set((Object.keys(de) as (keyof typeof de)[]).map((k) => t(lang, k).trim()));

  it.each(LANGS)("every [[label]] resolves to a real UI string in %s", (lang) => {
    const known = valuesFor(lang);
    const unresolved: string[] = [];
    for (const e of HELP_ENTRIES) {
      for (const label of helpBodyLabels(t(lang, e.bodyKey))) {
        if (!known.has(label.trim())) unresolved.push(`${e.id}: [[${label}]]`);
      }
    }
    expect(unresolved).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx vitest run src/app/help-content-gate.test.ts --reporter=dot`
Expected: PASS, 4 tests (1 ratchet + 3 languages). No markers exist yet, so the loop body never runs.

- [ ] **Step 3: Mutation-prove it**

*Unresolvable label fails:* temporarily change `helpSecLayoutBody` in `i18n.ts` to contain `[[No Such Control]]`. Run the same command. Expected: FAIL for **all three** languages, each naming `feature-layout: [[No Such Control]]`. Restore.

*Per-language checking is real:* the EN and DE dictionaries hold different strings for the same key, so a marker carrying the **EN** label must fail in **DE**. Pick a concrete pair first:

```bash
mkdir -p scripts/tmp && cat > scripts/tmp/pair.ts <<'EOF'
import { de } from "../../src/app/i18n.de";
import { t } from "../../src/app/i18n";
const k = "print" as keyof typeof de;
console.log("EN:", JSON.stringify(t("en-US", k)), "DE:", JSON.stringify(de[k]));
EOF
npx vite-node scripts/tmp/pair.ts; rm -rf scripts/tmp
```

If the two differ, put the **EN** value in `helpSecLayoutBody` as a marker and re-run the gate. Expected: `en-US` and `en-GB` PASS, `de` FAILS naming that label. That asymmetry is the proof the check is per-language rather than testing English three times. Restore the body afterwards.

If `print` happens to be identical in both, swap `k` for another key until you find a differing pair — any one will do.

- [ ] **Step 4: Commit**

```bash
git add src/app/help-content-gate.test.ts
git commit -m "test(help): resolve every [[label]] against the live dictionaries"
```

---

### Task 6: Audit the concepts and workflows groups

**Files:**
- Read-only for the reviewers. Edits land in Task 9.

- [ ] **Step 1: Dispatch three parallel read-only reviewers**

Partition: (a) the 12 `concepts` entries, (b) the 6 `workflows` + 2 `automated` entries, (c) a **cold** reviewer over the same 20 entries with no findings list and no mention of the two known defects.

Each reviewer gets this brief:

> Verify each listed Help entry against the current code in `C:\Projects\aipm-wt-a\src`. For every entry, extract each factual claim (a named control, a settings path, a file/tab location, a described behaviour, a count) and check it against the code. Report per entry: `id` — VERIFIED, or FALSE with the claim quoted, the evidence (`file:line`), and the corrected wording. Do not edit any file. Do not report style opinions. Read `src/app/i18n.ts` for the EN body of each `bodyKey`.
>
> You MUST call SendMessage to `main` with your report — a plain final message is discarded and your work will be lost.

- [ ] **Step 2: Record findings**

Write each confirmed-false claim into a scratch list with entry id, current wording, corrected wording, and the `file:line` evidence. Do not edit i18n yet — Task 9 applies every edit serially.

---

### Task 7: Audit the features group

**Files:**
- Read-only for the reviewers. Edits land in Task 9.

- [ ] **Step 1: Dispatch three parallel read-only reviewers**

The `features` group is 31 entries — too many for one reviewer to hold. Partition by position in `HELP_ENTRIES`: (a) `feature-rate-card` through `feature-tasks`, (b) `feature-task-status` through `feature-knowledge`, (c) `feature-voice` through `feature-keys`.

Same brief as Task 6, Step 1, including the SendMessage requirement.

- [ ] **Step 2: Seed the two known defects into the report**

These are already confirmed; add them so Task 9 fixes them even if a reviewer misses them:

- `helpSecTourBody` — says *"click 'Take the tour' at the bottom of this Help menu"*. That button was removed; the floating panel's footer is a license link, and tours live in the in-pane **Guided tours** tab. It also says "a short guided walkthrough" when `TOURS` holds six themed tours.
- `helpSecAiBody` — says *"The key is stored in this browser's localStorage."* The Anthropic key is AES-256-GCM encrypted in IndexedDB under a non-extractable device key; `writeSettings` blanks it from localStorage.

- [ ] **Step 3: Dispatch one cold reviewer**

One reviewer over all 31 features entries with **no** findings list and no mention of the known defects. Primed reviewers have repeatedly missed what a cold read catches at once.

---

### Task 8: Reconcile the reports

- [ ] **Step 1: Merge into one ordered edit list**

Produce a single list: entry id → current wording → corrected wording → evidence `file:line`. Deduplicate where reviewers overlap.

- [ ] **Step 2: Verify each claimed defect yourself before editing**

For every reported FALSE, re-check the evidence. A reviewer's "Critical" can be invalid, and applying an unverified correction writes a *new* falsehood into the file — which is how the last several rounds of prose work in this repo went wrong. Drop anything you cannot confirm, and say so in the final report.

- [ ] **Step 3: Decide the markers**

For each entry, list which quoted strings are genuine UI labels (become `[[label]]`) and which are ordinary prose (stay quoted). When unclear, leave it quoted — a false marker fails the build on a true sentence.

---

### Task 9: Apply corrections and markers

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Apply the EN edits**

Edit `src/app/i18n.ts` entry by entry from the Task 8 list. EN may use the Edit tool.

- [ ] **Step 2: Apply the DE edits via a node UTF-8 write**

Never the Edit tool on `i18n.de.ts`. For each change:

```bash
node -e '
const fs=require("fs");
const p="src/app/i18n.de.ts";
let s=fs.readFileSync(p,"utf8");
const before="  KEY: \"OLD TEXT\",";
const after="  KEY: \"NEW TEXT\",";
if(!s.includes(before)){console.error("ANCHOR NOT FOUND");process.exit(1);}
if(s.split(before).length-1!==1){console.error("ANCHOR NOT UNIQUE");process.exit(1);}
fs.writeFileSync(p,s.replace(before,after),"utf8");
console.log("WROTE");
'
```

- [ ] **Step 3: Verify DE integrity**

```bash
node -e '
const fs=require("fs");
const b=fs.readFileSync("src/app/i18n.de.ts");
let lone=0; for(let i=0;i<b.length;i++){ if(b[i]===0x0a && (i===0||b[i-1]!==0x0d)) lone++; }
let loneCR=0; for(let i=0;i<b.length;i++){ if(b[i]===0x0d && (i+1>=b.length||b[i+1]!==0x0a)) loneCR++; }
console.log("loneLF="+lone+" loneCR="+loneCR+" BOM="+(b[0]===0xEF));
const s=b.toString("utf8");
console.log("ascii-subs:", /\b(fuer|druecken|ueber|oeffnen|schliessen|Vorschlaege|Groesse)\b/.test(s));
'
```
Expected: `loneLF=0 loneCR=0 BOM=false`, `ascii-subs: false`.

- [ ] **Step 4: Run the gate and the help tests**

```bash
npx vitest run src/app/help-content-gate.test.ts src/app/help-content-pane.test.tsx src/app/i18n-encoding.test.ts --reporter=dot > /tmp/h.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/h.log
```
Expected: `EXIT=0`.

- [ ] **Step 5: Prove Task 3's bracket guard can fail**

Temporarily break one marker's closing bracket in `i18n.ts` (`[[Print]]` → `[[Print]`). Run:

```bash
npx vitest run src/app/help-content-pane.test.tsx --reporter=dot
```
Expected: FAIL on `renders a marked label as styled text, never as raw brackets` — the unclosed marker renders literally. Restore and re-run to green. This is the step that converts Task 3's trivially-passing test into a real guard.

- [ ] **Step 6: Verify Tailwind still compiles**

Markers land in tracked files, and Tailwind v4 scans every repo file for class candidates. This repo has already broken `globals.css` once that way.

```bash
npm run build > /tmp/build.log 2>&1; echo "BUILD=$?"
grep -iE "error|failed" /tmp/build.log | head
```
Expected: `BUILD=0`, no CSS errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "fix(help): correct false entries and mark UI labels"
```

---

### Task 10: Document and run the full gate set

**Files:**
- Modify: `docs/AGENTS/ui-shell.md`

- [ ] **Step 1: Add the convention to the Help system section**

Insert after the floating-panel bullet:

```markdown
  • **Help body `[[label]]` markers:** a body naming a UI control writes it
    `[[Take the tour]]`, never in bare quotes. Pure `help-body-markup.ts`
    (`parseHelpBody`/`stripHelpMarkers`/`helpBodyLabels`) splits them;
    `help-content-pane.tsx` renders label segments `font-medium text-foreground`
    and feeds the STRIPPED body to `matchesQuery` — miss that second call site
    and users get search hits on markup they cannot see.
    ★★ `help-content-gate.test.ts` resolves every marker against all three
    dictionaries and ratchets nav-view coverage against an explicit
    `KNOWN_UNCOVERED` id list, asserted by set EQUALITY so a closed gap fails
    until its id is removed. ★★★ It proves STRUCTURE, NOT TRUTH: a body can be
    entirely false and pass — `helpSecAiBody` claimed the API key lives in
    localStorage while it is AES-256-GCM encrypted in IndexedDB, and no
    assertion here would catch it. A green run is not evidence that help
    content is correct.
    ★ Markers are UI LABELS ONLY; ordinary quoted prose stays quoted, because a
    false marker fails the build on a true sentence.
```

- [ ] **Step 2: Run every gate, serially**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "SUITE=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "COV=$?"; grep "All files" /tmp/cov.log
npm run dup:check > /tmp/dup.log 2>&1; echo "DUP=$?"
npm run size:check > /tmp/size.log 2>&1; echo "SIZE=$?"
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "SYM=$?"
```
Expected: every variable `0`. Coverage floors: lines ≥ 92, funcs ≥ 91, branch ≥ 80, stmts ≥ 89.

- [ ] **Step 3: Eye-verify the rendered pane**

Help is not in `A11Y_VIEWS`, so nothing automated checks how labels look.

```bash
PORT=3100 npm run dev
```
Open the Help view and the floating Help panel. Confirm labels read as emphasised, no `[[` is visible anywhere, and search for a label's words still finds its entry. Then:

```bash
PORT=3100 npm run stop
```

- [ ] **Step 4: Commit**

```bash
git add docs/AGENTS/ui-shell.md
git commit -m "docs(agents): record the help marker convention and the gate's limits"
```

- [ ] **Step 5: Report, do not release**

Report what changed, which claimed defects you could not confirm and dropped, and the gate results. **Do not push, open an MR, merge, or bump the version** — each needs its own explicit go-ahead.

---

## Self-review notes

**Spec coverage.** Audit method → Tasks 6–8. Marker convention → Tasks 1, 8, 9. Parser → Task 1. Render + search → Tasks 2–3. Gate (a) coverage ratchet → Task 4. Gate (b) marker resolution → Task 5. Honest limits → Task 4's header comment and Task 10's doc block. Success criteria 1–5 → Tasks 8, 9, 4/5, 3/9, 10.

**Known soft spot.** Tasks 2 and 3 each write a test that passes before its implementation lands, because both guard content that does not exist until Task 9. Task 9 Step 5 is what proves the bracket guard can fail; without that step the guard is vacuous. Do not skip it.

**Baseline provenance.** `KNOWN_UNCOVERED` was measured on 2026-08-05 against `allNavViews()` (33 views, 19 covered). Reproduce by intersecting `allNavViews()` with the union of `HELP_ENTRIES[].relatedViews`. `learning-insights` is in `AppView` but not in the sidebar, so it is out of scope by construction — do not add it.
