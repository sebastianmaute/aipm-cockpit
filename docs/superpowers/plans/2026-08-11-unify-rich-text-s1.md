# Unify Rich Text — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the app's two rich-text editors, two allow-lists and two classifier sinks into one of each — a single Tiptap Simple-template editor whose schema, storage allow-list and classifier all agree — closing `docs/open-followups.md` §137.

**Architecture:** One `RICH_ALLOWED_TAGS` array in `sanitize-html.ts` replaces `TEMPLATE_ALLOWED_TAGS` and `NOTE_ALLOWED_TAGS`; one `sanitizeRichHtml` (unwrap semantics, no `KEEP_CONTENT: false`) replaces `sanitizeTemplateHtml` and `sanitizeNoteHtml` at every call site; `html-start.ts` derives one `rich` sink from that same array; `rich-text-editor.tsx` loses its `variant` split and gains the Simple-template extension set with the toolbar extracted to `rich-text-toolbar.tsx`. Task list and alignment are deliberately **out** — they need new HTML attributes, which is slice 2.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Tiptap 3.27.1 (`@tiptap/react`, `@tiptap/starter-kit`, + highlight/subscript/superscript) · DOMPurify 3.4.13 · vitest · Playwright + axe

**Spec:** `docs/superpowers/specs/2026-08-11-unify-rich-text-s1-design.md`

---

## Before you start — read these

Both files are gitignored, so copy anything durable into the repo as you go (Task 14 does this).

1. `AGENTS.md` — the rich-text bullets, the i18n hard constraint, the gate list.
2. `docs/open-followups.md` §137 (the defect), §107 and §114 (why per-sink derivation exists), §115 (`data-*`, slice 2), §55 (hand-rolled toggles), §129 (static Tiptap imports).

**Five landmines that will cost you a build if you skip them:**

- **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits 0 while tests fail. Redirect, echo `$?`, then grep the file.
- **`npm run lint` does NOT reproduce CI.** It is bare `eslint` with no `--max-warnings`. Use `npx eslint --max-warnings=0 src/app`.
- **`i18n.de.ts` is CRLF and the Edit tool corrupts its umlauts.** Patch it with a node utf8 write and match `\r\n`, never `\n`.
- **The file-size ratchet counts `split("\n").length`**, which is `wc -l` **+ 1**. Measure with the node command, not `wc`.
- **Local axe runs at CPU count; CI runs at `workers: 1`.** Always pass `--workers=1` when matching more than one view, or you get `Test timeout` failures that name no rule and are not violations.

---

## File Structure

| file | responsibility | change |
|---|---|---|
| `src/app/sanitize-html.ts` | the DOMPurify storage boundaries | `RICH_ALLOWED_TAGS` + `sanitizeRichHtml` replace two lists and two sanitizers; `DOCUMENT_ALLOWED_TAGS` derives from `RICH_ALLOWED_TAGS` |
| `src/app/html-start.ts` | "is this stored value already HTML?", per sink | `note` + `template` sink members merge into `rich`; `projection`, `document`, `render` untouched |
| `src/app/rich-text-plain.ts` | DOM-free projections + `sanitizeRichText` | `BLOCK_TAG` gains `pre` |
| `src/app/note-log.ts` | note model + the four load-boundary normalizers | `sanitizeRichFields` uses `sanitizeRichHtml` + the `rich` sink — this is where §137 closes |
| `src/app/rich-text-editor.tsx` | the single Tiptap editor | `variant` and `labels` props removed; Simple-template extension set; toolbar delegated |
| `src/app/rich-text-toolbar.tsx` | **NEW** — presentational toolbar | heading `<select>` + `ToggleButton` controls + link buttons |
| `src/app/i18n.ts` / `i18n.de.ts` | EN / DE strings | 11 new toolbar keys |
| 12 editor call sites | consumers | drop `variant` / `labels` |
| `docs/open-followups.md`, `AGENTS.md` | the durable record | §137 closed; the false alignment claim corrected; slices 2 + 3 recorded |

---

## Task 1: Install the three Tiptap extensions

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Confirm what StarterKit already bundles**

Run:
```bash
node -e "console.log(Object.keys(require('./node_modules/@tiptap/starter-kit/package.json').dependencies).join('\n'))"
```
Expected: a list containing `@tiptap/extension-underline`, `-strike`, `-code`, `-code-block`, `-blockquote`, `-heading`, `-horizontal-rule`, `-bullet-list`, `-ordered-list`, `-list-item`, `-list-keymap`, `-link`, `-list`.
It must NOT contain highlight, subscript or superscript — those are what we install.

- [ ] **Step 2: Install exactly three packages, pinned to the installed line**

```bash
npm install @tiptap/extension-highlight@^3.27.1 @tiptap/extension-subscript@^3.27.1 @tiptap/extension-superscript@^3.27.1
```

- [ ] **Step 3: Run the blocking dependency gate**

Run: `npm audit --omit=dev; echo "EXIT=$?"`
Expected: `EXIT=0`. A transitive advisory here fails CI's `dependency-audit` job, not the build — stop and report if it is non-zero.

- [ ] **Step 4: Verify the app still builds**

Run: `npx tsc --noEmit; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add tiptap highlight, subscript, superscript for the unified editor"
```

---

## Task 2: `RICH_ALLOWED_TAGS` + `sanitizeRichHtml`

**Files:**
- Modify: `src/app/sanitize-html.ts`
- Test: `src/app/sanitize-html.test.ts`

- [ ] **Step 1: Write the failing tests — the §137 measured losses, asserted lossless**

Append to `src/app/sanitize-html.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RICH_ALLOWED_TAGS, sanitizeRichHtml } from "./sanitize-html";

describe("sanitizeRichHtml — the §137 losses become lossless", () => {
  // Each input is one of the five cases measured in open-followups §137 through
  // the real sanitizeNoteHtml, where KEEP_CONTENT:false deleted the WORD along
  // with its tag. Assert the surviving WORD, never merely "no error" — a test
  // that asserts absence passes vacuously.
  it("keeps heading text", () => {
    expect(sanitizeRichHtml("<h1>Title</h1><p>body</p>")).toContain("Title");
  });

  it("keeps underlined text", () => {
    expect(sanitizeRichHtml("<u>underlined</u> rest")).toContain("underlined");
  });

  it("keeps blockquote text", () => {
    expect(sanitizeRichHtml("<blockquote>quoted</blockquote>")).toContain("quoted");
  });

  it("keeps mid-sentence underline without eating the sentence", () => {
    expect(sanitizeRichHtml("<p>plain <u>under</u> tail</p>")).toContain("under");
  });

  it("unwraps an UNLISTED tag but keeps its words", () => {
    // h5 is deliberately not on the list (headings 1-4 only). Unwrap, never delete.
    const out = sanitizeRichHtml("<p>a</p><h5>Sub</h5>");
    expect(out).toContain("Sub");
    expect(out).not.toContain("<h5>");
  });

  it("still strips script and its content", () => {
    const out = sanitizeRichHtml("<p>ok</p><script>alert(1)</script>");
    expect(out).toContain("ok");
    expect(out).not.toContain("alert");
    expect(out).not.toContain("<script");
  });

  it("still strips a javascript: href", () => {
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
  });

  it("keeps an https href", () => {
    expect(sanitizeRichHtml('<a href="https://example.com/a">x</a>')).toContain('href="https://example.com/a"');
  });

  it("is idempotent on already-clean html", () => {
    const clean = sanitizeRichHtml("<p>a <strong>b</strong></p>");
    expect(sanitizeRichHtml(clean)).toBe(clean);
  });

  it("admits every tag the Simple-template toolbar can produce", () => {
    for (const tag of ["p", "br", "hr", "strong", "em", "u", "s", "code", "pre",
                       "blockquote", "h1", "h2", "h3", "h4", "ul", "ol", "li",
                       "mark", "sub", "sup", "a"]) {
      expect(RICH_ALLOWED_TAGS).toContain(tag);
    }
  });

  it("does NOT admit headings 5 and 6", () => {
    expect(RICH_ALLOWED_TAGS).not.toContain("h5");
    expect(RICH_ALLOWED_TAGS).not.toContain("h6");
  });

  it("carries no #text pseudo-entry", () => {
    // NOTE_ALLOWED_TAGS carried "#text"; it is not a tag name and htmlStartRe drops it.
    expect(RICH_ALLOWED_TAGS).not.toContain("#text");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/sanitize-html.test.ts --reporter=dot; echo "EXIT=$?"`
