# 0.210.0 "Larbalestier" — rich-text export fidelity + projection correctness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close nine of the twelve items in `docs/open-followups.md` §16–27 — make rich descriptions
export as real paragraphs, make every description consumer use the correct projection, and close four
small correctness/guard gaps.

**Architecture:** `rich-text-plain.ts` (DOM-free, storage-critical) gains an **opt-in** break mode
whose default path is byte-identical, plus a numeric-entity decode. `rich-text-projection.ts`
(browser-only) gains a `descriptionTextWithBreaks` wrapper. `export-sections.ts` switches to it and
adds the missing task column. Three of the four OOXML/HTML renderers then map `\n` to their own break
primitive; XLSX already handles it. The remaining items are local and independent.

**Tech Stack:** TypeScript, Next.js 16, React 19, vitest, hand-rolled OOXML builders (no library),
DOMPurify (browser only).

---

## Read this before Task 1

Three facts that changed from the spec once the real code was read. Do not "fix" them back:

1. **XLSX needs no code change.** `export-xlsx.ts` already emits
   `<t xml:space="preserve">${xmlEscape(str)}</t>` into the shared-strings table, and cell styles 2
   and 3 (the two body styles) already carry `<alignment vertical="top" wrapText="1"/>`. `xmlEscape`
   does not touch `\n`. Task 9 is a regression test, not an edit.

2. **No CSV writer consumes an `ExportSection`.** Verified: the only importers of the type are
   `export.ts` (HTML/PDF), `export-docx.ts`, `export-xlsx.ts`, `export-pptx.ts`. The spec's §A4 open
   question is answered — there is no fifth renderer.

3. **§24 fixes NUMERIC references only**, which is what the spec approved. The register's own
   illustration (`&mdash;` counting 7) is a **named** reference and is therefore **still
   over-counted** after this work. Say so in the register update (Task 16); do not silently imply the
   whole class is closed.

**Two files are storage-critical.** `rich-text-plain.ts` feeds `capHtmlText` → `sanitizeRichText` →
every backend. Tasks 2 and 3 both edit `htmlPlainProjection`. After each, `golden-workspace.test`
must pass **unchanged**. If it fails, stop and report — regenerating fixtures is not the answer here.

**Anti-vacuity rule for this plan.** Tasks 2, 9, 11, 12 and 13 all have a documented shape where the
obvious test passes with the bug present. Every "run it and watch it fail" step is mandatory, and the
failure message must be the one the step predicts. A test that fails for a different reason has not
been proved.

---

## File map

| file | responsibility | tasks |
|---|---|---|
| `src/app/rich-text-plain.ts` | DOM-free projection: numeric decode, opt-in break mode | 2, 3, 14 |
| `src/app/rich-text-plain.test.ts` | byte-stability suite + import-surface guard | 1, 2, 3 |
| `src/app/rich-text-projection.ts` | `descriptionTextWithBreaks` | 4, 14 |
| `src/app/rich-text-projection.test.ts` | break-preserving projection tests | 4 |
| `src/app/export-sections.ts` | `TASK_RICH_COLUMNS`, `richCell` → break variant | 5 |
| `src/app/export-sections.test.ts` | task rich-column pin | 5 |
| `src/app/export.ts` | HTML/PDF cell: `\n` → `<br>` | 6 |
| `src/app/export-docx.ts` | DOCX cell: `\n` → `<w:br/>` | 7 |
| `src/app/export-pptx.ts` | PPTX: one `<a:p>` per line | 8 |
| `src/app/export-ooxml.test.ts` | renderer break tests incl. XLSX regression | 6, 7, 8, 9 |
| `src/app/workspace-context.tsx` · `gantt.tsx` · `task-row.tsx` · `task-dedup/dedup.ts` · `jira-api.ts` | swap to `descriptionText` | 10 |
| `src/app/inline-ai-edit/plan.ts` | expose raw applied value | 11 |
| `src/app/inline-ai-edit/entity-descriptor.ts` | `notes` → `description` | 14 |
| `src/app/chat-tools.ts` | keep-alias rationale comment | 14 |
| `src/app/raid-edit-modal.tsx` · `change-edit-modal.tsx` | Enter-submit cap, counter feed | 12, 13 |
| `src/app/version.ts` · `CHANGELOG.md` · `i18n.ts` · `i18n.de.ts` | release | 15 |
| `docs/open-followups.md` | register update | 16 |

---

## Task 1: Guard the import surface of the DOM-free module (§25)

Do this first. It protects everything after it — Tasks 3–5 add importers around this boundary.

**Files:**
- Modify: `src/app/rich-text-plain.test.ts` (the `describe("DOM-free guard")` block, ~line 9 onward)

- [ ] **Step 1: Replace the symbol-name bans with an import-surface pin, and add the reverse sweep**

Replace the whole `it("never reaches a DOM-dependent sanitiser from code")` block with the two below.
Keep the existing `it("strips comments before scanning")` exactly as it is — it is what stops the
scan passing vacuously on an empty string.

```ts
  it("imports exactly the two modules it is allowed to import", () => {
    // ★ The old guard banned four SYMBOL names. That let two things past:
    // plainToHtml growing a DOMPurify.sanitize call (its own comment warns
    // against exactly that), and a future `import { descriptionText } from
    // "./rich-text-projection"` — neither the module name nor the symbol was on
    // the list, and that module DOES call DOMPurify. Pinning the import SURFACE
    // means a new import has to be added here deliberately, which is the point.
    const specifiers = [...code.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(specifiers).toEqual(["./narrative-html", "./sanitize-html"]);
  });

  it("keeps rich-text-projection out of every DOM-free reach", () => {
    // ★ Nothing guarded this direction at all. rich-text-projection calls
    // DOMPurify, so a codec, an entity sanitizer or anything under scripts/
    // importing it would throw under bare node — where jsonToWorkspace's
    // catch-all converts the throw into an EMPTY workspace that then
    // "successfully" writes near-empty sample files.
    const appDir = join(import.meta.dirname);
    const repoRoot = join(appDir, "..", "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".next") continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (/\.test\.tsx?$/.test(entry.name)) continue;
        const rel = full.replace(/\\/g, "/");
        const isDomFree =
          /\/scripts\//.test(rel) ||
          /\/sanitize[^/]*\.ts$/.test(rel) ||
          /-codecs[^/]*\.ts$/.test(rel);
        if (!isDomFree) continue;
        if (/from\s+"[^"]*rich-text-projection"/.test(readFileSync(full, "utf8"))) {
          offenders.push(rel);
        }
      }
    };
    walk(join(repoRoot, "src"));
    walk(join(repoRoot, "scripts"));
    expect(offenders).toEqual([]);
  });
```

Add `readdirSync` to the existing `node:fs` import at the top of the file:

```ts
import { readFileSync, readdirSync } from "node:fs";
```

- [ ] **Step 2: Prove the import pin actually bites**

Temporarily add this line to `src/app/rich-text-plain.ts` after its existing imports:

```ts
import { descriptionText } from "./rich-text-projection";
```

Run: `npx vitest run src/app/rich-text-plain.test.ts`

Expected: FAIL on `imports exactly the two modules it is allowed to import`, with the received array
containing `"./rich-text-projection"`. If it passes, the regex is not matching — fix the guard, not
the assertion.

- [ ] **Step 3: Prove the reverse sweep actually bites**

Remove the temporary import from Step 2. Instead add it temporarily to `src/app/sanitize-core.ts`.

Run: `npx vitest run src/app/rich-text-plain.test.ts`

Expected: FAIL on `keeps rich-text-projection out of every DOM-free reach`, with `offenders`
containing a path ending `src/app/sanitize-core.ts`.

- [ ] **Step 4: Remove the temporary import and run green**

Run: `npx vitest run src/app/rich-text-plain.test.ts`
Expected: PASS, all assertions.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/rich-text-plain.test.ts
git commit -m "test(rich-text): guard the DOM-free import surface, both directions

Pins rich-text-plain.ts's import specifiers instead of banning four symbol
names, and adds the sweep that was missing entirely: no sanitizer, codec or
scripts/ file may import rich-text-projection. Closes open-followups.md §25."
```

---

## Task 2: Decode numeric entity references (§24)