Expected: `EXIT=1`, failing on `sanitizeRichHtml is not a function` / `RICH_ALLOWED_TAGS` undefined.

> `--reporter=basic` does NOT exist in vitest 4 — it errors at startup and reads like a broken run. Use `--reporter=dot`.

- [ ] **Step 3: Implement**

In `src/app/sanitize-html.ts`, replace the `TEMPLATE_ALLOWED_TAGS` declaration and its
`sanitizeTemplateHtml` function with:

```ts
/** THE rich-text allow-list — one array for every rich surface in the app: the
 *  seven rich entity fields (`Task.description` + the six in `AI_RICH_FIELDS`),
 *  note-log entries, the dashboard narrative, comm templates and meeting reports.
 *
 *  ★★★ It replaced TEMPLATE_ALLOWED_TAGS (11 tags) and NOTE_ALLOWED_TAGS (8, at
 *  KEEP_CONTENT:false). Those two disagreed with each other AND with the editor
 *  schema, and the narrow one DELETED the text of anything the wide one admitted —
 *  on every JSON and IndexedDB load, with no human and no save involved
 *  (open-followups §137). One list is the closure; do not add a second.
 *
 *  ★ EXPORTED so html-start.ts derives the `rich` sink's classifier from the same
 *  array this sanitizes against. A classifier narrower than its sink escapes a
 *  value the sink would have kept (§107).
 *
 *  ★ `hr` is here although no toolbar control produces it: DOCUMENT_ALLOWED_TAGS
 *  derives from this array, and documents have always allowed `hr`. Removing it
 *  would silently narrow documents.
 *
 *  ★ Headings stop at h4 — that is the editor's schema (`levels: [1,2,3,4]`).
 *  An h5/h6 arriving from legacy data UNWRAPS and keeps its words. */
export const RICH_ALLOWED_TAGS = [
  "p", "br", "hr",
  "strong", "em", "u", "s", "code", "mark", "sub", "sup",
  "pre", "blockquote",
  "h1", "h2", "h3", "h4",
  "ul", "ol", "li",
  "a",
];
const ALLOWED_ATTR = ["href", "target", "rel"];

/** THE storage-boundary sanitizer for every rich surface except documents.
 *
 *  ★★★ KEEP_CONTENT stays at DOMPurify's DEFAULT (unwrap, keep the words). The
 *  retired sanitizeNoteHtml set it to `false`, which deleted an unlisted element
 *  TOGETHER WITH ITS TEXT — that is the §137 data loss. Losing formatting beats
 *  losing words, and it is now one policy across every sink. */
export function sanitizeRichHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: RICH_ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
  });
}
```

Leave `sanitizeNoteHtml` and `NOTE_ALLOWED_TAGS` in place for now — Task 7 deletes them once every
call site has moved. Keep `sanitizeTemplateHtml` too, as a one-line delegation so the tree stays green
between tasks:

```ts
/** @deprecated Transitional shim — Task 7 deletes this and its call sites. */
export function sanitizeTemplateHtml(html: string): string {
  return sanitizeRichHtml(html);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/sanitize-html.test.ts --reporter=dot; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 5: Commit**

```bash
git add src/app/sanitize-html.ts src/app/sanitize-html.test.ts
git commit -m "feat(sanitize): add RICH_ALLOWED_TAGS and sanitizeRichHtml with unwrap semantics"
```

---

## Task 3: Derive `DOCUMENT_ALLOWED_TAGS` from `RICH_ALLOWED_TAGS`

**Files:**
- Modify: `src/app/sanitize-html.ts`
- Test: `src/app/sanitize-html.test.ts`

- [ ] **Step 1: Write the failing test — the document list may only WIDEN**

```ts
import { DOCUMENT_ALLOWED_TAGS, RICH_ALLOWED_TAGS } from "./sanitize-html";