**Files:**
- Modify: `src/app/rich-text-plain.ts` (add the decoder; rewire `htmlPlainProjection`, ~line 94)
- Test: `src/app/rich-text-plain.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `src/app/rich-text-plain.test.ts`:

```ts
describe("numeric entity references", () => {
  it("decodes decimal and hex forms so the counter measures visible text", () => {
    expect(htmlPlainProjection("<p>a&#8212;b</p>")).toBe("a—b");
    expect(htmlPlainProjection("<p>a&#x2014;b</p>")).toBe("a—b");
    expect(htmlPlainProjection("<p>a&#X2014;b</p>")).toBe("a—b");
    expect(htmlTextLength("<p>&#8212;</p>")).toBe(1);
  });

  it("REFUSES to emit & < >, which would re-open the double-decode hole", () => {
    // ★★ &#38; IS "&". Decoding it before the named pass turns "&#38;lt;" into
    // "&lt;", which the named pass then decodes to "<" — exactly the
    // double-decode that "&amp; decodes LAST" exists to prevent. &#60;/&#62;
    // would re-introduce a tag delimiter AFTER the tag work has already run.
    expect(htmlPlainProjection("<p>&#38;lt;</p>")).toBe("&#38;lt;");
    expect(htmlPlainProjection("<p>&#60;script&#62;</p>")).toBe("&#60;script&#62;");
    expect(htmlPlainProjection("<p>&#x26;lt;</p>")).toBe("&#x26;lt;");
  });

  it("refuses lone surrogates and out-of-range code points instead of throwing", () => {
    // String.fromCodePoint throws on both; a projection must never throw — it
    // runs inside the entity sanitizers on every load.
    expect(htmlPlainProjection("<p>&#xd800;</p>")).toBe("&#xd800;");
    expect(htmlPlainProjection("<p>&#1114112;</p>")).toBe("&#1114112;");
    expect(htmlPlainProjection("<p>&#0;</p>")).toBe("&#0;");
  });

  it("leaves the existing named decodes and their ordering intact", () => {
    expect(htmlPlainProjection("<p>&amp;lt;</p>")).toBe("&lt;");
    expect(htmlPlainProjection("<p>&#39;a&apos;</p>")).toBe("'a'");
  });
});
```

★ Make sure `htmlTextLength` is in the file's import list; add it if not.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/rich-text-plain.test.ts -t "numeric entity"`

Expected: FAIL on the first case — received `"a&#8212;b"`, expected `"a—b"`. The refusal cases pass
already (nothing decodes today); that is fine and expected — they are there to stop the fix going
too far.

- [ ] **Step 3: Add the decoder**

In `src/app/rich-text-plain.ts`, after the `WS_RUN` const (~line 63), add:

```ts
/** Code points a numeric reference must NOT decode to.
 *
 *  ★★ `&#38;` IS `&`. Decoding it before the named pass turns `&#38;lt;` into
 *  `&lt;`, which the named pass then decodes to `<` — the exact double-decode
 *  that "&amp; decodes LAST" exists to prevent. `&#60;`/`&#62;` would put a tag
 *  delimiter back into a string the TAG pass has already finished with. All
 *  three stay literal text: over-counted, which is the pre-existing behaviour,
 *  but never corrupting. */
const UNSAFE_CODE_POINTS = new Set([0x26, 0x3c, 0x3e]);
/** `&#8212;` / `&#x2014;`, either case. */
const NUMERIC_ENTITY = /&#(x[0-9a-f]+|\d+);/gi;

/** Decode numeric character references to the characters they denote.
 *
 *  Runs AFTER the tag work (so a decoded character can never be read as markup)
 *  and BEFORE the &nbsp;/whitespace passes (so a decoded space collapses like
 *  any other). Anything it declines is returned verbatim — this must never
 *  throw, because it runs inside the entity sanitizers on every load.
 *
 *  ★ NAMED references beyond the small set below are deliberately still
 *  untouched: `&mdash;` continues to count 7. The numeric forms are what an
 *  Office paste actually produces; the named tail is open-followups.md §24's
 *  remainder. */