describe("DOCUMENT_ALLOWED_TAGS derives from RICH_ALLOWED_TAGS", () => {
  it("is a strict superset of the rich list", () => {
    for (const tag of RICH_ALLOWED_TAGS) expect(DOCUMENT_ALLOWED_TAGS).toContain(tag);
  });

  it("adds exactly img and nothing else", () => {
    const extra = DOCUMENT_ALLOWED_TAGS.filter((t) => !RICH_ALLOWED_TAGS.includes(t));
    expect(extra).toEqual(["img"]);
  });

  it("gained h3 and h4 versus the pre-slice document list and LOST nothing", () => {
    // Pre-slice DOCUMENT_ALLOWED_TAGS, spelled literally so the assertion cannot
    // drift with the code it guards.
    const before = ["p","br","strong","em","u","h1","h2","ul","ol","li","a",
                    "s","code","pre","blockquote","hr","mark","sub","sup","img"];
    const lost = before.filter((t) => !DOCUMENT_ALLOWED_TAGS.includes(t));
    const gained = DOCUMENT_ALLOWED_TAGS.filter((t) => !before.includes(t));
    expect(lost).toEqual([]);
    expect(gained.sort()).toEqual(["h3", "h4"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/sanitize-html.test.ts -t "derives from" --reporter=dot; echo "EXIT=$?"`
Expected: `EXIT=1` — `gained` is `[]` because the document list still spreads the old template list.

- [ ] **Step 3: Implement**

```ts
export const DOCUMENT_ALLOWED_TAGS = [...RICH_ALLOWED_TAGS, "img"];
```

Delete the now-duplicated `"s", "code", "pre", "blockquote", "hr", "mark", "sub", "sup"` entries — they
are all in `RICH_ALLOWED_TAGS`. Keep every ★ comment on this constant: the `img`/`data-asset-id`
reasoning, the `DATA_URI_TAGS` warning and the `ALLOW_DATA_ATTR: false` note are all still true and are
all still the only record of why `sanitizeDocumentHtml` remains a separate function.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/sanitize-html.test.ts --reporter=dot; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 5: Commit**

```bash
git add src/app/sanitize-html.ts src/app/sanitize-html.test.ts
git commit -m "refactor(sanitize): derive DOCUMENT_ALLOWED_TAGS from RICH_ALLOWED_TAGS"
```

---

## Task 4: One `rich` classifier sink

**Files:**
- Modify: `src/app/html-start.ts`
- Test: `src/app/html-start.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { isHtmlStart, SINK_TAGS } from "./html-start";
import { RICH_ALLOWED_TAGS } from "./sanitize-html";

describe("the rich sink", () => {
  it("derives from RICH_ALLOWED_TAGS", () => {
    expect(SINK_TAGS.rich).toBe(RICH_ALLOWED_TAGS);
  });

  it("recognises a leading heading, which the retired note sink escaped", () => {
    expect(isHtmlStart("<h1>Title</h1><p>body</p>", "rich")).toBe(true);
  });

  it("recognises a leading blockquote", () => {
    expect(isHtmlStart("<blockquote>quoted</blockquote>", "rich")).toBe(true);
  });

  it("still rejects plain prose", () => {
    expect(isHtmlStart("risk: vendor delay", "rich")).toBe(false);
  });

  it("still rejects an unterminated tag-shaped prefix", () => {
    expect(isHtmlStart("<li 3 items", "rich")).toBe(false);
  });

  it("still rejects a leading CLOSING tag", () => {
    expect(isHtmlStart("</p> means close", "rich")).toBe(false);
  });

  it("keeps projection as its OWN member, not an alias of document", () => {
    // They hold the same array today by CHOICE, not by derivation: projection is
    // not a sink at all (every tag is stripped downstream), so it takes the
    // WIDEST list as a deliberate §107-vs-§32 trade. Folding it deletes that
    // reasoning and couples the trade to a list slice 2 will widen.
    expect(Object.keys(SINK_TAGS).sort()).toEqual(["document", "projection", "rich"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/html-start.test.ts --reporter=dot; echo "EXIT=$?"`
Expected: `EXIT=1` — `SINK_TAGS.rich` is undefined.

- [ ] **Step 3: Implement**

In `src/app/html-start.ts`:

```ts
import { DOCUMENT_ALLOWED_TAGS, RICH_ALLOWED_TAGS } from "./sanitize-html";

/** The three sinks whose classifier is DERIVED from an allow-list.
 *
 *  ★★★ `note` and `template` MERGED into `rich`. They were two lists over one
 *  question, and the narrow one deleted text the wide one admitted — §137. One
 *  list, one sink; do not reintroduce a second.
 *
 *  ★★★ "projection" is NOT a sink — keep it a separate member. [KEEP THE ENTIRE
 *  EXISTING COMMENT BLOCK HERE VERBATIM: it records the §107-vs-§32 trade and is
 *  the only reason the widest list is correct there.] */
export type DerivedSink = "rich" | "document" | "projection";

export type RichTextSink = DerivedSink | "render";

export const SINK_TAGS: Record<DerivedSink, readonly string[]> = {
  rich: RICH_ALLOWED_TAGS,
  document: DOCUMENT_ALLOWED_TAGS,
  projection: DOCUMENT_ALLOWED_TAGS,
};

const SINK_RE: Record<RichTextSink, RegExp> = {
  rich: htmlStartRe(SINK_TAGS.rich),
  document: htmlStartRe(SINK_TAGS.document),
  projection: htmlStartRe(SINK_TAGS.projection),
  render: CONTAINS_TAG,
};
```

Keep the whole `render` comment block unchanged — it is the record of why that sink has no list.

- [ ] **Step 4: Run to verify it passes (and that the tree is now red elsewhere)**

Run: `npx vitest run src/app/html-start.test.ts --reporter=dot; echo "EXIT=$?"` → `EXIT=0`
Run: `npx tsc --noEmit; echo "EXIT=$?"` → `EXIT=1`, listing every `"note"` / `"template"` sink argument.
That list is Task 6's worklist. Copy it.

- [ ] **Step 5: Commit**

```bash
git add src/app/html-start.ts src/app/html-start.test.ts
git commit -m "refactor(html-start): merge the note and template sinks into one rich sink"
```

---

## Task 5: `BLOCK_TAG` gains `pre`

**Files:**
- Modify: `src/app/rich-text-plain.ts`
- Test: `src/app/rich-text-plain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { separateBlockBoundaries } from "./rich-text-plain";

describe("BLOCK_TAG covers pre", () => {
  it("does not fuse a code block into its neighbour", () => {
    // Without `pre` in BLOCK_TAG the projection produced "aboiledb" style fusion:
    // the block boundary vanished and two paragraphs read as one word.
    const out = separateBlockBoundaries("<p>before</p><pre>code</pre><p>after</p>", " ");
    expect(out).not.toMatch(/beforecode|codeafter/);
  });

  it("emits a newline boundary for a code block in the breaks projection", () => {
    const out = separateBlockBoundaries("<p>before</p><pre>code</pre>", "\n");
    expect(out).toContain("\n");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/rich-text-plain.test.ts -t "BLOCK_TAG" --reporter=dot; echo "EXIT=$?"`
Expected: `EXIT=1` — `beforecode` matched.

- [ ] **Step 3: Implement**

```ts
const BLOCK_TAG = /<\/?(?:p|div|br|li|ul|ol|pre|h[1-6]|blockquote|tr|td|th)\b[^>]*>/gi;
```

Do NOT widen `separateBlockBoundaries`' `sep` parameter — it stays `" " | "\n"` because it lands in a
`String.replace` REPLACEMENT position where `` $` `` and `$&` are special.

- [ ] **Step 4: Run the full projection + golden suites**

```bash
npx vitest run src/app/rich-text-plain.test.ts src/app/rich-text-projection.test.ts src/app/golden-workspace.test.ts --reporter=dot; echo "EXIT=$?"
```
Expected: `EXIT=0`. If a golden moved, a fixture contains `<pre>` — find out why before regenerating.
**Never regenerate a golden to mask a diff.**

- [ ] **Step 5: Commit**

```bash
git add src/app/rich-text-plain.ts src/app/rich-text-plain.test.ts
git commit -m "fix(rich-text): treat pre as a block boundary in both projections"
```

---

## Task 6: Move every sink argument to `"rich"`

**Files:**
- Modify: `src/app/change-edit-modal.tsx` (7), `src/app/raid-edit-modal.tsx` (5), `src/app/milestone-edit-modal.tsx` (2), `src/app/use-resource-planner.ts` (1), `src/app/note-log.ts` (1), `src/app/ai-rich-text.ts` (2), `src/app/sanitize-records.ts` (6), `src/app/templates.ts` (1)

- [ ] **Step 1: Enumerate the call sites**

```bash
grep -rn 'descriptionHtml([^)]*"\(note\|template\)"' src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."
grep -rn 'sanitizeRichText([^)]*"\(note\|template\)"' src/app --include="*.ts" | grep -v "\.test\."
```
Expected: 16 `descriptionHtml` hits and 9 `sanitizeRichText` hits, in the files listed above.

- [ ] **Step 2: Replace the sink string at each site**

Every `"note"` and `"template"` sink argument becomes `"rich"`. Nothing else on those lines changes.
`"projection"`, `"document"` and `"render"` arguments are untouched.

Two sites deserve a look rather than a blind replace:
- `src/app/templates.ts:155` — `sanitizeSeedTask`. This file is in `scripts/generate-sample-workspace.ts`'s import graph, so it must stay **DOM-free**. `"rich"` only widens a regex; it introduces no DOMPurify call. Do not "complete the sweep" by importing a sanitizer here — open-followups §36(a).
- `src/app/use-resource-planner.ts:449` — reads `item.mitigation ?? item.description`. Same mechanical change.

- [ ] **Step 3: Verify the type error is gone**

Run: `npx tsc --noEmit; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 4: Run the affected suites**

```bash
npx vitest run src/app/sanitize-records.test.ts src/app/templates.test.ts src/app/ai-rich-text.test.ts --reporter=dot; echo "EXIT=$?"
```
Expected: `EXIT=0`

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "refactor(rich-text): route every entity sink argument to rich"
```

---

## Task 7: Retire `sanitizeNoteHtml` and `sanitizeTemplateHtml`

**Files:**
- Modify: `src/app/sanitize-html.ts`, plus the 14 non-test call sites the sweep finds
- Test: `src/app/sanitize-html.test.ts`

- [ ] **Step 1: Enumerate every call site**

```bash
grep -rn "sanitizeTemplateHtml\|sanitizeNoteHtml" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."
```
Expected non-comment call sites: `ai-rich-text.ts`, `comm-send-preview-modal.tsx`, `meeting-report-panel.tsx`, `use-action-center-handlers.ts`, `use-meeting-report-actions.ts` (×2), `use-task-row-handlers.ts`, `rich-text-editor.tsx`, `bulk-operations-helpers.ts`, `dashboard-sections/dashboard-narrative.tsx`, `note-log.ts` (×3), `rich-text-view.tsx`, `task-dedup/dedup.ts`, `task-inline-patch.ts`, `use-task-submit.ts`.

★ Many hits are prose in comments. Those get **rewritten**, not renamed — the comments explain a
`KEEP_CONTENT: false` policy that no longer exists.

- [ ] **Step 2: Write the failing test that the old names are gone**

```ts
import * as sanitizeHtml from "./sanitize-html";

describe("one sanitizer, not three", () => {
  it("exports no sanitizeNoteHtml", () => {
    expect("sanitizeNoteHtml" in sanitizeHtml).toBe(false);
  });
  it("exports no sanitizeTemplateHtml", () => {
    expect("sanitizeTemplateHtml" in sanitizeHtml).toBe(false);
  });
  it("exports no NOTE_ALLOWED_TAGS or TEMPLATE_ALLOWED_TAGS", () => {
    expect("NOTE_ALLOWED_TAGS" in sanitizeHtml).toBe(false);
    expect("TEMPLATE_ALLOWED_TAGS" in sanitizeHtml).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/app/sanitize-html.test.ts -t "one sanitizer" --reporter=dot; echo "EXIT=$?"`
Expected: `EXIT=1`

- [ ] **Step 4: Replace every call site, then delete the old exports**

Mechanical: `sanitizeTemplateHtml(x)` → `sanitizeRichHtml(x)`, `sanitizeNoteHtml(x)` → `sanitizeRichHtml(x)`, and fix each import. Then delete from `sanitize-html.ts`:
- the `sanitizeTemplateHtml` shim added in Task 2
- `NOTE_ALLOWED_TAGS`, `NOTE_ALLOWED_ATTR` and `sanitizeNoteHtml`

**Do not leave an alias.** An alias is a fourth list waiting to drift — the exact failure §107, §114 and §137 each record.

Update the file header comment: it says "Three DOMPurify sanitizers" and names all three. It is now two — `sanitizeRichHtml` and `sanitizeDocumentHtml` — and the reason the second still exists is `img` + `data-asset-id` + `ALLOW_DATA_ATTR: false`.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/sanitize-html.test.ts --reporter=dot; echo "EXIT=$?"
```
Expected: `EXIT=0` for both.

- [ ] **Step 6: Commit**

```bash
git add src/app
git commit -m "refactor(sanitize): retire sanitizeNoteHtml and sanitizeTemplateHtml"
```

---

## Task 8: Close §137 at the load boundary

**Files:**
- Modify: `src/app/note-log.ts`
- Test: `src/app/note-log.test.ts`

`sanitizeRichFields` is where §137 actually bites: all four per-entity normalizers are this one function
with a different field list, and both whole-object load boundaries (`jsonToWorkspace`, the IndexedDB
load) call all four. Task 7 already swapped the sanitizer name; this task proves the defect is closed
and pins it.

- [ ] **Step 1: Write the failing tests — the three §137 load-path measurements**

```ts
import { describe, expect, it } from "vitest";
import {
  sanitizeChangeRichFields,
  sanitizeMilestoneRichFields,
  sanitizeNoteFields,
  sanitizeRaidRichFields,
} from "./note-log";

describe("§137 — the load boundary no longer destroys rich text", () => {
  it("keeps a MID-VALUE heading's words (raid description)", () => {
    const out = sanitizeRaidRichFields({ description: "<p>Intro</p><h1>Risk</h1><p>detail</p>" });
    expect(out.description).toContain("Risk");
  });

  it("keeps a MID-VALUE underline's words (raid mitigation)", () => {
    const out = sanitizeRaidRichFields({ mitigation: "<p>a</p><u>b</u>" });
    expect(out.mitigation).toContain("b");
  });

  it("keeps a MID-VALUE underline's words (change impactDescription)", () => {
    const out = sanitizeChangeRichFields({ impactDescription: "<p>a</p><u>b</u>" });
    expect(out.impactDescription).toContain("b");
  });

  it("keeps a LEADING heading as real markup instead of escaping it", () => {
    // Before: the note sink classified this as plain text and escaped the WHOLE
    // value, so descriptionText read back "<h1>Title</h1><p>body</p>" as prose.
    const out = sanitizeRaidRichFields({ description: "<h1>Title</h1><p>body</p>" });
    expect(out.description).not.toContain("&lt;h1&gt;");
    expect(out.description).toContain("Title");
  });

  it("is stable across two loads", () => {
    const once = sanitizeRaidRichFields({ description: "<h1>Title</h1><p>body</p>" });
    const twice = sanitizeRaidRichFields({ description: once.description! });
    expect(twice.description).toBe(once.description);
  });

  it("still UPGRADES legacy plain text without eating tag-shaped fragments", () => {
    // The escape-before-sanitize order is load-bearing and unchanged.
    const out = sanitizeRaidRichFields({ description: "risk: <b>vendor</b> delay" });
    expect(out.description).toContain("vendor");
  });

  it("applies to milestones and tasks too, not just raid", () => {
    expect(sanitizeMilestoneRichFields({ description: "<p>a</p><h2>M</h2>" }).description).toContain("M");
    expect(sanitizeNoteFields({ description: "<p>a</p><h2>T</h2>" }).description).toContain("T");
  });

  it("returns the entity BY REFERENCE when it carries no rich field", () => {
    // Several byte-stability tests depend on this identity.
    const entity = { id: 1 } as never;
    expect(sanitizeRaidRichFields(entity)).toBe(entity);
  });
});
```

- [ ] **Step 2: Run — most should already PASS after Task 7**

Run: `npx vitest run src/app/note-log.test.ts -t "§137" --reporter=dot; echo "EXIT=$?"`
Expected: `EXIT=0`.

★★ If they all pass first try, **prove they are not vacuous** before moving on: temporarily change
`patch[field] = sanitizeRichHtml(descriptionHtml(value, "rich"))` back to the old
`sanitizeNoteHtml(descriptionHtml(value, "note"))` shape by inlining a `KEEP_CONTENT: false` DOMPurify
call, re-run, and confirm the suite goes RED. Revert immediately. A test asserting "the word survived"
is worthless if it passes against the broken code.

- [ ] **Step 3: Rewrite the stale comment block**

The `sanitizeRichFields` docstring explains `KEEP_CONTENT: false` and the escape-before-sanitize order.
The second half is still true and must stay. The first half is now wrong. Replace the
`KEEP_CONTENT`-specific paragraph with:

```
 *  ★★★ The escape-before-sanitize order is STILL load-bearing, for a different
 *  reason than it used to be. It used to prevent KEEP_CONTENT:false from deleting
 *  a tag-shaped fragment along with its text; sanitizeRichHtml unwraps instead, so
 *  that specific loss is gone (open-followups §137). What survives is the §32
 *  direction: sanitizing plain text first would still EAT the "<b>" fragment out
 *  of "risk: <b>vendor</b> delay" rather than showing it. Escaping first leaves no
 *  tag for DOMPurify to touch; an already-rich value passes descriptionHtml
 *  untouched and is sanitized exactly as before.
```

Keep the DOM-BOUND paragraph verbatim — `sanitizeRichHtml` is still DOMPurify and still must not
become reachable from a codec, an entity sanitizer or anything under `scripts/`.

- [ ] **Step 4: Run the load-path suites**

```bash
npx vitest run src/app/note-log.test.ts src/app/workspace.test.ts src/app/browser-backend.test.ts src/app/golden-workspace.test.ts --reporter=dot; echo "EXIT=$?"
```
Expected: `EXIT=0`

- [ ] **Step 5: Commit**

```bash
git add src/app/note-log.ts src/app/note-log.test.ts
git commit -m "fix(rich-text): stop the load boundary deleting heading and underline text (§137)"
```

---

## Task 9: i18n keys for the new toolbar controls

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

Existing keys are reused as-is: `commTplBold`, `commTplItalic`, `commTplUnderline`, `commTplHeading1`,
`commTplHeading2`, `commTplBulletList`, `commTplNumberedList`, `commTplLink`, `commTplUnlink`,
`commTplLinkPrompt`. The `commTpl` prefix is now historical — the editor is shared by five surfaces.
Renaming ten keys is churn in a CRLF file with umlauts; new keys keep the prefix for one coherent set.

- [ ] **Step 1: Add the eleven EN keys**

In `src/app/i18n.ts`, beside the existing `commTpl*` toolbar keys:

```ts
  commTplHeading3: "Heading 3",
  commTplHeading4: "Heading 4",
  commTplHeadingLevel: "Text style",
  commTplParagraph: "Normal text",
  commTplStrike: "Strikethrough",
  commTplCode: "Inline code",
  commTplCodeBlock: "Code block",
  commTplBlockquote: "Quote",
  commTplHighlight: "Highlight",
  commTplSuperscript: "Superscript",
  commTplSubscript: "Subscript",
```

- [ ] **Step 2: Add the eleven DE keys with a node utf8 write**

**Do not use the Edit tool on `i18n.de.ts`** — it corrupts umlauts and curls double quotes, and the
file is CRLF so an `\n` anchor silently no-ops. Write a throwaway script:

```js
// .demo-tmp/patch-de.mjs
import { readFileSync, writeFileSync } from "node:fs";
const path = "src/app/i18n.de.ts";
const src = readFileSync(path, "utf8");
const anchor = '  commTplUnlink:';               // an existing key, matched WITH its CRLF
const addition = [
  '  commTplHeading3: "Überschrift 3",',
  '  commTplHeading4: "Überschrift 4",',
  '  commTplHeadingLevel: "Textstil",',
  '  commTplParagraph: "Normaler Text",',
  '  commTplStrike: "Durchgestrichen",',
  '  commTplCode: "Inline-Code",',
  '  commTplCodeBlock: "Codeblock",',
  '  commTplBlockquote: "Zitat",',
  '  commTplHighlight: "Hervorhebung",',
  '  commTplSuperscript: "Hochgestellt",',
  '  commTplSubscript: "Tiefgestellt",',
].join("\r\n") + "\r\n";
if (!src.includes(anchor)) throw new Error("anchor not found — do not guess, re-read the file");
writeFileSync(path, src.replace(anchor, addition + anchor), "utf8");
```

Run: `node .demo-tmp/patch-de.mjs && rm .demo-tmp/patch-de.mjs`

- [ ] **Step 3: Verify parity and encoding**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts --reporter=dot; echo "EXIT=$?"
```
Expected: `EXIT=0` for both. tsc enforces EN/DE key parity; `i18n-encoding` bans ASCII substitutions
like `Ueberschrift`. If it fails, the umlauts were written as escapes — rewrite, do not "fix" the test.

- [ ] **Step 4: Eyeball the bytes**

Run: `grep -c "Überschrift" src/app/i18n.de.ts`
Expected: `2`. Anything else means the write mangled the encoding.

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(i18n): add toolbar labels for the unified rich-text editor"
```

---

## Task 10: `rich-text-toolbar.tsx`

**Files:**
- Create: `src/app/rich-text-toolbar.tsx`
- Test: `src/app/rich-text-toolbar.test.tsx`

Presentational: it takes a live `Editor` and a `Lang` and renders controls. No sanitizer, no state.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RichTextToolbar } from "./rich-text-toolbar";

// A minimal Editor stub — the toolbar must not reach past isActive() and chain().
function makeEditor(active: Record<string, boolean> = {}) {
  const run = vi.fn();
  const chain = {
    focus: () => chain,
    toggleBold: () => chain, toggleItalic: () => chain, toggleUnderline: () => chain,
    toggleStrike: () => chain, toggleCode: () => chain, toggleHighlight: () => chain,
    toggleSuperscript: () => chain, toggleSubscript: () => chain,
    toggleBulletList: () => chain, toggleOrderedList: () => chain,
    toggleBlockquote: () => chain, toggleCodeBlock: () => chain,
    setParagraph: () => chain, toggleHeading: () => chain,
    unsetLink: () => chain, extendMarkRange: () => chain, setLink: () => chain,
    run,
  };
  return {
    run,
    editor: {
      isActive: (name: string, attrs?: { level?: number }) =>
        active[attrs?.level ? `${name}${attrs.level}` : name] ?? false,
      chain: () => chain,
    } as never,
  };
}

describe("RichTextToolbar", () => {
  it("renders every mark control with an accessible name", async () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    for (const name of ["Bold", "Italic", "Underline", "Strikethrough", "Inline code",
                        "Highlight", "Superscript", "Subscript"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("renders every block control with an accessible name", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    for (const name of ["Bullet list", "Numbered list", "Quote", "Code block"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("gives the heading select a real accessible name, not a visible span", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    // placeholder/adjacent text is NOT an accessible name; axe cannot see a
    // <select> at all for 2.5.3, so this unit test is the only detector.
    expect(screen.getByRole("combobox", { name: "Text style" })).toBeTruthy();
  });

  it("offers Normal plus headings 1-4 and nothing else", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    const opts = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(["Normal text", "Heading 1", "Heading 2", "Heading 3", "Heading 4"]);
  });

  it("reports pressed state through aria-pressed", () => {
    const { editor } = makeEditor({ bold: true });
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows a NON-COLOUR pressed marker, present in both states", () => {
    // WCAG 1.4.1: the pressed accent measures 1.03-1.22:1 in the three dark
    // schemes, so colour alone cannot carry the state. ToggleButton renders the
    // marker in BOTH states (invisible when off) so the button keeps one width.
    const { editor } = makeEditor({ bold: true });
    const { container } = render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    expect(container.querySelectorAll("[data-pressed-marker]").length).toBeGreaterThan(1);
  });

  it("runs the bold command on click", async () => {
    const { editor, run } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(run).toHaveBeenCalled();
  });

  it("delegates the link control to onAddLink", async () => {
    const { editor } = makeEditor();
    const onAddLink = vi.fn();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={onAddLink} />);
    await userEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(onAddLink).toHaveBeenCalledTimes(1);
  });

  it("does not steal focus from the editor surface", () => {
    // Without preventDefault on mousedown, a commit-on-blur consumer remounts
    // the editor between mousedown and mouseup and no click is ever dispatched.
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" onAddLink={() => {}} />);
    const btn = screen.getByRole("button", { name: "Bold" });
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/rich-text-toolbar.test.tsx --reporter=dot; echo "EXIT=$?"`
Expected: `EXIT=1` — module not found.

- [ ] **Step 3: Implement**

```tsx
"use client";
import type { Editor } from "@tiptap/react";
import { Select } from "./form-controls";
import { ToggleButton } from "./toggle-button";
import { Button } from "./button";
import { t, type Lang, type TranslationKey } from "./i18n";

// The single rich-text toolbar. Presentational: an Editor and a Lang in, JSX out.
//
// ★★★ Every stateful control is the shared ToggleButton, NEVER a hand-rolled
// aria-pressed button. The one this replaced was among the thirteen offenders in
// open-followups §55: its ON state rode colour alone, which measures 1.03-1.22:1
// against the unpressed border in the three DARK schemes and so fails WCAG 1.4.1.
// ToggleButton carries a non-colour data-pressed-marker glyph. axe has no rule
// for colour-as-sole-cue, so the unit test is the only coverage.
//
// ★ Task list and text alignment are deliberately ABSENT. Both need new HTML
// attributes, which is a shared security boundary (SAFE_URI_REGEXP and
// ALLOW_DATA_ATTR) and gets its own slice + security review. Do not add a
// control here without widening the sanitizer first.

type MarkSpec = { key: TranslationKey; name: string; run: (e: Editor) => void };

const MARKS: readonly MarkSpec[] = [
  { key: "commTplBold", name: "bold", run: (e) => e.chain().focus().toggleBold().run() },
  { key: "commTplItalic", name: "italic", run: (e) => e.chain().focus().toggleItalic().run() },
  { key: "commTplUnderline", name: "underline", run: (e) => e.chain().focus().toggleUnderline().run() },
  { key: "commTplStrike", name: "strike", run: (e) => e.chain().focus().toggleStrike().run() },
  { key: "commTplCode", name: "code", run: (e) => e.chain().focus().toggleCode().run() },
  { key: "commTplHighlight", name: "highlight", run: (e) => e.chain().focus().toggleHighlight().run() },
  { key: "commTplSuperscript", name: "superscript", run: (e) => e.chain().focus().toggleSuperscript().run() },
  { key: "commTplSubscript", name: "subscript", run: (e) => e.chain().focus().toggleSubscript().run() },
];

const BLOCKS: readonly MarkSpec[] = [
  { key: "commTplBulletList", name: "bulletList", run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: "commTplNumberedList", name: "orderedList", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: "commTplBlockquote", name: "blockquote", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { key: "commTplCodeBlock", name: "codeBlock", run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

const HEADING_LEVELS = [1, 2, 3, 4] as const;
const HEADING_KEY: Record<(typeof HEADING_LEVELS)[number], TranslationKey> = {
  1: "commTplHeading1",
  2: "commTplHeading2",
  3: "commTplHeading3",
  4: "commTplHeading4",
};

export interface RichTextToolbarProps {
  editor: Editor;
  lang: Lang;
  onAddLink: () => void;
}

export function RichTextToolbar({ editor, lang, onAddLink }: RichTextToolbarProps) {
  const activeLevel = HEADING_LEVELS.find((l) => editor.isActive("heading", { level: l })) ?? 0;

  function setLevel(raw: string) {
    const level = Number(raw);
    if (level === 0) editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 }).run();
  }

  return (
    // ★ flex-wrap is required, not cosmetic: fifteen controls render inside four
    // modals with tight vertical space.
    <div className="flex flex-wrap items-center gap-1">
      <Select
        size="xs"
        aria-label={t(lang, "commTplHeadingLevel")}
        value={String(activeLevel)}
        onChange={(e) => setLevel(e.target.value)}
        // Same reason as every button below — a control that blurs the
        // contenteditable loses the selection the command applies to.
        onMouseDown={(e) => e.preventDefault()}
      >
        <option value="0">{t(lang, "commTplParagraph")}</option>
        {HEADING_LEVELS.map((level) => (
          <option key={level} value={String(level)}>{t(lang, HEADING_KEY[level])}</option>
        ))}
      </Select>

      {[...BLOCKS, ...MARKS].map((spec) => (
        <ToggleButton
          key={spec.name}
          pressed={editor.isActive(spec.name)}
          onToggle={() => spec.run(editor)}
          lang={lang}
        >
          {t(lang, spec.key)}
        </ToggleButton>
      ))}

      <Button variant="secondary" size="xs" onMouseDown={(e) => e.preventDefault()} onClick={onAddLink}>
        {t(lang, "commTplLink")}
      </Button>
      <Button
        variant="secondary"
        size="xs"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().unsetLink().run()}
      >
        {t(lang, "commTplUnlink")}
      </Button>
    </div>
  );
}
```

★ `ToggleButton` renders its own `onMouseDown` guard only if it has one — check
`src/app/toggle-button.tsx` before assuming. If it does not, add the guard there rather than wrapping
each call site, and pin it with a test in `toggle-button.test.tsx`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/rich-text-toolbar.test.tsx --reporter=dot; echo "EXIT=$?"`
Expected: `EXIT=0`

- [ ] **Step 5: Mutation-check one control**

Delete the `commTplHighlight` entry from `MARKS`, re-run, confirm the "every mark control" test goes
RED, then restore it. A per-control test that stays green with the control deleted is proving nothing.

- [ ] **Step 6: Commit**

```bash
git add src/app/rich-text-toolbar.tsx src/app/rich-text-toolbar.test.tsx
git commit -m "feat(rich-text): extract the shared toolbar with the full Simple-template control set"
```

---

## Task 11: Collapse the editor variants

**Files:**
- Modify: `src/app/rich-text-editor.tsx`
- Test: `src/app/rich-text-editor.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
describe("the unified editor", () => {
  it("exposes no variant prop", () => {
    // Structural: a stale variant="lean" at a call site must be a TYPE error,
    // not a silently ignored prop.
    const src = readFileSync("src/app/rich-text-editor.tsx", "utf8");
    expect(src).not.toContain("RichTextEditorVariant");
    expect(src).not.toContain("isLean");
  });

  it("registers the Simple-template extensions", () => {
    const src = readFileSync("src/app/rich-text-editor.tsx", "utf8");
    for (const ext of ["Highlight", "Subscript", "Superscript"]) expect(src).toContain(ext);
    expect(src).toContain("levels: [1, 2, 3, 4]");
  });

  it("no longer disables underline, strike, code, blockquote, codeBlock or headings", () => {
    const src = readFileSync("src/app/rich-text-editor.tsx", "utf8");
    for (const off of ["heading: false", "blockquote: false", "codeBlock: false",
                       "code: false", "strike: false", "horizontalRule: false",
                       "underline: false"]) {
      expect(src).not.toContain(off);
    }
  });

  it("sanitizes committed html with the one sanitizer", () => {
    const src = readFileSync("src/app/rich-text-editor.tsx", "utf8");
    expect(src).toContain("sanitizeRichHtml");
    expect(src).not.toContain("sanitizeNoteHtml");
    expect(src).not.toContain("sanitizeTemplateHtml");
  });

  it("keeps the CSP nonce on the injected ProseMirror stylesheet", () => {
    // This is the app's ONLY useEditor call and createStyleTag dedupes on
    // style[data-tiptap-style], so one un-nonced mount poisons every later one.
    // Prod CSP is nonce-only on style-src-elem; dev is not — open-followups §54.
    const src = readFileSync("src/app/rich-text-editor.tsx", "utf8");
    expect(src).toContain("injectNonce: readCspNonce()");
  });
});
```

Keep every existing test in this file. In particular the `underline` test from `dfeceabf` now asserts
the OPPOSITE behaviour — underline must SURVIVE a commit. Update it rather than deleting it, and say
so in the commit message.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/rich-text-editor.test.tsx --reporter=dot; echo "EXIT=$?"`
Expected: `EXIT=1`

- [ ] **Step 3: Implement**

In `src/app/rich-text-editor.tsx`:

```tsx
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { sanitizeRichHtml } from "./sanitize-html";
import { RichTextToolbar } from "./rich-text-toolbar";

// ★★★ ONE extension set for every rich surface in the app. The lean/full split
// is gone: it existed because the lean sanitizer DELETED what the full schema
// could produce (open-followups §137), and one allow-list removed the reason.
//
// ★★ The markdown input rules are deliberately BACK ON. They were disabled
// because sanitizeNoteHtml (KEEP_CONTENT: false) deleted what they produced —
// typing "# Q3 highlights" stored NOTHING at all, with no error and no toast,
// and for the dashboard narrative Save stayed disabled because `unchanged` was
// then true. Every tag those rules emit is now allow-listed, so "# ", "> ",
// "```", "`x`", "~~x~~" and "--- " all work and survive the commit.
const EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
  Highlight,
  Subscript,
  Superscript,
];
```

Then in the component:
- delete `variant`, `isLean`, `RichTextEditorVariant`, `RichTextEditorLabels`, the `labels` prop and the `ToolbarButton` function
- `const sanitize = sanitizeRichHtml;` (or call it directly in `onUpdate`)
- `const minH = "min-h-24";` — one height for one editor. If a caller needs more room it passes a class; do not reintroduce a variant for it.
- `extensions: EXTENSIONS`
- `addLink()` uses `t(lang, "commTplLinkPrompt")` unconditionally (the `labels?.linkPrompt` branch goes)
- replace both toolbar JSX blocks with one:

```tsx
{editor && <RichTextToolbar editor={editor} lang={lang} onAddLink={addLink} />}
{editor && (mergeFields?.length ?? 0) > 0 && (
  <div className="flex flex-wrap gap-1">
    {(mergeFields ?? []).map((field) => (
      <Button
        key={field}
        variant="secondary"
        size="xs"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().insertContent(`{{${field}}}`).run()}
      >
        {fieldLabel ? fieldLabel(field) : field}
      </Button>
    ))}
  </div>
)}
```

Keep `injectNonce`, `handleKeyDown`, the `useImperativeHandle` `appendText` (with its TEXT-NODE
`insertContent`, never a bare string) and all three `useRef` callback mirrors exactly as they are.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/rich-text-editor.test.tsx --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=0` for the first; `EXIT=1` for tsc, listing the 12 call sites still passing `variant`
or `labels`. That is Task 12's worklist.

- [ ] **Step 5: Check the size ratchet before committing**

```bash
node -e "console.log(require('fs').readFileSync('src/app/rich-text-editor.tsx','utf8').split('\n').length)"
npm run size:check; echo "EXIT=$?"
```
Expected: `EXIT=0`. The count is `wc -l` **+ 1** — a file at `wc -l` 799 is already AT the 800 limit.

- [ ] **Step 6: Commit**

```bash
git add src/app/rich-text-editor.tsx src/app/rich-text-editor.test.tsx
git commit -m "feat(rich-text): collapse the lean and full editor variants into one"
```

---

## Task 12: Sweep the twelve call sites

**Files:**
- Modify: `src/app/task-form-fields.tsx`, `raid-edit-modal.tsx` (×2), `change-edit-modal.tsx` (×3), `milestone-edit-modal.tsx`, `note-log-panel.tsx` (×2), `dashboard-sections/dashboard-narrative.tsx`, `settings-sections/comm-templates-section.tsx`, `meeting-report-panel.tsx`

- [ ] **Step 1: Enumerate**

```bash
grep -rn "<RichTextEditor" src/app --include="*.tsx" | grep -v "\.test\."
```
Expected: 12 call sites.

- [ ] **Step 2: Drop `variant` from the ten lean sites**

Delete the `variant="lean"` line. Every one of them already passes `lang`, which is now required.

- [ ] **Step 3: Drop `labels` from the two full sites**

- `settings-sections/comm-templates-section.tsx` — delete the whole `labels={{ … }}` block. Keep `mergeFields` and `fieldLabel`. Add `lang={lang}` if it is not already passed.
- `meeting-report-panel.tsx` — delete `labels={rteLabels(lang)}`, then delete the now-unused `rteLabels` function at the top of that file. Add `lang={lang}`.

★★ CI runs `eslint --max-warnings=0` with **no** `argsIgnorePattern`. An unused import or an
orphaned helper is FATAL, not a warning. `npm run lint` will not tell you — it exits 0 with warnings
present.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```
Expected: `EXIT=0` for both.

- [ ] **Step 5: Run every suite that renders an editor**

```bash
npx vitest run src/app/note-log-panel.test.tsx src/app/task-form-fields.test.tsx src/app/raid-edit-modal.test.tsx src/app/change-edit-modal.test.tsx src/app/milestone-edit-modal.test.tsx --reporter=dot; echo "EXIT=$?"
```
Expected: `EXIT=0`. Some of these will fail on toolbar queries that assumed five lean buttons — update
the assertion to the new control set; do not weaken it to `getAllByRole("button").length > 0`.

- [ ] **Step 6: Commit**

```bash
git add src/app
git commit -m "refactor(rich-text): drop the variant and labels props at all twelve call sites"
```

---

## Task 13: Full gate run

**Files:** none — this task only runs gates and fixes what they find.

- [ ] **Step 1: The unit suite, unpiped**

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```
Expected: `EXIT=0`.

★★ If the full run exceeds ~10 minutes, do NOT background it: a backgrounded run gets KILLED with zero
FAIL lines and exit 1, and the notification reports the trailing command's status. Shard it in the
foreground and reconcile the totals.

- [ ] **Step 2: The shuffled suite — the only local reproduction of a blocking CI job**

```bash
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
```
Expected: `EXIT=0`. A failure here is deterministic and re-runnable at the same pinned seed.

- [ ] **Step 3: The remaining quality gates**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run dup:check; echo "DUP=$?"
npm run size:check; echo "SIZE=$?"
npm run docs:symbols:check; echo "SYMBOLS=$?"
npm run docs:claims:check; echo "CLAIMS=$?"
npm run test:coverage > /tmp/cov.log 2>&1; echo "COV=$?"
```
Expected: all `0`.

★ `rich-text-toolbar.tsx` is a `.tsx` file, so it is outside the coverage gate's globs — but
`test:run` does not enforce the floors at all, so run `test:coverage` here rather than assuming.

- [ ] **Step 4: The axe gate on a FRESH server**

The unit suite never runs Playwright, so axe regressions slip the local gate and fail only in CI.

```bash
PORT=3100 npm run dev &
curl -o /dev/null -s -w "%{time_total}\n" http://localhost:3100/     # warm the route first
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1; echo "EXIT=$?"
PORT=3100 npm run stop
```
Expected: `EXIT=0`, 91 tests.

★★ `--workers=1` is mandatory. A `Test timeout of 60000ms exceeded` inside `page.evaluate` is
CONTENTION, not a violation — it names no rule and no impact. Read the failure BODY, never the summary.

- [ ] **Step 5: The prod-CSP smoke — the only gate that sees the real policy**

This slice touches the Tiptap editor, whose stylesheet injection is exactly what §54 was.

```bash
npm run build > /tmp/build.log 2>&1; echo "BUILD=$?"
npm run e2e:smoke:prod; echo "SMOKE=$?"
```
Expected: both `0`. Dev grants `'unsafe-inline'` on `style-src-elem` and prod is nonce-only, so a dev
run cannot see a CSP regression here.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A src e2e
git commit -m "test: fix fallout from the rich-text unification"
```

---

## Task 14: The durable record

**Files:**
- Modify: `AGENTS.md`, `docs/open-followups.md`
- Possibly: `docs/AGENTS/documents.md`, `docs/AGENTS/ai-assistant.md`

Both plan and spec are gitignored. Everything below is the only thing that survives.

- [ ] **Step 1: Correct the FALSE alignment claim in `AGENTS.md`**

Find the ★★★ bullet reading "**Alignment CANNOT be markup, and this generalises.**" Replace the
`style`/`class` sentence with the measurement, controls included:

```
★★★ ALIGNMENT IS REPRESENTABLE AS MARKUP — an earlier revision of this bullet said it was not,
and the mechanism it named does not apply. `ALLOWED_URI_REGEXP` IS tested against every attribute
value, and that IS why `target`/`rel` never survive (§38) — but `style`, `class`, `title` and `id`
are members of DOMPurify's DEFAULT_URI_SAFE_ATTRIBUTES, so the value test never reaches them.
Measured 2026-08-11 on dompurify 3.4.13 WITH CONTROLS: listing `target`/`rel` still strips them and
listing `lang` still strips it (so the test is armed), while `style="text-align:center"` and
`class="text-center"` both SURVIVE. What actually blocks alignment is the VALUE: nothing constrains
what a surviving `style` contains — `position:fixed;inset:0;z-index:99999` passes verbatim, and
these fields are AI-writable. So alignment needs a value allow-list enforced by
`uponSanitizeAttribute`, which is §140's slice, not a list entry. Do not read the old claim as a
reason it cannot be built.
```

Also update: the "Three DOMPurify sanitizers" description (now two), the rich-text module map, and
every bullet naming `sanitizeNoteHtml` / `sanitizeTemplateHtml` / the lean 8-tag set.

★★ `docs:symbols:check` only proves that a backticked **mixed-case** name exists in `src`. Every
`SCREAMING_CASE` constant these docs name — `RICH_ALLOWED_TAGS`, `SINK_TAGS`, `BLOCK_TAG`,
`TEMPLATE_ALLOWED_TAGS` — is completely ungated, so a stale one is invisible forever. Grep each.

- [ ] **Step 2: Close §137**

Mark it `~~…~~ — CLOSED in <version>`, and state precisely what did and did not close:

```
CLOSED — one list (`RICH_ALLOWED_TAGS`), one sanitizer (`sanitizeRichHtml`, unwrap semantics), one
sink (`rich`), one editor. The five measured deletions and the leading-tag escape are both gone,
pinned by fixtures in `sanitize-html.test.ts` and `note-log.test.ts`.

NOT closed by this slice, and each is now its own entry: already-escaped STORED values are not
repaired (§141); task list and alignment are unbuilt (§140); §115's `data-*` default is unchanged.
```

- [ ] **Step 3: Correct §113's copy of the same false claim**

The S3b cell repeats "Alignment CANNOT be markup". Correct it the same way and add that the unified
editor now exists, so S3b's editor work is smaller than it was designed to be.

- [ ] **Step 4: Open the two successor entries**

`## 140.` — the attribute boundary: task list (`data-type`/`data-checked`) + alignment
(`text-align`), a value allow-list via `uponSanitizeAttribute`, `ALLOW_DATA_ATTR: false` on every
sanitizer (closing §115), and its own security review. Record the four measurements from the spec's
§2b/§2c verbatim — they are the whole design input. Note that StarterKit already bundles
`@tiptap/extension-list`, so task list needs no new package; only `@tiptap/extension-text-align` does.

`## 141.` — repair of already-escaped stored values, plus export fidelity (entity fields onto
`htmlToRichLines`, heading level and list numbering in DOCX/PPTX) and §31's unbounded markup bytes.

- [ ] **Step 5: Decrement §55 by a COUNTED number**

`ToolbarButton` is gone. Count how many of §55's thirteen hand-rolled `aria-pressed` toggles that
actually removed — do not estimate:

```bash
grep -rn "aria-pressed" src/app --include="*.tsx" | grep -v "\.test\." | grep -v toggle-button.tsx
```
Update §55's count and its site list to match the output.

- [ ] **Step 6: Verify the doc gates**

```bash
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```
Expected: `EXIT=0`. The claims gate is a RATCHET — it fails on a NEW `path:LINE` citation. Cite
SYMBOLS, not line numbers. It cannot tell you a citation is CORRECT, only that the line could exist.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md docs/
git commit -m "docs: close §137, correct the alignment claim, open §140 and §141"
```

---

## Task 15: Release

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` (5)

- [ ] **Step 1: Pick a codename and verify it is free**

```bash
grep -cE "^## \[?0\.[0-9]+\.[0-9]+.*<NAME>" CHANGELOG.md
```
Expected: `0`. Scope the grep to release HEADINGS — an unscoped match hits prose and a name that was
merely mentioned reads as taken.

- [ ] **Step 2: Bump `src/app/version.ts` with a node utf8 write**

`APP_VERSION`, `APP_BUILD_DATE`, `APP_MILESTONE`.

★★ `version.ts` is **CRLF**. A node replace anchored on `\n` no-ops SILENTLY while its siblings
succeed. Match `\r\n`, then verify:

```bash
grep -n "APP_VERSION\|APP_BUILD_DATE\|APP_MILESTONE" src/app/version.ts
```

- [ ] **Step 3: Write the CHANGELOG entry**

Cover, in user-facing language: one editor everywhere; headings 1–4, quote, code block,
strikethrough, underline, inline code, highlight, superscript, subscript; markdown shortcuts
(`# `, `> `, ` ``` `, `~~x~~`) now work in every rich field; and the data fix — headings and
underlined text in register descriptions are no longer lost on load.

★★ Never put a `[session link removed]…` URL in `CHANGELOG.md` or an MR description.

- [ ] **Step 4: Bump the five ungated places**

`package.json` `version`; `package-lock.json` (**two** occurrences — the root `version` and the
`packages[""]` one); the README shields badge (version **and** codename); the
`<!-- Generated: … | App <version> "<codename>" … -->` header on all five `docs/CODEMAPS/*.md`.
No gate checks any of these — `package-lock.json` was once eleven releases stale.

- [ ] **Step 5: Verify every version string agrees**

```bash
grep -rn "0\.23[0-9]\.0" package.json package-lock.json README.md src/app/version.ts docs/CODEMAPS/*.md | head -20
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(release): <version> \"<codename>\""
```

- [ ] **Step 7: Stop — do not push, open an MR, or merge**

Push, MR and merge happen only on an explicit instruction. If asked to "release": push → open MR →
poll the pipeline → merge **only after it is green**. Never `--auto-merge`.

- [ ] **Step 8: Eye-verify what no gate can see**

jsdom has no layout and axe cannot see overflow or contrast on an unscanned surface. Open the app and
look at: the four entity modals (task, RAID, change, milestone) with the fifteen-control toolbar; the
note composer; the dashboard narrative; and one comm-template send preview. Confirm the toolbar wraps
rather than clipping, and that the pressed marker is visible in a dark scheme.

---

## Self-Review

**Spec coverage** — every section maps to a task:

| spec § | task |
|---|---|
| §4a `RICH_ALLOWED_TAGS` | 2 |
| §4b `sanitizeRichHtml` + unwrap | 2, 7 |
| §4c `sanitizeDocumentHtml` stays, derives | 3 |
| §4d one `rich` sink, `projection` kept separate | 4 |
| §4e `sanitizeRichFields` — where §137 closes | 8 |
| §4f `BLOCK_TAG` += `pre` | 5 |
| §5a collapse variants + 3 packages | 1, 11 |
| §5b input rules back on | 11 |
| §5c `rich-text-toolbar.tsx`, ToggleButton, select label | 10 |
| §5d i18n EN+DE | 9 |
| §5e call-site sweep | 6, 12 |
| §6 testing + gates | 2, 8, 10, 13 |
| §7 docs owed | 14 |
| §8 risks (eye-verify, size ratchet, goldens) | 5, 11, 13, 15 |
| §9 release | 15 |
| §10 definition of done | 13, 14, 15 |

**Placeholder scan:** no TBDs; every code step carries the code; no "similar to Task N".

**Type consistency:** `sanitizeRichHtml` / `RICH_ALLOWED_TAGS` / `SINK_TAGS.rich` / `"rich"` /
`RichTextToolbar` / `RichTextToolbarProps` are spelled identically in Tasks 2, 3, 4, 6, 7, 8, 10, 11.
`DerivedSink` is `"rich" | "document" | "projection"` in Task 4 and nothing later adds a member.

**One gap accepted deliberately:** Task 10's stub `Editor` does not exercise real ProseMirror schema
behaviour, so "the toolbar produces a tag the sanitizer keeps" is proved at the sanitizer (Task 2) and
at the command call (Task 10), not end-to-end in one test. An end-to-end assertion needs a real
browser — the same limit §137 records for its own `<u>` keystroke probe.