function decodeNumericEntities(s: string): string {
  return s.replace(NUMERIC_ENTITY, (whole, body: string) => {
    const hex = body[0] === "x" || body[0] === "X";
    const cp = hex ? parseInt(body.slice(1), 16) : parseInt(body, 10);
    if (!Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff) return whole;
    if (UNSAFE_CODE_POINTS.has(cp)) return whole;
    // Lone surrogates are not characters and fromCodePoint throws on them.
    if (cp >= 0xd800 && cp <= 0xdfff) return whole;
    return String.fromCodePoint(cp);
  });
}
```

- [ ] **Step 4: Wire it into the projection**

Replace the body of `htmlPlainProjection` (~line 94) with:

```ts
export function htmlPlainProjection(html: string): string {
  return decodeNumericEntities(html.replace(BLOCK_TAG, " ").replace(TAG, ""))
    .replace(NBSP, " ")
    .replace(WS_RUN, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .trim();
}
```

Add one line to that function's existing `★ ORDER IS LOAD-BEARING` comment block:

```
 *  Numeric references decode after the tag work and before the whitespace
 *  passes, and refuse to emit & < > — see UNSAFE_CODE_POINTS.
```

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run src/app/rich-text-plain.test.ts`
Expected: PASS, all blocks including the pre-existing ones.

- [ ] **Step 6: Prove storage did not move**

Run: `npx vitest run src/app/golden-workspace.test.ts`

Expected: PASS with no fixture diff. The six rich fields are empty in the sample workspace, so this
should hold.

★ **If it FAILS, stop.** Do not regenerate the fixtures. A moved golden means §24 belongs with §22 in
a separate fixture-moving slice; report it and leave Task 2 uncommitted.

- [ ] **Step 7: Full suite, typecheck, commit**

```bash
npx tsc --noEmit
npm run test:run
git add src/app/rich-text-plain.ts src/app/rich-text-plain.test.ts
git commit -m "fix(rich-text): decode numeric entity references in the DOM-free projection

The counter and the cap over-charged a value carrying numeric character
references, and truncation could land mid-reference. Decodes decimal and hex
forms after the tag work, refusing & < > so the &amp;-last ordering cannot be
subverted. Named references beyond the existing set are still untouched.
Closes open-followups.md §24 (numeric half)."
```

---

## Task 3: Opt-in break mode in the DOM-free projection (§17, part 1)

**Files:**
- Modify: `src/app/rich-text-plain.ts` (`separateBlockBoundaries` ~line 72, `htmlPlainProjection`)
- Test: `src/app/rich-text-plain.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/rich-text-plain.test.ts`:

```ts
describe("break-preserving mode", () => {
  it("maps a block boundary to ONE newline, not two", () => {
    // An open+close pair ("</p><p>") is two boundaries; the whitespace collapse
    // absorbs them into a single break, which is what a reader expects.
    expect(htmlPlainProjection("<p>a</p><p>b</p>", { preserveBreaks: true })).toBe("a\nb");
    expect(htmlPlainProjection("<p>a<br>b</p>", { preserveBreaks: true })).toBe("a\nb");
    expect(htmlPlainProjection("<ul><li>a</li><li>b</li></ul>", { preserveBreaks: true })).toBe("a\nb");
  });

  it("still collapses horizontal runs to one space", () => {
    expect(htmlPlainProjection("<p>a   \t b</p>", { preserveBreaks: true })).toBe("a b");
  });

  it("trims leading and trailing breaks", () => {
    expect(htmlPlainProjection("<p>a</p>", { preserveBreaks: true })).toBe("a");
  });

  it("separateBlockBoundaries takes the separator", () => {
    expect(separateBlockBoundaries("<p>a</p><p>b</p>", "\n")).toBe("\na\n\nb\n");
    expect(separateBlockBoundaries("<p>a</p>")).toBe(" a ");
  });

  it("leaves the default path byte-identical", () => {
    // ★★ This is the acceptance gate for the whole export-fidelity change.
    // rich-text-plain feeds capHtmlText -> sanitizeRichText -> every backend, so
    // adding a parameter must not move a single character on the options-less
    // call. Expected values are HARDCODED, not derived, so a shared bug in the
    // implementation cannot make both sides agree.
    const cases: Array<[string, string]> = [
      ["<p>a</p><p>b</p>", "a b"],
      ["<p>a<br>b</p>", "a b"],
      ["<ul><li>a</li><li>b</li></ul>", "a b"],
      ["<p>a   \t b</p>", "a b"],
      ["<p>x&nbsp;y</p>", "x y"],
      ["<p>x&#160;y</p>", "x y"],
      ["<p>cost &lt; 5k</p>", "cost < 5k"],
      ["<p>&amp;lt;</p>", "&lt;"],
      ["<p>a&#8212;b</p>", "a—b"],
      ["<p>&#38;lt;</p>", "&#38;lt;"],
      ["<p><strong>bold</strong></p>", "bold"],
      ["", ""],
    ];
    for (const [input, expected] of cases) {
      expect(htmlPlainProjection(input)).toBe(expected);
      expect(htmlPlainProjection(input, {})).toBe(expected);
      expect(htmlPlainProjection(input, { preserveBreaks: false })).toBe(expected);
    }
  });
});
```

★ Add `separateBlockBoundaries` to the file's import list if it is not already there.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/rich-text-plain.test.ts -t "break-preserving"`

Expected: FAIL — `htmlPlainProjection` currently takes one argument, so the break cases return
`"a b"` where `"a\nb"` is expected, and the `separateBlockBoundaries` separator case returns `" a  b "`.
The "byte-identical" case should PASS immediately; if it does not, Task 2 changed something it should
not have — stop and investigate before continuing.

- [ ] **Step 3: Add the two whitespace regexes**

In `src/app/rich-text-plain.ts`, immediately after the existing `WS_RUN` const:

```ts
/** Break mode's two-stage collapse. A whitespace run CONTAINING a newline
 *  becomes one "\n" — so the close-tag and open-tag boundaries of "</p><p>"
 *  merge into a single break — while a purely horizontal run still becomes one
 *  space. `[^\S\n]` is "whitespace that is not a newline".
 *
 *  ★ Paragraph-vs-<br> is deliberately NOT preserved: this is a plain-text
 *  projection, not a format. One boundary, one break. */
const WS_RUN_WITH_NEWLINE = /[^\S\n]*\n\s*/g;
const WS_RUN_HORIZONTAL = /[^\S\n]+/g;
```

- [ ] **Step 4: Parameterize the two functions**

Replace `separateBlockBoundaries` (~line 72) with:

```ts
export function separateBlockBoundaries(html: string, sep = " "): string {
  return html.replace(BLOCK_TAG, sep);
}
```

Extend its existing doc comment with:

```
 *  ★ The separator defaults to a space, which is the storage-critical path
 *  (htmlPlainProjection -> capHtmlText -> sanitizeRichText -> every backend).
 *  descriptionTextWithBreaks passes "\n"; nothing else may.
```

Replace `htmlPlainProjection` with:

```ts
export function htmlPlainProjection(html: string, opts?: { preserveBreaks?: boolean }): string {
  const breaks = opts?.preserveBreaks === true;
  const tagless = decodeNumericEntities(
    html.replace(BLOCK_TAG, breaks ? "\n" : " ").replace(TAG, ""),
  ).replace(NBSP, " ");
  const spaced = breaks
    ? tagless.replace(WS_RUN_WITH_NEWLINE, "\n").replace(WS_RUN_HORIZONTAL, " ")
    : tagless.replace(WS_RUN, " ");
  return spaced
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .trim();
}
```

Extend its doc comment with:

```
 *  ★★ `preserveBreaks` is OPT-IN and the default path must stay byte-identical:
 *  this function feeds capHtmlText -> sanitizeRichText -> storage, so a change
 *  to the options-less result moves stored bytes on every backend. A hardcoded
 *  byte-stability suite in the test file is the gate.
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/rich-text-plain.test.ts`
Expected: PASS, every block.

- [ ] **Step 6: Prove storage still did not move**

Run: `npx vitest run src/app/golden-workspace.test.ts`
Expected: PASS, no fixture diff. Stop and report if not.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/rich-text-plain.ts src/app/rich-text-plain.test.ts
git commit -m "feat(rich-text): opt-in break-preserving mode in the DOM-free projection

separateBlockBoundaries takes a separator and htmlPlainProjection takes a
preserveBreaks flag; both default to today's exact behaviour, pinned by a
hardcoded byte-stability suite because this path writes storage. One block
boundary yields one newline. Groundwork for open-followups.md §17."
```

---

## Task 4: `descriptionTextWithBreaks` (§17, part 2)

**Files:**
- Modify: `src/app/rich-text-projection.ts`
- Test: `src/app/rich-text-projection.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/rich-text-projection.test.ts`:

```ts
describe("descriptionTextWithBreaks", () => {
  it("keeps paragraph boundaries as newlines", () => {
    expect(descriptionTextWithBreaks("<p>Vendor delay</p><p>Mitigation plan</p>")).toBe(
      "Vendor delay\nMitigation plan",
    );
  });

  it("upgrades a legacy plain value the same way descriptionText does", () => {
    // descriptionHtml turns a legacy newline into <br>, which is a real boundary.
    expect(descriptionTextWithBreaks("line one\nline two")).toBe("line one\nline two");
  });

  it("still sanitizes — a script tag survives neither projection", () => {
    const stored = "<p>ok</p><script>alert(1)</script>";
    expect(descriptionTextWithBreaks(stored)).not.toContain("alert");
    expect(descriptionTextWithBreaks(stored)).not.toContain("<");
  });

  it("differs from descriptionText ONLY in the boundary character", () => {
    const stored = "<p>a</p><p>b</p>";
    expect(descriptionText(stored)).toBe("a b");
    expect(descriptionTextWithBreaks(stored)).toBe("a\nb");
  });

  it("returns empty for an empty value", () => {
    expect(descriptionTextWithBreaks(undefined)).toBe("");
    expect(descriptionTextWithBreaks("")).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/rich-text-projection.test.ts -t "descriptionTextWithBreaks"`
Expected: FAIL — `descriptionTextWithBreaks is not a function` / not exported.

- [ ] **Step 3: Implement**

In `src/app/rich-text-projection.ts`, directly below `descriptionText`:

```ts
/** Stored value -> plain text with block boundaries kept as newlines.
 *
 *  The EXPORT projection. Search, the AI digests and the inline-AI preview keep
 *  descriptionText's collapsed form — they want whitespace flattened — while an
 *  export is read by a human and a three-paragraph description must not arrive
 *  as one run-on line.
 *
 *  ★★ separateBlockBoundaries runs FIRST here for the same reason it does in
 *  descriptionText: htmlToText deletes tags leaving nothing in their place, so
 *  the newline has to be in the string before DOMPurify sees it. Only the
 *  separator differs. */
export function descriptionTextWithBreaks(stored: string | undefined): string {
  return htmlPlainProjection(
    htmlToText(separateBlockBoundaries(descriptionHtml(stored), "\n")),
    { preserveBreaks: true },
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/rich-text-projection.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/rich-text-projection.ts src/app/rich-text-projection.test.ts
git commit -m "feat(rich-text): add descriptionTextWithBreaks for the export path

Same chain as descriptionText with a newline separator, so exports can carry
paragraph boundaries while search keeps the collapsed form."
```

---

## Task 5: Route exports through it, and add the missing task column (§17 part 3, §18)

**Files:**
- Modify: `src/app/export-sections.ts` (`tasksSection` ~line 69, rich-column consts ~line 87, `richCell` ~line 95)
- Test: `src/app/export-sections.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/export-sections.test.ts`:

```ts
describe("task descriptions are projected like every other rich field", () => {
  it("exports Task.description as text, not raw HTML", () => {
    const base = makeBaseWorkspace();
    const ws: Workspace = {
      ...base,
      tasks: [{ ...makeTask(1), description: "<p>Vendor delay</p><p>Mitigation plan</p>" }],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const tasks = sections.find((s) => s.key === "tasks");
    const col = tasks!.columns.indexOf("description");
    expect(col).toBeGreaterThanOrEqual(0);
    const cell = String(tasks!.rows[0][col]);
    expect(cell).not.toContain("<p>");
    expect(cell).toBe("Vendor delay\nMitigation plan");
  });

  it("pins TASK_RICH_COLUMNS as a subset of the task CSV columns", () => {
    // A name that is not a real column would silently never match, leaving the
    // fix absent with nothing else noticing.
    for (const c of TASK_RICH_COLUMNS) {
      expect(CSV_COLUMNS as unknown as string[]).toContain(c);
    }
  });

  it("keeps register descriptions on the break-preserving projection too", () => {
    const base = makeBaseWorkspace();
    const ws: Workspace = {
      ...base,
      raid: [{ ...makeRaidItem(1), description: "<p>one</p><p>two</p>" }],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const raid = sections.find((s) => s.key === "raid");
    const col = raid!.columns.indexOf("description");
    expect(String(raid!.rows[0][col])).toBe("one\ntwo");
  });
});
```

★ `export-sections.test.ts`'s existing factories are `makeTask(id)`, `makeRaidItem(id, stakeholderIds?)`
and `makeBaseWorkspace()` — **`makeTask` takes no overrides**, which is why the fixtures above spread
over its result instead of passing options. Do not add an overrides parameter to it.

★ Import `TASK_RICH_COLUMNS` and `CSV_COLUMNS` alongside the imports already at the top of the file.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/export-sections.test.ts -t "projected like every other"`
Expected: FAIL — the first case receives `"<p>Vendor delay</p><p>Mitigation plan</p>"`, the second
fails on `TASK_RICH_COLUMNS` not being exported, the third receives `"one two"`.

- [ ] **Step 3: Add the task rich-column set**

In `src/app/export-sections.ts`, beside the three existing sets (~line 87):

```ts
export const TASK_RICH_COLUMNS: ReadonlySet<string> = new Set(["description"]);
```

- [ ] **Step 4: Route tasksSection through richCell**

Replace `tasksSection` (~line 69) with:

```ts
function tasksSection(tasks: readonly Task[], lang: Lang): ExportSection {
  const columns = CSV_COLUMNS as unknown as string[];
  const rows = tasks.map((t) =>
    CSV_COLUMNS.map((c) => richCell(fieldToString(t, c), c, TASK_RICH_COLUMNS))
  );
  return { key: "tasks", title: t(lang, "tasks"), columns, rows };
}
```

★ `richCell` is declared below `tasksSection` in the file. That is fine — it is a hoisted function
declaration, same as the three sections already calling it.

- [ ] **Step 5: Switch richCell to the break-preserving projection**

Replace `richCell` (~line 95) with:

```ts
function richCell(value: string, column: string, rich: ReadonlySet<string>): string {
  return rich.has(column) ? descriptionTextWithBreaks(value) : value;
}
```

And change the import on line 33:

```ts
import { descriptionTextWithBreaks } from "./rich-text-projection";
```

★ If `descriptionText` is no longer referenced anywhere in this file, removing it from the import is
mandatory — CI runs `--max-warnings=0` and an unused import is fatal.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/app/export-sections.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/export-sections.ts src/app/export-sections.test.ts
git commit -m "fix(export): project task descriptions, and keep block boundaries

The TASKS section still emitted Task.description verbatim, so a PDF or DOCX
export showed <p> markup where the app shows formatting. Adds TASK_RICH_COLUMNS
and moves every rich cell onto descriptionTextWithBreaks so a multi-paragraph
description reaches a renderer with its boundaries intact. Closes
open-followups.md §18; §17 renderer half follows."
```

---

## Task 6: HTML/PDF renderer maps the newline (§17 part 4a)

**Files:**
- Modify: `src/app/export.ts` (`renderSectionHtml`, ~line 84)
- Test: `src/app/export-ooxml.test.ts`

- [ ] **Step 1: Write the failing test**

`renderSectionHtml` is module-private, but `export.ts` already exposes
`buildPdfHtml(ws, cfg, lang): string` (line 149) which renders every section through it. Test through
that — do not widen the module's public surface for a test.

```ts
describe("HTML export cells", () => {
  it("renders a projected newline as a <br>", () => {
    const base = makeBaseWorkspace();
    const ws: Workspace = {
      ...base,
      tasks: [{ ...makeTask(1), description: "<p>one</p><p>two</p>" }],
    };
    expect(buildPdfHtml(ws, defaultExportConfig, "en-US")).toContain("one<br>two");
  });

  it("escapes BEFORE substituting, so user markup cannot inject a break", () => {
    // ★★ Order is the whole point. Substitute-then-escape turns our own <br>
    // into a visible "&lt;br&gt;"; escape-then-substitute leaves a user's
    // literal "<br>" escaped, which is what escaping is for. taskName is a
    // PLAIN column, so its value reaches the cell unprojected — the cleanest
    // way to put a literal "<br>" in front of the renderer.
    const base = makeBaseWorkspace();
    const ws: Workspace = { ...base, tasks: [{ ...makeTask(1), taskName: "a<br>b" }] };
    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");
    expect(html).toContain("a&lt;br&gt;b");
    expect(html).not.toContain("a<br>b");
  });
});
```

★ These go in `export-ooxml.test.ts`, which already has `makeTask`, `makeBaseWorkspace` and
`defaultExportConfig` in scope. Add `buildPdfHtml` to its imports — note it comes from `./export`,
not `./export-ooxml`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/export-ooxml.test.ts -t "HTML export cells"`
Expected: FAIL on the first case — the cell contains a raw newline, not `<br>`. The second case
passes already; it is a regression pin for the ordering.

- [ ] **Step 3: Implement**

In `src/app/export.ts`, directly above `renderSectionHtml`:

```ts
/** Escape FIRST, then map the export projection's newlines to <br>.
 *
 *  ★★ Both orderings are wrong in a different direction. Substituting first
 *  means htmlEscape then turns the <br> we inserted into a visible "&lt;br&gt;";
 *  skipping the escape to avoid that would let a literal "<br>" in user content
 *  through unescaped. Escape, then substitute — nothing else. */
function htmlCellWithBreaks(cell: string | number): string {
  return htmlEscape(cell).replace(/\n/g, "<br>");
}
```

Then in `renderSectionHtml`'s body row map, change `htmlEscape(cell)` to `htmlCellWithBreaks(cell)`:

```ts
        `<tr>${row.map((cell) => `<td>${htmlCellWithBreaks(cell)}</td>`).join("")}</tr>`
```

★ Leave the header-cell `htmlEscape(col)` and the title `htmlEscape(section.title)` alone — column
labels and section titles never carry a projected newline.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/export-ooxml.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/export.ts src/app/export-ooxml.test.ts
git commit -m "fix(export): render a projected paragraph break as <br> in HTML/PDF

Escape-then-substitute, pinned by a test in both directions."
```

---

## Task 7: DOCX renderer maps the newline (§17 part 4b)

**Files:**
- Modify: `src/app/export-docx.ts` (`buildDocxTable` body cell, ~line 68)
- Test: `src/app/export-ooxml.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("DOCX export cells", () => {
  it("renders a projected newline as a real Word line break", async () => {
    const blob = buildDocx([
      { key: "tasks", title: "Tasks", columns: ["description"], rows: [["one\ntwo"]] },
    ]);
    const xml = (await unzipBlob(blob)).get("word/document.xml")!;
    expect(xml).toContain(
      '<w:t xml:space="preserve">one</w:t><w:br/><w:t xml:space="preserve">two</w:t>',
    );
  });

  it("emits exactly the single run it always did for a break-free cell", async () => {
    const blob = buildDocx([
      { key: "tasks", title: "Tasks", columns: ["description"], rows: [["plain"]] },
    ]);
    const xml = (await unzipBlob(blob)).get("word/document.xml")!;
    expect(xml).toContain('<w:r><w:t xml:space="preserve">plain</w:t></w:r>');
    expect(xml).not.toContain("<w:br/>");
  });
});
```

★ `unzipBlob(blob): Promise<Map<string, string>>` already exists in `export-ooxml.test.ts` (line 71).
Use it; do not add another unzip helper. Both tests are `async`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/export-ooxml.test.ts -t "DOCX export cells"`
Expected: FAIL on the first case — the document contains one `<w:t>` holding a raw newline. The
second case passes and is the byte-stability pin.

- [ ] **Step 3: Implement**

In `src/app/export-docx.ts`, above `buildDocxTable`:

```ts
/** One cell's text as Word runs, mapping the export projection's newlines to
 *  <w:br/>. A cell with no newline emits exactly the single <w:t> it always
 *  did, so existing output is byte-identical. A run may legally hold several
 *  <w:t> children with <w:br/> between them. */
function docxCellRuns(value: string | number): string {
  return String(value ?? "")
    .split("\n")
    .map((line) => `<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`)
    .join("<w:br/>");
}
```

In the `tableBody` cell template, replace:

```ts
              <w:r><w:t xml:space="preserve">${xmlEscape(row[i] ?? "")}</w:t></w:r>
```

with:

```ts
              <w:r>${docxCellRuns(row[i] ?? "")}</w:r>
```

★ Leave the header-cell `<w:t>` (~line 48) alone.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/export-ooxml.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/export-docx.ts src/app/export-ooxml.test.ts
git commit -m "fix(export): render a projected paragraph break as <w:br/> in DOCX

A break-free cell emits the identical single run it did before."
```

---

## Task 8: PPTX renderer maps the newline (§17 part 4c)

**Files:**
- Modify: `src/app/export-pptx.ts` (`pptxTextBox`'s `runs` map, ~line 174)
- Test: `src/app/export-ooxml.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("PPTX export text", () => {
  it("splits a projected newline into separate paragraphs", async () => {
    const blob = buildPptx([
      {
        key: "tasks",
        title: "Tasks",
        columns: ["id", "taskName", "description"],
        rows: [[1, "Task one", "one\ntwo"]],
      },
    ]);
    const xml = (await unzipBlob(blob)).get("ppt/slides/slide3.xml")!;
    expect(xml).toContain("<a:t>description: one</a:t>");
    expect(xml).toContain("<a:t>two</a:t>");
    expect(xml).not.toContain("one\ntwo");
  });

  it("leaves a break-free paragraph as exactly one <a:p>", async () => {
    const blob = buildPptx([
      { key: "tasks", title: "Tasks", columns: ["id", "taskName"], rows: [[1, "Task one"]] },
    ]);
    const xml = (await unzipBlob(blob)).get("ppt/slides/slide3.xml")!;
    expect((xml.match(/<a:t>Task one<\/a:t>/g) ?? []).length).toBe(1);
  });
});
```

★ Slide numbering per `buildPptx`'s loop: slide 1 is the title slide, slide 2 the section divider,
slide 3 the first row slide. Confirm against the file's existing PPTX tests and adjust if they index
differently.

★ `description` lands in `metaLines` (columns 2–7 render as `"<label>: <value>"`), which is why the
first assertion expects the label glued to the first line only.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/export-ooxml.test.ts -t "PPTX export text"`
Expected: FAIL on the first case — the slide holds one `<a:t>description: one\ntwo</a:t>`.

- [ ] **Step 3: Implement**

In `src/app/export-pptx.ts`, replace the `runs` computation inside `pptxTextBox`:

```ts
  const runs = opts.paragraphs
    .flatMap((p) => {
      const rPr =
        `sz="${p.sizeHundredths ?? 1800}"` +
        (p.bold ? ' b="1"' : "") +
        (p.italic ? ' i="1"' : "");
      const color = p.colorRgb
        ? `<a:solidFill><a:srgbClr val="${p.colorRgb}"/></a:solidFill>`
        : "";
      // ★ One <a:p> per line. The export projection emits "\n" at a block
      // boundary and a raw newline inside <a:t> is just whitespace to
      // PowerPoint. A text with no newline yields the single paragraph it
      // always did, so existing slides are byte-identical.
      return p.text.split("\n").map(
        (line) => `<a:p>
  <a:r>
    <a:rPr lang="en-US" ${rPr} dirty="0">${color}</a:rPr>
    <a:t>${xmlEscape(line)}</a:t>
  </a:r>
</a:p>`,
      );
    })
    .join("");
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/export-ooxml.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/export-pptx.ts src/app/export-ooxml.test.ts
git commit -m "fix(export): split a projected paragraph break into separate PPTX paragraphs"
```

---

## Task 9: XLSX regression pin — no code change (§17 part 4d)

`export-xlsx.ts` already writes `<t xml:space="preserve">` into the shared-strings table, `xmlEscape`
does not touch `\n`, and body cell styles 2 and 3 already carry `wrapText="1"`. The newline therefore
already renders as a line break in Excel. This task pins that so a future style or escaping change
cannot silently take it away.

**Files:**
- Test: `src/app/export-ooxml.test.ts`

- [ ] **Step 1: Write the test**

```ts
describe("XLSX carries a projected paragraph break", () => {
  it("keeps the newline in the shared string and wraps the cell", async () => {
    // No code change backs this — the builder already gets it right. The pin
    // exists because three things have to STAY true: xml:space="preserve" on
    // <t>, xmlEscape leaving \n alone, and wrapText on the body cell styles.
    const blob = buildXlsx([
      { key: "tasks", title: "Tasks", columns: ["description"], rows: [["one\ntwo"]] },
    ]);
    const parts = await unzipBlob(blob);
    expect(parts.get("xl/sharedStrings.xml")!).toContain('<t xml:space="preserve">one\ntwo</t>');
    expect(parts.get("xl/styles.xml")!).toContain('wrapText="1"');
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/app/export-ooxml.test.ts -t "XLSX carries"`
Expected: PASS immediately.

★ **Prove it is not vacuous.** Temporarily change `<t xml:space="preserve">` to `<t>` in
`export-xlsx.ts`'s `sharedStringsXml` and re-run. Expected: FAIL. Revert the change and re-run:
PASS. A pin that cannot fail is not a pin.

- [ ] **Step 3: Commit**

```bash
git add src/app/export-ooxml.test.ts
git commit -m "test(export): pin the XLSX shared-string newline and wrapText

No code change needed — the builder already preserves it. The pin stops a
future escaping or style edit from silently removing paragraph breaks."
```

---

## Task 10: Five description consumers still fuse block boundaries (§23)

All five already import from `./sanitize-html`, which calls DOMPurify — so every one of them is
already DOM-dependent and swapping to `descriptionText` introduces no new constraint. That is the
DOM-safety proof; it does not need re-deriving per site.

**Files:**
- Modify: `src/app/workspace-context.tsx:17,235`
- Modify: `src/app/gantt.tsx:41,251`
- Modify: `src/app/task-row.tsx:7,581`
- Modify: `src/app/task-dedup/dedup.ts:10,62`
- Modify: `src/app/jira-api.ts:16,263`
- Test: `src/app/rich-text-projection.test.ts`

- [ ] **Step 1: Write the failing test**

The five sites are not individually unit-testable without heavy harnesses. Pin the property instead —
a source scan, the same shape as the guards this codebase already uses:

```ts
describe("description consumers use the correct projection", () => {
  const SITES = [
    "workspace-context.tsx",
    "gantt.tsx",
    "task-row.tsx",
    "task-dedup/dedup.ts",
    "jira-api.ts",
  ];

  it("never projects a description with bare htmlToText", () => {
    // ★★ htmlToText strips tags leaving NOTHING in their place, so
    // "<p>a</p><p>b</p>" fuses to "ab". These five read Task.description; every
    // one of them must go through descriptionText, which runs
    // separateBlockBoundaries first.
    //
    // ★ note-log-panel.tsx and note-log.ts also call htmlToText and are CORRECT
    // — they operate on note HTML, not descriptions. They are deliberately not
    // in this list.
    for (const site of SITES) {
      const src = readFileSync(join(import.meta.dirname, site), "utf8");
      expect({ site, hit: /htmlToText\([^)]*\.description/.test(src) }).toEqual({
        site,
        hit: false,
      });
    }
  });
});
```

★ The `toEqual({ site, hit })` shape rather than a bare `toBe(false)` is deliberate: the failure
message then names which file, instead of "expected true to be false" five times over.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/rich-text-projection.test.ts -t "description consumers"`
Expected: FAIL five times, each naming its site.

- [ ] **Step 3: Swap the five call sites**

`src/app/workspace-context.tsx` — line 17 and 235:

```ts
import { descriptionText } from "./rich-text-projection";
```
```ts
          descriptionText(t.description),
```

`src/app/gantt.tsx` — line 41 and 251:

```ts
import { descriptionText } from "./rich-text-projection";
```
```ts
          descriptionText(task.description ?? ""),
```

`src/app/task-row.tsx` — line 7 and 581:

```ts
import { descriptionText } from "./rich-text-projection";
```
```ts
        const preview = descriptionText(task.description);
```

`src/app/task-dedup/dedup.ts` — line 10 and 62. Note this file is in a subdirectory, and it still
needs `sanitizeNoteHtml`:

```ts
import { sanitizeNoteHtml } from "../sanitize-html";
import { descriptionText } from "../rich-text-projection";
```
```ts
    const noteText = descriptionText(tk.description);
```

`src/app/jira-api.ts` — line 16 and 263. This one still needs `plainToHtml`:

```ts
import { plainToHtml } from "./sanitize-html";
import { descriptionText } from "./rich-text-projection";
```
```ts
    description: textToAdf(descriptionText(task.description ?? "")),
```

★ In each file, if `htmlToText` is now unreferenced it MUST come out of the import. CI runs
`--max-warnings=0` — an unused import is a fatal build error, not a warning.

- [ ] **Step 4: Run the test and the affected suites**

```bash
npx vitest run src/app/rich-text-projection.test.ts
npx vitest run src/app/task-dedup src/app/jira-api.test.ts src/app/gantt.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, lint, commit**

```bash
npx tsc --noEmit
npm run lint
npm run test:run
git add src/app/workspace-context.tsx src/app/gantt.tsx src/app/task-row.tsx src/app/task-dedup/dedup.ts src/app/jira-api.ts src/app/rich-text-projection.test.ts
git commit -m "fix: route five Task.description consumers through descriptionText

htmlToText strips tags with nothing in their place, so all five fused every
block boundary: the tasks pane matched \"delayMitigation\" where global search
matched \"delay Mitigation\", and the Jira push wrote the fused text into a
system the app no longer owns. Closes open-followups.md §23."
```

---

## Task 11: Make the raw applied value observable (§20)

**★★ Run Task 14 before this one.** This task's test needs `"description"` in
`INLINE_DESCRIPTORS.task.diffFields`, which Task 14 renames from the dead `"notes"`.

**Files:**
- Modify: `src/app/inline-ai-edit/plan.ts` (`FieldDiff` line 14, the explicit-diff push line 116)
- Test: `src/app/inline-ai-edit/plan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("the applied value stays raw while the preview is projected", () => {
  it("carries the verbatim stored value alongside the projected preview", () => {
    // ★★ The preview is projected to text for display; the value the confirm
    // path applies must stay RAW, or an inline-AI edit writes projected text
    // over the user's formatting. That distinction was a function-local
    // scratchpad no test could reach — projecting it failed nothing.
    //
    // ★ This test asserts the RAW value. A test that re-asserts the preview is
    // projected is exactly what passes with the bug present.
    const richTask = { ...task, description: "<p>old</p>" } as typeof task;
    const richWs = { ...ws, tasks: [richTask] } as typeof ws;
    const plan = describeToolCalls(
      [block("update_task", { id: 42, description: "<p>new</p>" })],
      { task: richTask, ws: richWs },
    );
    const diff = plan.updates.find((u) => u.field === "description");
    expect(diff).toBeDefined();
    expect(diff!.after).toBe("new");
    expect(diff!.raw).toBe("<p>new</p>");
  });
});
```

★ `plan.test.ts` has module-level `task` (id **42**), `ws`, and a `block(name, input)` helper — use
those, not new factories. The id in the tool input must be 42 or the plan rejects it as `unknown-id`.

★★ **Run Task 14 first.** This test needs `"description"` in `INLINE_DESCRIPTORS.task.diffFields`;
until Task 14 renames it the field is still `"notes"`, `diffFields` membership fails, and no update
is produced at all — the test would fail for the wrong reason and prove nothing about `raw`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/inline-ai-edit/plan.test.ts -t "stays raw"`
Expected: FAIL — `Property 'raw' does not exist on type 'FieldDiff'` at typecheck, and `undefined`
at runtime.

- [ ] **Step 3: Add the field to the type**

`src/app/inline-ai-edit/plan.ts` line 14:

```ts
/** `after` is PROJECTED for display; `raw` is the verbatim value that was
 *  accepted, present only on an explicit model-supplied diff.
 *
 *  ★★ The two must not be conflated. A rich field's preview is plain text while
 *  the value the confirm path replays is HTML — projecting the applied value
 *  would write plain text over the user's formatting. `raw` exists so that
 *  invariant is observable; without it, it rested on a comment and a mutation
 *  test proved nothing in the suite caught its removal.
 *
 *  ★ A sanitizer-INDUCED enum reset carries no `raw`: its `after` is a default
 *  enum value that was never projected in the first place. */
export interface FieldDiff { field: string; before: string; after: string; raw?: string }
```

- [ ] **Step 4: Populate it**

Line 116, in the explicit-diff push:

```ts
        plan.updates.push({ field: f, before: forPreview(d.entity, f, before), after: forPreview(d.entity, f, after), raw: after });
```

★ Leave the induced-reset push at line 133 alone — it has no raw/projected distinction to record.

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/app/inline-ai-edit/plan.test.ts`
Expected: PASS.

- [ ] **Step 6: Prove it is not vacuous**

Temporarily change the new field to `raw: forPreview(d.entity, f, after)`.
Run: `npx vitest run src/app/inline-ai-edit/plan.test.ts -t "stays raw"`
Expected: FAIL on `expect(diff!.raw).toBe("<p>new</p>")`, received `"new"`. Revert.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts
git commit -m "test(inline-ai): expose the raw applied value so its invariant is observable

The preview is projected and the applied value must stay raw. That was a
function-local scratchpad no test could reach — mutation-verified as untested.
Closes open-followups.md §20."
```

---

## Task 12: Enter-submit applies the cap it counts (§26)

**Files:**
- Modify: `src/app/raid-edit-modal.tsx:191-199`
- Modify: `src/app/change-edit-modal.tsx:170-182`
- Test: `src/app/raid-edit-modal.test.tsx`, `src/app/change-edit-modal.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/app/raid-edit-modal.test.tsx`:

```ts
it("applies the title cap when the form is submitted with Enter", async () => {
  // ★★ Submitting via Enter inside a text input does NOT fire blur, so the
  // onBlur cap never runs: the value went out uncapped while adj.track counted
  // a truncation and the toast announced it. A CLICK on Save passes either way
  // (mousedown blurs first) — this test must use Enter.
  const onSave = vi.fn();
  const long = "x".repeat(TASK_NAME_MAX + 20);
  render(modalEl({ title: long }, onSave), { wrapper });
  await userEvent.click(titleInput());
  await userEvent.keyboard("{Enter}");
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0][0].title.length).toBe(TASK_NAME_MAX);
});

it("applies the owner cap when the form is submitted with Enter", async () => {
  const onSave = vi.fn();
  const long = "y".repeat(ASSIGNEE_MAX + 20);
  render(modalEl({ title: "ok", owner: long }, onSave), { wrapper });
  await userEvent.click(titleInput());
  await userEvent.keyboard("{Enter}");
  expect(onSave.mock.calls[0][0].owner.length).toBe(ASSIGNEE_MAX);
});
```

In `src/app/change-edit-modal.test.tsx`, the same three for `title`, `requestedBy` and `decisionBy`,
all against `BUDGET_NAME_MAX`, using that file's own render helper.

★ `raid-edit-modal.test.tsx` already has `makeDraft(over)`, `modalEl(over, onSave)` and `wrapper`, and
its tests all read `render(modalEl({ … }), { wrapper })` — match that exactly. `titleInput()` stands
for however the file's existing tests reach the title field; reuse that query rather than adding one.

★ The second test passes a non-empty `title`: `handleSubmit` returns early on a blank title, so
without it `onSave` is never called and the assertion fails for the wrong reason.

★★ Click the field and press Enter. A click on the Save button blurs first, which runs the onBlur cap
and passes with the bug present — the entire point of the test is the path where blur does not fire.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/raid-edit-modal.test.tsx src/app/change-edit-modal.test.tsx -t "with Enter"`
Expected: FAIL — the saved length is `MAX + 20`, not `MAX`.

- [ ] **Step 3: Fix the RAID modal**

Replace lines 191–199 of `src/app/raid-edit-modal.tsx`:

```ts
    // ★★ Cap ON THE SAVED OBJECT, not count-only. Clicking Save blurs the field
    // first so the onBlur cap ran, but Enter inside a text input submits WITHOUT
    // firing blur: the value went out uncapped while this counted a truncation
    // and the toast announced one. The onBlur handlers stay — they keep the
    // draft and its counter honest while the user is still typing.
    const cappedTitle = describeTextCap(draft.title, TASK_NAME_MAX);
    const cappedOwner = describeTextCap(draft.owner ?? "", ASSIGNEE_MAX);
    adj.track(cappedTitle);
    adj.track(cappedOwner);
    const saved: RaidItem = {
      ...draft,
      title: cappedTitle.value.trim(),
      owner: cappedOwner.value.trim() || undefined,
      description: capRich(draft.description) || undefined,
      mitigation: capRich(draft.mitigation) || undefined,
    };
```

★ `.value.trim() || undefined` for `owner` mirrors its own onBlur handler at line 507-508 exactly.
`title` gets `.trim()` with no `|| undefined` — it is required and the submit guard above already
rejects a blank one.

- [ ] **Step 4: Fix the change modal**

Replace lines 170–182 of `src/app/change-edit-modal.tsx`:

```ts
    // ★★ Cap ON THE SAVED OBJECT, not count-only — Enter inside a text input
    // submits without firing blur, so the onBlur caps never ran on that path and
    // the toast announced a truncation the save did not make.
    const cappedTitle = describeTextCap(draft.title, BUDGET_NAME_MAX);
    const cappedRequestedBy = describeTextCap(draft.requestedBy ?? "", BUDGET_NAME_MAX);
    const cappedDecisionBy = describeTextCap(draft.decisionBy ?? "", BUDGET_NAME_MAX);
    adj.track(cappedTitle);
    adj.track(cappedRequestedBy);
    adj.track(cappedDecisionBy);
    const saved: ChangeItem = {
      ...draft,
      title: cappedTitle.value.trim(),
      requestedBy: cappedRequestedBy.value.trim() || undefined,
      decisionBy: cappedDecisionBy.value.trim() || undefined,
      // `description` is required on ChangeItem — an empty body stays "" here
      // rather than collapsing to undefined the way the two optional ones do.
      description: capRich(draft.description),
      impactDescription: capRich(draft.impactDescription) || undefined,
      resolutionNotes: capRich(draft.resolutionNotes) || undefined,
    };
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/raid-edit-modal.test.tsx src/app/change-edit-modal.test.tsx`
Expected: PASS, including every pre-existing test in both files.

- [ ] **Step 6: Typecheck, lint, axe, commit**

```bash
npx tsc --noEmit
npm run lint
npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Changes"
git add src/app/raid-edit-modal.tsx src/app/change-edit-modal.tsx src/app/raid-edit-modal.test.tsx src/app/change-edit-modal.test.tsx
git commit -m "fix(modals): apply the plain-text caps that Enter-submit only counted

Submitting with Enter inside a text input does not fire blur, so the onBlur cap
never ran: the uncapped value was saved while the toast announced a truncation.
Routes the five plain fields through the same saved object the rich fields use.
Closes open-followups.md §26."
```

---

## Task 13: Counter and cap measure one spelling (§27, third claim)

**Files:**
- Modify: `src/app/raid-edit-modal.tsx:420,581`
- Modify: `src/app/change-edit-modal.tsx:356,432,559`
- Test: `src/app/raid-edit-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it("counts a legacy plain value the way the cap will measure it", () => {
  // ★ CharCounter measured the RAW draft while capRich measures the UPGRADED
  // one. Identical for anything reachable today, because every load goes
  // through sanitizeRichText and the editor only emits "<p>...". They diverge
  // wherever descriptionHtml is NOT the identity — a legacy plain value, which
  // HTML_START rejects, so plainToHtml escapes its angle brackets and every
  // "<b>" becomes three VISIBLE characters instead of a stripped inline tag.
  //
  // ★★ The fixture has to be NEAR THE CAP. CharCounter renders a hidden empty
  // span below 80% of max (WARN_RATIO 0.8, TEXTAREA_MAX 5000 → 4000), so a
  // short value shows nothing either way and the test would be vacuous.
  //
  //   raw projection:      "<b>" stripped as an inline TAG        -> 1 char
  //   upgraded projection: "&lt;b&gt;" decoded back to "<b>"      -> 4202 chars
  //
  // So the bug renders NO counter at all and the fix renders one. Presence is
  // the assertion; the number confirms which projection produced it.
  const legacy = "a " + "<b>".repeat(1400);
  render(modalEl({ description: legacy }), { wrapper });
  const counter = document.getElementById("raid-description-counter");
  expect(counter).not.toBeNull();
  expect(counter!.hasAttribute("hidden")).toBe(false);
  expect(counter!.textContent).toContain("4202");
});
```

★ `CharCounter` has no `data-testid` — it renders `<p id={id}>` (or `<span id hidden />` below the
warn threshold). Query by the `id` the modal already passes. Do not add a testid to the primitive
for this test.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/raid-edit-modal.test.tsx -t "legacy plain value"`

Expected: FAIL on `expect(counter!.hasAttribute("hidden")).toBe(false)` — with the bug the counter
measures 1 character, which is under the 4000 warn threshold, so it renders the hidden empty span.

★ Confirm the received length before trusting 4202: `htmlTextLength(descriptionHtml(legacy))` should
be `1 + 1 + 3 × 1400`. If your run disagrees, fix the number rather than the assertion — but do check
that the raw and upgraded projections genuinely differ for the fixture, because a value where
`descriptionHtml` IS the identity makes this test pass with the bug present.

- [ ] **Step 3: Fix all five counter feeds**

`src/app/raid-edit-modal.tsx` line 420:

```tsx
              value={htmlPlainProjection(descriptionHtml(draft.description))}
```

line 581:

```tsx
              value={htmlPlainProjection(descriptionHtml(draft.mitigation))}
```

`src/app/change-edit-modal.tsx` lines 356, 432, 559 respectively:

```tsx
              value={htmlPlainProjection(descriptionHtml(draft.description))}
```
```tsx
              value={htmlPlainProjection(descriptionHtml(draft.impactDescription))}
```
```tsx
              value={htmlPlainProjection(descriptionHtml(draft.resolutionNotes))}
```

★ `descriptionHtml` already handles `undefined` (`(stored ?? "").trim()`), so the `?? ""` goes away.
Confirm `descriptionHtml` is imported in `change-edit-modal.tsx`; it is already imported in
`raid-edit-modal.tsx` at line 51.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/raid-edit-modal.test.tsx src/app/change-edit-modal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/raid-edit-modal.tsx src/app/change-edit-modal.tsx src/app/raid-edit-modal.test.tsx
git commit -m "fix(modals): feed CharCounter the upgraded value the cap measures

The counter measured the raw draft while capRich measured the upgraded one, so
the two could report different budgets for a legacy plain value. Passing
descriptionHtml to both makes the drift structurally impossible.
Closes open-followups.md §27's third claim."
```

---

## Task 14: Comment corrections and the dead descriptor field (§19, §27 claims 1–2)

**Files:**
- Modify: `src/app/rich-text-plain.ts` (`capHtmlText` doc comment, ~line 114)
- Modify: `src/app/rich-text-projection.ts` (`descriptionText` doc comment, ~line 26)
- Modify: `src/app/inline-ai-edit/entity-descriptor.ts:94`
- Modify: `src/app/chat-tools.ts:287`
- Test: `src/app/inline-ai-edit/plan.test.ts`

- [ ] **Step 1: Write the failing test for the descriptor rename**

```ts
it("names the live description field, not the field it was renamed from", () => {
  // ★ Task.notes became Task.description in 0.196.0. The descriptor still said
  // "notes" and worked ONLY because chat-tools accepts it as a write alias —
  // tighten that alias and the inline-AI task editor silently stops being able
  // to write a description.
  expect(INLINE_DESCRIPTORS.task.diffFields).toContain("description");
  expect(INLINE_DESCRIPTORS.task.diffFields).not.toContain("notes");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/inline-ai-edit/plan.test.ts -t "names the live description"`
Expected: FAIL on both assertions.

- [ ] **Step 3: Rename the descriptor entry**

`src/app/inline-ai-edit/entity-descriptor.ts` line 94 — change `"notes"` to `"description"` in
`diffFields`:

```ts
    diffFields: ["taskName", "assignee", "assigneeEmail", "dueDate", "status", "priority", "description", "blockers", "group", "labels"],
```

- [ ] **Step 4: Record the keep-alias decision**

`src/app/chat-tools.ts`, replace the comment at line 287:

```ts
  // `description` is the field; `notes` is its pre-0.196.0 name, kept as a WRITE
  // ALIAS deliberately.
  //
  // ★★ Do NOT retire it. A persisted insight recommendation stores its
  // proposedCalls verbatim and replays them through runTool at apply time, so a
  // proposal generated before the rename can still carry a `notes` key. Dropping
  // the alias would break replay of an already-stored recommendation.
  if (input.description !== undefined || input.notes !== undefined)
```

- [ ] **Step 5: Correct the `capHtmlText` comment**

`src/app/rich-text-plain.ts`, replace `capHtmlText`'s doc comment first paragraph:

```ts
/** Cap by text length. Over cap, the value is projected to text, truncated and
 *  re-wrapped, so the result is always well-formed; formatting is lost on
 *  overflow.
 *
 *  ★ The RAID and Change editors warn first via their own CharCounter.
 *  milestone-edit-modal.tsx has no counter, no describeTextCap and no
 *  useAdjustmentTracker — a >5000-character milestone description loses all
 *  markup silently. That trade-off is accepted at that call site; this shared
 *  comment used to promise a warning only two of the three modals give. */
```

- [ ] **Step 6: Correct the `separateBlockBoundaries` rationale**

`src/app/rich-text-projection.ts`, in `descriptionText`'s doc comment, replace the sentence beginning
"It only removes p/div/br/li/…":

```
 *  ★★ separateBlockBoundaries is safe ONLY IN FRONT OF A STRIP-EVERYTHING PASS.
 *  Deleting a <p> mid-token can re-splice the markup around it — "<a hre<p>f=..."
 *  becomes "<a hre f=..." — which is harmless here only because htmlToText
 *  strips ALL tags and returns text, so no re-spliced tag survives. Composed in
 *  front of sanitizeNoteHtml, which preserves an allow-list, the reasoning
 *  breaks. The old rationale ("never removes a script/style tag, so DOMPurify
 *  still sees every element") was right about the outcome and wrong about why.
```

★ This matters more now than it did: Task 4 added `descriptionTextWithBreaks` as a second caller of
the same function, and it is also in front of `htmlToText`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/app/inline-ai-edit/ src/app/chat-tools.test.ts`
Expected: PASS.

- [ ] **Step 8: Full suite, typecheck, lint, commit**

```bash
npx tsc --noEmit
npm run lint
npm run test:run
git add src/app/inline-ai-edit/entity-descriptor.ts src/app/inline-ai-edit/plan.test.ts src/app/chat-tools.ts src/app/rich-text-plain.ts src/app/rich-text-projection.ts
git commit -m "fix(inline-ai): name the live description field; correct two doc claims

The task descriptor still listed the pre-0.196.0 \"notes\" and worked only via a
write alias, which is now documented as a deliberate keep (a stored insight
recommendation can still replay that key). Also stops capHtmlText promising a
counter the milestone editor does not have, and restates
separateBlockBoundaries' safety as what actually holds it up.
Closes open-followups.md §19 and §27 claims 1-2."
```

---

## Task 15: Release

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`, and the `APP_HIGHLIGHT_KEYS` list

- [ ] **Step 1: Bump the version**

`src/app/version.ts`:

```ts
export const APP_VERSION = "0.210.0";
```
```ts
export const APP_MILESTONE = "Larbalestier";
```

★ Verified unused: `grep -ci "Larbalestier" CHANGELOG.md` returns 0. Re-run it before committing —
codenames must be unique.

- [ ] **Step 2: Add the highlight key**

Append the next `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` and add matching EN + DE strings.

EN: `Exports keep paragraph breaks, and task descriptions export as text instead of raw HTML.`
DE: `Exporte behalten Absätze bei, und Aufgabenbeschreibungen werden als Text statt als rohes HTML exportiert.`

★★ `i18n.de.ts` is **CRLF** and the Edit tool corrupts umlauts and curls double quotes there — it
bites umlaut-free strings too. Patch it with a node utf8 write matching `\r\n`, then grep-verify the
`ä` in "Absätze" survived. A `\n`-anchored replace silently no-ops on this file.

- [ ] **Step 3: Write the CHANGELOG entry**

Add a `## [0.210.0] — 2026-07-29 "Larbalestier"` section covering: export paragraph breaks across
HTML/PDF, DOCX, XLSX and PPTX; task descriptions exported as text; five description consumers moved
onto the correct projection (naming the tasks-pane/global-search disagreement and the Jira push);
numeric entity references decoded; the Enter-submit cap; the counter/cap alignment; the descriptor
rename; the DOM-free import guard.

- [ ] **Step 4: Verify i18n parity and commit**

```bash
npx tsc --noEmit
npm run lint
npm run test:run
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "chore(release): 0.210.0 \"Larbalestier\""
```

---

## Task 16: Update the follow-ups register

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Remove the closed entries and their table rows**

Delete sections §17, §18, §19, §20, §23, §25, §26, §27 and their rows from the summary table at the
top. Follow the file's existing numbering convention — check how earlier closures were handled before
renumbering versus leaving gaps.

- [ ] **Step 2: Narrow §24 rather than deleting it**

§24 is **partly** closed. Rewrite it to say: numeric decimal and hex references now decode, refusing
`&`/`<`/`>`; **named** references beyond the existing small set are still neither decoded nor counted,
so the entry's own `&mdash;` illustration remains accurate. Update its summary-table row to
`open — named tail only`.

- [ ] **Step 3: Note what §22 now knows**

Add one line to §22: §24 shipped separately in 0.210.0 and `golden-workspace.test` held unchanged,
confirming the six rich fields are genuinely empty in the sample — so §22's fixture concern is about
the **plain-text** fields `clipText` reaches, not the rich ones.

- [ ] **Step 4: Leave §16 and §21 untouched**

Both are still fully open. §21's four detail cases are unaffected by this work.

- [ ] **Step 5: Commit**

```bash
git add docs/open-followups.md
git commit -m "docs(followups): close nine items from the 0.209.0 rich-text line

Closes 17, 18, 19, 20, 23, 25, 26, 27. Narrows 24 to its named-reference tail
and records what 22 learned from 24's golden run. 16 and 21 stay open."
```

---

## Final verification

- [ ] `npx tsc --noEmit` — exit 0
- [ ] `npm run lint` — exit 0 (`--max-warnings=0`; an unused import from Task 10 is the likely miss)
- [ ] `npm run test:run` — all green
- [ ] `npm run test:coverage` — floors hold (global lines 92 / funcs 91 / branch 80 / stmts 89)
- [ ] `npx vitest run src/app/golden-workspace.test.ts` — **no fixture diff**
- [ ] `npm run dup:check` — under threshold (the three renderer cell helpers are small and distinct)
- [ ] `npm run size:check` — no new >800-line file, no baselined file grown
- [ ] `npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"` — 5/5 schemes
- [ ] `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Changes"` — Changes is not in
      `A11Y_VIEWS`; if the grep matches nothing, that is expected — eye-verify the change modal instead
- [ ] `npm run build` — prebuild script-docs check passes

★ Run the axe checks against a **fresh isolated server** (`PORT=3100 npm run dev`, stop with
`PORT=3100 npm run stop`), never a long-running reused one — Playwright's `reuseExistingServer`
attaches to a stale `:3000` whose Tailwind has not regenerated, producing phantom failures.
