# Slice B — rich-text descriptions + inline note log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn six plain-text register fields (RAID `description`+`mitigation`, Change `description`+`impactDescription`+`resolutionNotes`, Milestone `description`) into rich HTML using the shipped `Task.description` stack, sweep every consumer that reads them, and render the task note log inline in the task modal.

**Architecture:** A DOM-free pure module (`rich-text-plain.ts`) upgrades legacy plain text to HTML and caps by *text* length; it is called from the three entity sanitizers, which is where all six write paths converge. A browser-only sibling (`rich-text-projection.ts`) provides the plain-text projection every non-DOM consumer (search, export, AI digests, AI-plan previews) must use. The editors swap `Textarea` → `RichTextEditor variant="lean"`. The `NotesWindow` body is extracted to a shared `NoteLogPanel` mounted both in that window and in a collapsible section of `TaskFormModal`, writing straight through to the workspace.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4, Tiptap (via the existing `RichTextEditor`), DOMPurify (via `sanitize-html.ts`), vitest + @testing-library, Playwright/axe.

**Spec:** `docs/superpowers/specs/2026-07-29-slice-b-rich-text-design.md`

---

## Read this before Task 1

Four rules govern every task below. Violating any of them produces a defect that no existing test catches.

1. **`rich-text-plain.ts` must never call DOMPurify.** It runs inside the entity sanitizers. DOMPurify binds `window` once at module-eval; with no DOM the bind fails, `sanitize()` throws, and `jsonToWorkspace`'s catch-all swallows the throw into an **empty workspace** that then "successfully" scales to near-empty sample files. (`scripts/generate-sample-workspace.ts:22-40` documents this; it installs jsdom precisely to avoid it. The rule is the layer rule stated in `narrative-html.ts`, and it is what keeps a future node context safe.) *Importing* `plainToHtml` from `sanitize-html.ts` is fine — `narrative-html.ts` already does — because only a **call** to `sanitize()` needs the DOM.
2. **`HTML_START` is defined once.** It lives in `narrative-html.ts` and its tag list is exactly `sanitize-html.ts`'s `NOTE_ALLOWED_TAGS` minus `#text`. Export it; never copy it.
3. **Lint runs `--max-warnings=0`.** An import left unused after an edit (e.g. `plainToHtml` in `use-resource-planner.ts`) is a **fatal** CI error. Re-grep the file after every removal.
4. **Mutation-verify the starred tests.** Break the implementation, run the test, and confirm the **named** assertion is the one that fails — read the failure message, not just the red.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/app/rich-text-plain.ts` | DOM-free: `descriptionHtml`, `htmlPlainProjection`, `htmlTextLength`, `capHtmlText`, `sanitizeRichText` |
| `src/app/rich-text-plain.test.ts` | Its tests, incl. the no-DOMPurify source guard |
| `src/app/rich-text-projection.ts` | Browser-only: `descriptionText`, `appendDictationToHtml` |
| `src/app/rich-text-projection.test.ts` | Its tests |
| `src/app/note-log-panel.tsx` | Presentational note log: composer + entry list + inline edit |
| `src/app/note-log-panel.test.tsx` | Its tests |

**Modified**

| File | Change |
|---|---|
| `src/app/narrative-html.ts` | Export `HTML_START` |
| `src/app/sanitize-records.ts` | Six fields → `sanitizeRichText` |
| `src/app/global-search.ts` | raid/change/milestone descriptions + raid mitigation → `descriptionText` |
| `src/app/raid-panel.tsx` · `change-panel.tsx` | Search haystacks → `descriptionText` |
| `src/app/task-manager.tsx` | Milestone/RAID AI digests → text before slice; thread `taskNotePanel` |
| `src/app/export-sections.ts` | Rich columns → `descriptionText` in the three section builders |
| `src/app/use-resource-planner.ts` | `plainToHtml` → `descriptionHtml` (double-escape bug) |
| `src/app/inline-ai-edit/plan.ts` | Project rich fields to text in `FieldDiff` |
| `src/app/milestone-edit-modal.tsx` · `raid-edit-modal.tsx` · `change-edit-modal.tsx` | `Textarea` → `RichTextEditor` for the six fields |
| `src/app/task-form-fields.tsx` | Adopt `appendDictationToHtml`; Notes button → `<details>` + `NoteLogPanel` |
| `src/app/notes-window.tsx` | Render the extracted `NoteLogPanel` |
| `src/app/use-notes-window.ts` | Expose `notePanelPropsFor(kind, id)` |
| `src/app/app-modals.tsx` · `task-form-modal.tsx` | Thread `taskNotePanel` |
| `src/app/__fixtures__/golden-workspace.csv` · `.md` | Regenerated |
| `src/app/version.ts` · `CHANGELOG.md` · `i18n.ts` · `i18n.de.ts` | Release chain |

---

### Task 1: DOM-free rich-text core

**Files:**
- Modify: `src/app/narrative-html.ts:36`
- Create: `src/app/rich-text-plain.ts`
- Test: `src/app/rich-text-plain.test.ts`

- [ ] **Step 1: Export `HTML_START`**

In `src/app/narrative-html.ts`, change the declaration (currently `const HTML_START = …`) to:

```ts
export const HTML_START = /^\s*<(p|br|strong|em|ul|ol|li|a)\b/i;
```

Leave the entire comment block above it untouched — it documents why `h1`-`h6`/`blockquote`/`div` are absent.

- [ ] **Step 2: Write the failing tests**

Create `src/app/rich-text-plain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  capHtmlText,
  descriptionHtml,
  htmlPlainProjection,
  htmlTextLength,
  sanitizeRichText,
} from "./rich-text-plain";

describe("descriptionHtml", () => {
  it("escapes and wraps a legacy plain value", () => {
    expect(descriptionHtml("cost < 5k & rising")).toBe("<p>cost &lt; 5k &amp; rising</p>");
  });

  it("keeps a plain value whose stray < is not a tag", () => {
    expect(descriptionHtml("5 < 10 items")).toBe("<p>5 &lt; 10 items</p>");
    expect(descriptionHtml("<3 open")).toBe("<p>&lt;3 open</p>");
  });

  it("passes through a value that already opens with an allowed tag", () => {
    expect(descriptionHtml("<p>done</p>")).toBe("<p>done</p>");
    expect(descriptionHtml("<strong>lead</strong> rest")).toBe("<strong>lead</strong> rest");
  });

  it("is idempotent — it runs on every load", () => {
    for (const raw of ["cost < 5k", "<p>done</p>", "", "  "]) {
      expect(descriptionHtml(descriptionHtml(raw))).toBe(descriptionHtml(raw));
    }
  });

  it("converts newlines to <br>", () => {
    expect(descriptionHtml("a\nb")).toBe("<p>a<br>b</p>");
  });

  it("returns empty for blank input", () => {
    expect(descriptionHtml(undefined)).toBe("");
    expect(descriptionHtml("   ")).toBe("");
  });
});

describe("htmlPlainProjection", () => {
  it("strips tags and decodes entities", () => {
    expect(htmlPlainProjection("<p>cost &lt; 5k &amp; rising</p>")).toBe("cost < 5k & rising");
  });

  it("decodes &amp; LAST so &amp;lt; does not double-decode", () => {
    expect(htmlPlainProjection("<p>&amp;lt;b&amp;gt;</p>")).toBe("&lt;b&gt;");
  });

  it("treats &nbsp; in every spelling as a space", () => {
    expect(htmlPlainProjection("<p>a&nbsp;b&#160;c&#xa0;d</p>")).toBe("a b c d");
  });
});

describe("htmlTextLength", () => {
  // ★ headline claim first: markup must not consume the user's budget.
  it("counts text, not markup", () => {
    const html = "<ul><li><strong>ab</strong></li><li>cd</li></ul>";
    expect(htmlTextLength(html)).toBe(4);
    expect(html.length).toBeGreaterThan(40);
  });
});

describe("capHtmlText", () => {
  it("returns the input untouched when the text fits", () => {
    const html = "<p><strong>keep</strong> me</p>";
    expect(capHtmlText(html, 5000)).toBe(html);
  });

  it("never leaves a severed tag when it truncates", () => {
    const html = "<p><strong>abcdefghij</strong></p>";
    const out = capHtmlText(html, 4);
    expect(out).toBe("<p>abcd</p>");
    expect(out).not.toContain("<strong");
  });
});

describe("sanitizeRichText", () => {
  it("upgrades, caps and rejects a non-string", () => {
    expect(sanitizeRichText("plain", 5000)).toBe("<p>plain</p>");
    expect(sanitizeRichText(42, 5000)).toBe("");
    expect(sanitizeRichText(undefined, 5000)).toBe("");
  });

  it("strips control characters but keeps newlines", () => {
    expect(sanitizeRichText("a\x07b\nc", 5000)).toBe("<p>ab<br>c</p>");
  });
});

// ★★ Guard: this module runs inside the entity sanitizers, which execute under
// bare node in the sample/fixture scripts. A DOMPurify CALL there throws, and
// jsonToWorkspace's catch-all turns that into an EMPTY workspace.
describe("DOM-free guard", () => {
  it("never calls a DOMPurify-backed helper", () => {
    const src = readFileSync(join(import.meta.dirname, "rich-text-plain.ts"), "utf8");
    expect(src).not.toMatch(/dompurify/i);
    expect(src).not.toMatch(/htmlToText/);
    expect(src).not.toMatch(/sanitizeNoteHtml/);
    expect(src).not.toMatch(/sanitizeTemplateHtml/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/app/rich-text-plain.test.ts`
Expected: FAIL — `Failed to resolve import "./rich-text-plain"`.

- [ ] **Step 4: Write the implementation**

Create `src/app/rich-text-plain.ts`:

```ts
// src/app/rich-text-plain.ts
//
// DOM-FREE half of the rich-text description layer (RAID description +
// mitigation, Change description + impactDescription + resolutionNotes,
// Milestone description).
//
// ★★★ NOTHING HERE MAY CALL DOMPURIFY. These functions run inside the entity
// sanitizers, which execute under bare node in scripts/generate-sample-
// workspace.ts and the fixture flow. DOMPurify binds its `window` ONCE at
// module-eval; with no DOM that bind fails, sanitize() throws, and
// jsonToWorkspace's catch-all silently swallows it into an EMPTY workspace —
// which then "successfully" writes near-empty sample files. Sanitisation is a
// SINK concern: RichTextView re-sanitises at render.
//
// Importing plainToHtml is safe (narrative-html.ts already does): only a CALL
// to DOMPurify needs a DOM, and plainToHtml deliberately makes none — it
// escapes &<> and adds only <p>/<br>, both in the note allow-list, which makes
// a sanitize pass a provable no-op.
import { plainToHtml } from "./sanitize-html";
import { HTML_START } from "./narrative-html";

/** Control characters that must never reach storage. \n (0x0a) and \r (0x0d)
 *  are DELIBERATELY absent: plainToHtml turns them into <br>. Written as \x
 *  escapes — a literal control byte corrupts the file to binary. */
const CONTROL_CHARS = /[\x00-\x09\x0b\x0c\x0e-\x1f]/g;

const TAG = /<[^>]*>/g;
/** A non-breaking space in every spelling the editor or a paste can produce. */
const NBSP = /&nbsp;|&#0*160;|&#x0*a0;/gi;

/** A stored value -> HTML. Already-HTML passes through; legacy plain text is
 *  escaped and wrapped. Idempotent — this runs on every load. */
export function descriptionHtml(stored: string | undefined): string {
  const s = (stored ?? "").trim();
  if (!s) return "";
  return HTML_START.test(s) ? s : plainToHtml(s);
}

/** Plain-text projection WITHOUT DOMPurify — the only projection legal in a
 *  sanitizer. `&amp;` decodes LAST, or "&amp;lt;" would double-decode to "<".
 *  For display/search/export use rich-text-projection.ts's descriptionText,
 *  which goes through the real sanitizer. */
export function htmlPlainProjection(html: string): string {
  return html
    .replace(TAG, "")
    .replace(NBSP, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .trim();
}

/** Length of the VISIBLE text — what the cap and the counter both measure, so
 *  markup never eats the user's budget. */
export function htmlTextLength(html: string): number {
  return htmlPlainProjection(html).length;
}

/** Cap by text length. Over cap, the value is projected to text, truncated and
 *  re-wrapped, so the result is always well-formed; formatting is lost only on
 *  overflow, which the editor-side counter warns about first. */
export function capHtmlText(html: string, max: number): string {
  if (!html) return "";
  const text = htmlPlainProjection(html);
  if (text.length <= max) return html;
  return plainToHtml(text.slice(0, max));
}

/** The single entry point for the entity sanitizers: guard the type, strip
 *  control characters, upgrade legacy plain text, cap by text length. */
export function sanitizeRichText(raw: unknown, max: number): string {
  const s = typeof raw === "string" ? raw.replace(CONTROL_CHARS, "") : "";
  return capHtmlText(descriptionHtml(s), max);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/rich-text-plain.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 6: Mutation-check the two starred claims**

Temporarily change `htmlTextLength` to `return html.length;` → the "counts text, not markup" test must fail with `expected 48 to be 4`. Restore.
Temporarily change `capHtmlText`'s truncation to `return html.slice(0, max);` → "never leaves a severed tag" must fail on the `toBe("<p>abcd</p>")` assertion. Restore.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/rich-text-plain.ts src/app/rich-text-plain.test.ts src/app/narrative-html.ts
git commit -m "feat(rich-text): add the DOM-free description upgrade + text-length cap"
```

---

### Task 2: Browser-side projection + shared dictation append

**Files:**
- Create: `src/app/rich-text-projection.ts`
- Test: `src/app/rich-text-projection.test.ts`
- Modify: `src/app/task-form-fields.tsx:106-116`

- [ ] **Step 1: Write the failing tests**

Create `src/app/rich-text-projection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { appendDictationToHtml, descriptionText } from "./rich-text-projection";

describe("descriptionText", () => {
  it("projects stored HTML to plain text", () => {
    expect(descriptionText("<p>cost <strong>up</strong></p>")).toBe("cost up");
  });

  it("projects a legacy plain value without escaping artefacts", () => {
    expect(descriptionText("cost < 5k & rising")).toBe("cost < 5k & rising");
  });

  it("returns empty for blank input", () => {
    expect(descriptionText(undefined)).toBe("");
  });
});

describe("appendDictationToHtml", () => {
  it("appends dictated text to an existing value", () => {
    expect(appendDictationToHtml("<p>first</p>", "second")).toBe("<p>first second</p>");
  });

  it("starts a value from empty", () => {
    expect(appendDictationToHtml(undefined, "hello")).toBe("<p>hello</p>");
  });

  it("upgrades a legacy plain value before appending", () => {
    expect(appendDictationToHtml("plain & old", "more")).toBe("<p>plain &amp; old more</p>");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/rich-text-projection.test.ts`
Expected: FAIL — cannot resolve `./rich-text-projection`.

- [ ] **Step 3: Write the implementation**

Create `src/app/rich-text-projection.ts`:

```ts
// src/app/rich-text-projection.ts
//
// BROWSER-ONLY half of the rich-text description layer: everything here goes
// through DOMPurify (htmlToText), so it must NEVER be imported by a codec, an
// entity sanitizer, or anything else that can run under bare node. The DOM-free
// half is rich-text-plain.ts.
//
// Every non-DOM consumer of a rich description — global search, the export
// section builders, the AI entity digests, the inline-AI plan preview — reads
// its value through descriptionText. DOM consumers use RichTextView.
import { htmlToText, plainToHtml } from "./sanitize-html";
import { appendDictation } from "./dictation-engine";
import { descriptionHtml } from "./rich-text-plain";

/** Stored value -> plain text, upgrading a legacy plain value on the way so a
 *  never-edited record projects identically to an edited one. */
export function descriptionText(stored: string | undefined): string {
  return htmlToText(descriptionHtml(stored));
}

/** Append a dictated utterance to a rich field.
 *
 *  ★ Round-tripping through text is what lets appendDictation join mid-utterance
 *  segments (Web Speech fires onFinal repeatedly per hold). The cost is that any
 *  existing bold/italic/list formatting in the field is FLATTENED on dictation —
 *  shipped behaviour on Task.description since 0.196.0, carried forward here so
 *  all six rich fields behave identically. Fixing it needs per-utterance segment
 *  tracking; see docs/open-followups.md. */
export function appendDictationToHtml(html: string | undefined, txt: string): string {
  return plainToHtml(appendDictation(htmlToText(descriptionHtml(html)), txt));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/app/rich-text-projection.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Adopt the shared helper in the task modal**

In `src/app/task-form-fields.tsx`, replace the description dictation handler (currently lines ~112-116) so the expression lives in one place:

```tsx
    onAppendFinal: (txt) =>
      setForm((prev) => ({
        ...prev,
        description: appendDictationToHtml(prev.description ?? "", txt),
      })),
```

Add `import { appendDictationToHtml } from "./rich-text-projection";`. Then check whether `plainToHtml`, `htmlToText` and `appendDictation` are still used elsewhere in the file — `appendDictation` still is (the `taskName` mic); remove any import that is now unused, or lint fails fatally.

- [ ] **Step 6: Run the task-form tests**

Run: `npx vitest run src/app/task-form-fields.test.tsx src/app/task-form-modal.test.tsx`
Expected: PASS — behaviour is unchanged, this is an extraction.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/rich-text-projection.ts src/app/rich-text-projection.test.ts src/app/task-form-fields.tsx
git commit -m "feat(rich-text): add the browser-side text projection + shared dictation append"
```

---

### Task 3: Sanitizers — the six fields

**Files:**
- Modify: `src/app/sanitize-records.ts:87-88` (milestone), `:122` + `:131` + `:137` (change), `:194-197` (raid)
- Test: `src/app/sanitize.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `src/app/sanitize.test.ts`:

```ts
describe("rich-text description fields (slice B)", () => {
  it("upgrades a legacy plain RAID description and mitigation", () => {
    const item = sanitizeRaidItem({
      id: 1,
      title: "Vendor risk",
      description: "cost < 5k & rising",
      mitigation: "escalate\nto sponsor",
    });
    expect(item?.description).toBe("<p>cost &lt; 5k &amp; rising</p>");
    expect(item?.mitigation).toBe("<p>escalate<br>to sponsor</p>");
  });

  it("passes an already-rich RAID description through untouched", () => {
    const item = sanitizeRaidItem({ id: 1, title: "t", description: "<p>already <strong>rich</strong></p>" });
    expect(item?.description).toBe("<p>already <strong>rich</strong></p>");
  });

  it("upgrades the milestone description", () => {
    const m = sanitizeMilestone({ id: 1, name: "M1", date: "2026-01-01", description: "a & b" });
    expect(m?.description).toBe("<p>a &amp; b</p>");
  });

  it("upgrades all three change fields", () => {
    const c = sanitizeChangeItem({
      id: 1,
      title: "CR-1",
      description: "scope < agreed",
      impactDescription: "2 weeks",
      resolutionNotes: "approved",
    });
    expect(c?.description).toBe("<p>scope &lt; agreed</p>");
    expect(c?.impactDescription).toBe("<p>2 weeks</p>");
    expect(c?.resolutionNotes).toBe("<p>approved</p>");
  });

  // ★ headline claim first: the cap must measure TEXT, so a heavily marked-up
  // value that fits is kept whole.
  it("caps by text length, not markup length", () => {
    const body = "x".repeat(4990);
    const rich = `<ul><li><strong>${body}</strong></li></ul>`;
    const item = sanitizeRaidItem({ id: 1, title: "t", description: rich });
    expect(item?.description).toBe(rich);
  });

  it("truncates an over-cap value to well-formed HTML", () => {
    const item = sanitizeRaidItem({ id: 1, title: "t", description: "y".repeat(5100) });
    expect(item?.description).toBe(`<p>${"y".repeat(5000)}</p>`);
  });

  it("omits an empty description rather than storing a blank", () => {
    const item = sanitizeRaidItem({ id: 1, title: "t", description: "   " });
    expect(item?.description).toBeUndefined();
  });
});
```

Make sure `sanitizeMilestone`, `sanitizeChangeItem` and `sanitizeRaidItem` are all in the file's import list.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/sanitize.test.ts -t "rich-text description fields"`
Expected: FAIL — `expected 'cost < 5k & rising' to be '<p>cost &lt; 5k &amp; rising</p>'`.

- [ ] **Step 3: Change the sanitizers**

Add to the imports at the top of `src/app/sanitize-records.ts`:

```ts
import { sanitizeRichText } from "./rich-text-plain";
```

Milestone (replace the two lines at ~87-88):

```ts
  const description = sanitizeRichText(o.description, TEXTAREA_MAX);
  if (description) m.description = description;
```

Change — inside the `const item: ChangeItem = { … }` literal, replace the `description` line:

```ts
    description: sanitizeRichText(o.description, TEXTAREA_MAX),
```

and the two sparse lines below it:

```ts
  const impactDesc = sanitizeRichText(o.impactDescription, TEXTAREA_MAX); if (impactDesc) item.impactDescription = impactDesc;
  …
  const notes = sanitizeRichText(o.resolutionNotes, TEXTAREA_MAX); if (notes) item.resolutionNotes = notes;
```

RAID (replace the four lines at ~194-197):

```ts
  const description = sanitizeRichText(o.description, TEXTAREA_MAX);
  if (description) item.description = description;
  const mitigation = sanitizeRichText(o.mitigation, TEXTAREA_MAX);
  if (mitigation) item.mitigation = mitigation;
```

Do **not** touch `localModifiedAt`, `owner`, `title` or any other field.

- [ ] **Step 4: Run the sanitizer suites**

Run: `npx vitest run src/app/sanitize.test.ts src/app/sanitize.property.test.ts`
Expected: PASS. If a property test asserts a description round-trips verbatim, update it to expect the upgraded form — that is the intended shape change, not a regression.

- [ ] **Step 5: Mutation-check the cap claim**

Temporarily change the RAID `description` line to `capHtmlText(descriptionHtml(...), 50)`; the "caps by text length" test must fail showing a truncated value. Restore.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/sanitize-records.ts src/app/sanitize.test.ts
git commit -m "feat(registers): store RAID, change and milestone descriptions as rich text"
```

---

### Task 4: Regenerate the golden fixtures

**Files:**
- Modify: `src/app/__fixtures__/golden-workspace.csv`, `src/app/__fixtures__/golden-workspace.md`

The fixtures pin exact storage bytes. Task 3 legitimately changed five columns, so they must be regenerated **once**, deliberately, and the diff inspected.

- [ ] **Step 1: Confirm the golden test now fails**

Run: `npx vitest run src/app/golden-workspace.test.ts`
Expected: FAIL — the emitted CSV/MD no longer match the committed fixtures.

- [ ] **Step 2: Write the one-off regeneration script**

Create `scripts/regen-goldens.ts` (deleted again in step 5). The jsdom install before the dynamic import is mandatory — see the header of `scripts/generate-sample-workspace.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });

const { jsonToWorkspace, workspaceToCsv, workspaceToMarkdown } = await import("../src/app/storage");

const ws = jsonToWorkspace(readFileSync(join(ROOT, "sample-workspace-small.json"), "utf8"), { strict: true });
if (!ws.tasks.length || !ws.raid.length) throw new Error("empty workspace — jsdom install or master file is broken");

writeFileSync(join(ROOT, "src/app/__fixtures__/golden-workspace.csv"), workspaceToCsv(ws), "utf8");
writeFileSync(join(ROOT, "src/app/__fixtures__/golden-workspace.md"), workspaceToMarkdown(ws), "utf8");
console.log("regenerated");
```

- [ ] **Step 3: Run it and inspect the diff**

```bash
npx vite-node scripts/regen-goldens.ts
git diff --stat src/app/__fixtures__/
git diff src/app/__fixtures__/ | head -80
```

Expected: every changed cell is a RAID `description`/`mitigation`, Change `description`/`impactDescription`/`resolutionNotes`, or Milestone `description`, and each changed value is the same text wrapped in `<p>…</p>`. **If any other column moved, stop** — a sanitizer edit went too wide. Also confirm the file did not shrink dramatically: a near-empty fixture means the jsdom install failed and `jsonToWorkspace` swallowed a throw.

- [ ] **Step 4: Verify the goldens pass**

Run: `npx vitest run src/app/golden-workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Delete the script and commit**

```bash
rm scripts/regen-goldens.ts
git add src/app/__fixtures__/
git commit -m "chore(fixtures): regenerate goldens for the rich-text register descriptions"
```

---

### Task 5: Search consumers

**Files:**
- Modify: `src/app/global-search.ts:119-138`, `src/app/raid-panel.tsx:216-219`, `src/app/change-panel.tsx:208`
- Test: `src/app/global-search.test.ts`, `src/app/raid-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/global-search.test.ts` (adapt the workspace-fixture helper the file already uses):

```ts
describe("rich descriptions are indexed as text (slice B)", () => {
  it("does not match on markup and does match on the words", () => {
    const ws = makeWorkspace({
      raid: [{ id: 1, category: "R", title: "Vendor", status: "Open", raisedDate: "2026-01-01", linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], description: "<p>slipped <strong>badly</strong></p>", mitigation: "<p>escalate</p>" }],
    });
    const index = buildSearchIndex(ws);
    expect(searchIndex(index, "strong")).toHaveLength(0);
    expect(searchIndex(index, "badly").map((r) => r.id)).toEqual([1]);
    expect(searchIndex(index, "escalate").map((r) => r.id)).toEqual([1]);
  });

  it("shows a milestone's description as plain text in the result subtitle", () => {
    const ws = makeWorkspace({
      milestones: [{ id: 7, name: "Go live", date: "2026-03-01", linkedTaskIds: [], description: "<p>final <em>cutover</em></p>" }],
    });
    const [row] = searchIndex(buildSearchIndex(ws), "cutover");
    expect(row.subtitle).toBe("final cutover");
  });
});
```

Append to `src/app/raid-panel.test.tsx` a test that types `strong` into the RAID search box with a rich-description item seeded and asserts the row is **not** shown, then types `badly` and asserts it is.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/global-search.test.ts -t "rich descriptions are indexed as text"`
Expected: FAIL — `expected length 1 to be 0` for the `strong` query.

- [ ] **Step 3: Change global-search.ts**

Add `import { descriptionText } from "./rich-text-projection";` and update the three entity blocks:

```ts
    raid: ws.raid.map((item) =>
      indexRow("raid", "raid", item.id, item.title, coerce(item.owner), [
        coerce(descriptionText(item.description)),
        coerce(descriptionText(item.mitigation)),
        coerce(item.owner),
        coerce(item.ownerEmail),
        coerce(item.category),
      ]),
    ),
    changes: ws.changes.map((c) =>
      indexRow("change", "changes", c.id, c.title, coerce(c.requestedBy), [
        coerce(descriptionText(c.description)),
        coerce(c.requestedBy),
        coerce(c.type),
      ]),
    ),
    milestones: ws.milestones.map((m) =>
      indexRow("milestone", "milestones", m.id, m.name, coerce(descriptionText(m.description)), [
        coerce(descriptionText(m.description)),
      ]),
    ),
```

The milestone **subtitle** (the 5th argument) matters as much as the haystack — it is rendered in the results list.

- [ ] **Step 4: Change the two panel haystacks**

`src/app/raid-panel.tsx` — inside the `hay` array:

```tsx
          descriptionText(r.description),
          descriptionText(r.mitigation),
```

`src/app/change-panel.tsx`:

```tsx
        const hay = [c.title, descriptionText(c.description), c.requestedBy ?? ""]
```

Add the `descriptionText` import to both.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/global-search.test.ts src/app/raid-panel.test.tsx src/app/change-panel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/global-search.ts src/app/raid-panel.tsx src/app/change-panel.tsx src/app/global-search.test.ts src/app/raid-panel.test.tsx
git commit -m "fix(search): index rich register descriptions as text"
```

---

### Task 6: Export sections and AI digests

**Files:**
- Modify: `src/app/export-sections.ts:76-97`, `src/app/task-manager.tsx:1702` + `:1723`
- Test: `src/app/export-sections.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/export-sections.test.ts`:

```ts
describe("rich descriptions export as text (slice B)", () => {
  it("emits no markup in raid, milestone or change rows", () => {
    const ws = makeWorkspace({
      raid: [{ id: 1, category: "R", title: "V", status: "Open", raisedDate: "2026-01-01", linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], description: "<p>slipped <strong>badly</strong></p>", mitigation: "<p>escalate</p>" }],
      milestones: [{ id: 2, name: "M", date: "2026-03-01", linkedTaskIds: [], description: "<p>cutover</p>" }],
      changes: [{ id: 3, title: "C", description: "<p>scope</p>", type: "Other", status: "Proposed", raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], impactDescription: "<p>2 weeks</p>", resolutionNotes: "<p>approved</p>" }],
    });
    for (const key of ["raid", "milestones", "changes"] as const) {
      const section = buildExportSections(ws, "en-US", { [key]: true } as never).find((s) => s.key === key);
      const flat = (section?.rows ?? []).flat().join(" ");
      expect(flat).not.toContain("<");
    }
  });

  it("keeps the text content of a rich description", () => {
    const ws = makeWorkspace({ milestones: [{ id: 2, name: "M", date: "2026-03-01", linkedTaskIds: [], description: "<p>final <em>cutover</em></p>" }] });
    const section = buildExportSections(ws, "en-US", { milestones: true } as never).find((s) => s.key === "milestones");
    expect((section?.rows ?? []).flat().join(" ")).toContain("final cutover");
  });
});
```

Adapt `buildExportSections` / the enabled-sections argument to the file's real API — read the existing tests in that file first and mirror their call shape exactly.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/export-sections.test.ts -t "rich descriptions export as text"`
Expected: FAIL — the flattened rows contain `<p>`.

- [ ] **Step 3: Implement in the section builders**

★★ The transform goes **here**, never in `raidFieldToString`/`milestoneFieldToString`/`changeFieldToString` — those are shared with CSV *storage*, where the HTML must survive byte-for-byte.

In `src/app/export-sections.ts`, add the import and a local helper above `raidSection`:

```ts
import { descriptionText } from "./rich-text-projection";

// Columns whose stored value is rich HTML. Exports are read by humans and by
// Office renderers, so they carry the text projection — the codec itself keeps
// the HTML, because CSV *storage* round-trips through the same function.
const RAID_RICH_COLUMNS: ReadonlySet<string> = new Set(["description", "mitigation"]);
const MILESTONE_RICH_COLUMNS: ReadonlySet<string> = new Set(["description"]);
const CHANGE_RICH_COLUMNS: ReadonlySet<string> = new Set(["description", "impactDescription", "resolutionNotes"]);

function richCell(value: string, column: string, rich: ReadonlySet<string>): string {
  return rich.has(column) ? descriptionText(value) : value;
}
```

Then the three row maps become:

```ts
  const rows = raid.map((r) =>
    RAID_CSV_COLUMNS.map((c) => richCell(raidFieldToString(r, c), c, RAID_RICH_COLUMNS))
  );
```

```ts
  const rows = milestones.map((m) =>
    MILESTONES_CSV_COLUMNS.map((c) => richCell(milestoneFieldToString(m, c), c, MILESTONE_RICH_COLUMNS))
  );
```

```ts
  const rows = changes.map((c) =>
    CHANGES_CSV_COLUMNS.map((col) => richCell(changeFieldToString(c, col), col, CHANGE_RICH_COLUMNS))
  );
```

- [ ] **Step 4: Fix the two AI digests**

In `src/app/task-manager.tsx`, add `import { descriptionText } from "./rich-text-projection";` and change the two digest lines so the projection happens **before** the slice (otherwise the cap is spent on markup and can cut mid-tag):

```ts
            `description: ${descriptionText(m.description).slice(0, ENTITY_DIGEST_TEXT_CAP) || "(none)"}`,
```

```ts
            `mitigation: ${descriptionText(r.mitigation).slice(0, ENTITY_DIGEST_TEXT_CAP) || "(none)"}`,
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/export-sections.test.ts src/app/export.test.ts src/app/task-manager.characterization.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/app/export-sections.ts src/app/export-sections.test.ts src/app/task-manager.tsx
git commit -m "fix(export): project rich register descriptions to text for exports and AI digests"
```

---

### Task 7: The mitigation→task double-escape bug

**Files:**
- Modify: `src/app/use-resource-planner.ts:889`
- Test: `src/app/use-resource-planner.test.tsx`

Once `mitigation` holds HTML, `plainToHtml` escapes it a second time and the generated task renders literal `<p><strong>…` on screen.

- [ ] **Step 1: Write the failing test**

Append to `src/app/use-resource-planner.test.tsx`, following the file's existing hook-rendering pattern:

```tsx
it("carries a rich mitigation into the created task without double-escaping", () => {
  // ★ headline claim: the created description equals the stored mitigation.
  const raid = [{ id: 1, category: "R", title: "Vendor", status: "Open", raisedDate: "2026-01-01", linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], mitigation: "<p>escalate <strong>now</strong></p>" }];
  const { result, tasks } = renderPlannerWithRaid(raid);   // use the file's own harness
  act(() => result.current.createMitigationTask(1));
  expect(tasks().at(-1)?.description).toBe("<p>escalate <strong>now</strong></p>");
  expect(tasks().at(-1)?.description).not.toContain("&lt;");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/use-resource-planner.test.tsx -t "double-escaping"`
Expected: FAIL — `expected '<p>&lt;p&gt;escalate …' to be '<p>escalate <strong>now</strong></p>'`.

- [ ] **Step 3: Fix**

In `src/app/use-resource-planner.ts`:

```ts
        description: descriptionHtml(item.mitigation ?? item.description ?? ""),
```

Add `import { descriptionHtml } from "./rich-text-plain";`. Then grep the file for `plainToHtml` — if this was its only use, **delete the import**, or `npm run lint` fails fatally on the unused symbol.

- [ ] **Step 4: Run to verify pass, then mutation-check**

Run: `npx vitest run src/app/use-resource-planner.test.tsx`
Expected: PASS. Restore `plainToHtml(...)` temporarily and confirm the test fails on the `toBe` assertion, not the `not.toContain`.

- [ ] **Step 5: Commit**

```bash
npm run lint && npx tsc --noEmit
git add src/app/use-resource-planner.ts src/app/use-resource-planner.test.tsx
git commit -m "fix(raid): stop double-escaping a rich mitigation into the created task"
```

---

### Task 8: Inline-AI plan preview

**Files:**
- Modify: `src/app/inline-ai-edit/plan.ts:73-89`
- Test: `src/app/inline-ai-edit/plan.test.ts`

`FieldDiff.before/after` are rendered verbatim in the confirm popover (`inline-ai-edit-popover.tsx:86`), so a rich field would show the user raw markup in the dialog they approve.

- [ ] **Step 1: Write the failing test**

Append to `src/app/inline-ai-edit/plan.test.ts`:

```ts
it("shows rich fields as text in the preview diff", () => {
  const ws = makeWs({ raid: [{ id: 1, category: "R", title: "V", status: "Open", raisedDate: "2026-01-01", linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], mitigation: "<p>old <strong>plan</strong></p>" }] });
  const plan = describeToolCalls(
    [{ name: "update_raid_item", input: { id: 1, mitigation: "<p>new plan</p>" } }],
    { ws, descriptor: INLINE_DESCRIPTORS.raid },   // mirror the file's own ctx shape
  );
  const diff = plan.updates.find((u) => u.field === "mitigation");
  expect(diff?.before).toBe("old plan");
  expect(diff?.after).toBe("new plan");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/inline-ai-edit/plan.test.ts -t "rich fields as text"`
Expected: FAIL — `expected '<p>old <strong>plan</strong></p>' to be 'old plan'`.

- [ ] **Step 3: Implement**

In `src/app/inline-ai-edit/plan.ts`, add the import and the field set:

```ts
import { descriptionText } from "../rich-text-projection";

// Fields stored as rich HTML. Only the PREVIEW strings are projected — the
// values applied to the entity stay verbatim, so `applied[f]` below is unchanged.
const RICH_FIELDS: ReadonlySet<string> = new Set([
  "description", "mitigation", "impactDescription", "resolutionNotes", "notes",
]);

function forPreview(field: string, value: string): string {
  return RICH_FIELDS.has(field) ? descriptionText(value) : value;
}
```

Change only the push at line ~88:

```ts
        plan.updates.push({ field: f, before: forPreview(f, before), after: forPreview(f, after) });
        applied[f] = after;
```

★ `applied[f] = after` keeps the **raw** value — validation and the replay both depend on it. Do not project there.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run src/app/inline-ai-edit/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts
git commit -m "fix(inline-ai): preview rich fields as text in the confirm diff"
```

---

### Task 9: Milestone editor → rich text

**Files:**
- Modify: `src/app/milestone-edit-modal.tsx:51-58` + `:167-185`
- Test: `src/app/milestone-edit-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/milestone-edit-modal.test.tsx`:

```tsx
it("renders the description in a rich-text editor", () => {
  render(<MilestoneEditModal lang="en-US" milestone={{ id: 1, name: "M1", date: "2026-03-01", linkedTaskIds: [], description: "<p>cutover</p>" }} onChange={vi.fn()} onSave={vi.fn()} onClose={vi.fn()} />);
  // The lean editor renders a contenteditable, not a textarea.
  const editor = screen.getByRole("textbox", { name: "Description" });
  expect(editor).toHaveAttribute("contenteditable", "true");
  expect(editor).toHaveTextContent("cutover");
});
```

Match the component's real prop names by reading the top of the existing test file first.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/milestone-edit-modal.test.tsx -t "rich-text editor"`
Expected: FAIL — the element is a `<textarea>`, so `contenteditable` is absent.

- [ ] **Step 3: Swap the field**

Replace the `<Textarea …>` inside the `isVisible("description")` block with:

```tsx
            <div onFocus={descriptionDictationReg.onFocus} onBlur={descriptionDictationReg.onBlur}>
              <RichTextEditor
                key={draft.id}
                variant="lean"
                value={descriptionHtml(draft.description)}
                onChange={(html) => update("description", html || undefined)}
                label={t(lang, "milestoneDescription")}
                lang={lang}
              />
            </div>
```

★ `key={draft.id}` is load-bearing: the lean editor reads `value` as its **mount-time** content only, and this modal re-seeds its draft in a render-time reconcile when the `milestone` prop changes (`if (prev !== milestone) setDraft(milestone)`). Without the key, switching from one milestone to another leaves the previous body in the editor.

Update the dictation handler:

```tsx
    onAppendFinal: (txt) =>
      setDraft((p) => (p ? { ...p, description: appendDictationToHtml(p.description, txt) } : p)),
```

Add imports for `RichTextEditor`, `descriptionHtml`, `appendDictationToHtml`; drop `Textarea` and `appendDictation` if now unused in this file.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/app/milestone-edit-modal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint && npx tsc --noEmit
git add src/app/milestone-edit-modal.tsx src/app/milestone-edit-modal.test.tsx
git commit -m "feat(milestones): edit the description as rich text"
```

---

### Task 10: RAID editor → rich text (2 fields)

**Files:**
- Modify: `src/app/raid-edit-modal.tsx:115-122`, `:186-189`, `:358-382`, `:520-539`
- Test: `src/app/raid-edit-modal.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it("renders description and mitigation as rich-text editors", () => {
  renderRaidModal({ description: "<p>slipped</p>", mitigation: "<p>escalate</p>" });  // use the file's harness
  for (const name of ["Description", "Mitigation"]) {
    const editor = screen.getByRole("textbox", { name });
    expect(editor).toHaveAttribute("contenteditable", "true");
  }
});

it("counts description characters as text, not markup", () => {
  const body = "z".repeat(4996);
  renderRaidModal({ description: `<p><strong>${body}</strong></p>` });
  // The counter warns from 90% of 5000; markup must not tip it over the cap.
  expect(screen.getByText(/4996 \/ 5000/)).toBeInTheDocument();
});
```

Use the exact accessible names the modal's `label` props produce (`t(lang, "raidDescription")` / `t(lang, "raidMitigation")`).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/raid-edit-modal.test.tsx -t "rich-text editors"`
Expected: FAIL — textareas, no `contenteditable`.

- [ ] **Step 3: Swap the description field**

Replace the `<Textarea …>` + `<CharCounter …>` pair inside `isVisible("description")`:

```tsx
            <div onFocus={descriptionDictationReg.onFocus} onBlur={descriptionDictationReg.onBlur}>
              <RichTextEditor
                key={`d-${draft.id}`}
                variant="lean"
                value={descriptionHtml(draft.description)}
                onChange={(html) => onChange({ ...draft, description: html || undefined })}
                label={t(lang, "raidDescription")}
                lang={lang}
              />
            </div>
            <CharCounter
              value={htmlPlainProjection(draft.description ?? "")}
              max={TEXTAREA_MAX}
              id="raid-description-counter"
              lang={lang}
            />
```

The `aria-describedby` that pointed at the counter goes away with the `Textarea`; leave the counter's `id` in place (it is also read by the existing counter tests).

- [ ] **Step 4: Swap the mitigation field**

Same shape inside `isVisible("mitigation")`, with `key={`m-${draft.id}`}`, `label={t(lang, "raidMitigation")}`, writing `mitigation`, and the counter fed `htmlPlainProjection(draft.mitigation ?? "")`. Mitigation has **no** dictation mic today — do not add one.

- [ ] **Step 5: Update the dictation handler and the submit tracker**

```tsx
    onAppendFinal: (txt) =>
      onChange({ ...draftRef.current, description: appendDictationToHtml(draftRef.current.description, txt) || undefined }),
```

In `handleSubmit`, the two description-family trackers measure text:

```tsx
    adj.track(describeTextCap(htmlPlainProjection(draft.description ?? ""), TEXTAREA_MAX));
    adj.track(describeTextCap(htmlPlainProjection(draft.mitigation ?? ""), TEXTAREA_MAX));
```

Leave the `title` and `owner` trackers exactly as they are.

- [ ] **Step 6: Run the suites**

Run: `npx vitest run src/app/raid-edit-modal.test.tsx src/app/raid-panel.test.tsx`
Expected: PASS. A test that typed into the old textarea needs rewriting against the contenteditable — follow how `notes-window.test.tsx` drives the lean editor.

- [ ] **Step 7: Check the size ratchet and commit**

```bash
npm run size:check && npm run lint && npx tsc --noEmit
git add src/app/raid-edit-modal.tsx src/app/raid-edit-modal.test.tsx
git commit -m "feat(raid): edit description and mitigation as rich text"
```

---

### Task 11: Change editor → rich text (3 fields)

**Files:**
- Modify: `src/app/change-edit-modal.tsx:115-120`, `:165-171`, `:291-312`, `:365-382`, `:490-504`
- Test: `src/app/change-edit-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("renders all three description fields as rich-text editors", () => {
  renderChangeModal({ description: "<p>scope</p>", impactDescription: "<p>2 weeks</p>", resolutionNotes: "<p>approved</p>" });
  for (const name of ["Description", "Impact description", "Resolution notes"]) {
    expect(screen.getByRole("textbox", { name })).toHaveAttribute("contenteditable", "true");
  }
});
```

Use the accessible names the `label` props produce (`changeFieldDescription`, `changeFieldImpactDescription`, and the resolution-notes key the modal already uses — read them from the file).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/change-edit-modal.test.tsx -t "three description fields"`
Expected: FAIL.

- [ ] **Step 3: Swap `description`** (required field — no `|| undefined`)

```tsx
            <div onFocus={descriptionDictationReg.onFocus} onBlur={descriptionDictationReg.onBlur}>
              <RichTextEditor
                key={`d-${draft.id}`}
                variant="lean"
                value={descriptionHtml(draft.description)}
                onChange={(html) => update("description", html)}
                label={t(lang, "changeFieldDescription")}
                lang={lang}
              />
            </div>
            <CharCounter value={htmlPlainProjection(draft.description ?? "")} max={TEXTAREA_MAX} id="change-description-counter" lang={lang} />
```

- [ ] **Step 4: Swap `impactDescription` and `resolutionNotes`**

Same shape, `key={`i-${draft.id}`}` / `key={`r-${draft.id}`}`, writing `update("impactDescription", html || undefined)` and `update("resolutionNotes", html || undefined)`, counters fed `htmlPlainProjection(...)`, keeping the existing counter `id`s. Neither has a mic today — do not add one.

- [ ] **Step 5: Update the dictation handler and the three trackers**

```tsx
    onAppendFinal: (txt) => update("description", appendDictationToHtml(draftRef.current.description, txt)),
```

```tsx
    adj.track(describeTextCap(htmlPlainProjection(draft.description ?? ""), TEXTAREA_MAX));
    …
    adj.track(describeTextCap(htmlPlainProjection(draft.impactDescription ?? ""), TEXTAREA_MAX));
    adj.track(describeTextCap(htmlPlainProjection(draft.resolutionNotes ?? ""), TEXTAREA_MAX));
```

Leave `title`, `requestedBy` and `decisionBy` untouched.

- [ ] **Step 6: Run and commit**

Run: `npx vitest run src/app/change-edit-modal.test.tsx src/app/change-panel.test.tsx`
Expected: PASS.

```bash
npm run size:check && npm run lint && npx tsc --noEmit
git add src/app/change-edit-modal.tsx src/app/change-edit-modal.test.tsx
git commit -m "feat(changes): edit the three description fields as rich text"
```

---

### Task 12: Extract `NoteLogPanel`

**Files:**
- Create: `src/app/note-log-panel.tsx`, `src/app/note-log-panel.test.tsx`
- Modify: `src/app/notes-window.tsx`

Pure move — `notes-window.test.tsx` must stay green **without edits**. That is the acceptance criterion.

- [ ] **Step 1: Create the panel**

Create `src/app/note-log-panel.tsx` holding the `authorLabel` helper, the `NoteEntryRow` component and a new `NoteLogPanel` — all **moved verbatim** from `notes-window.tsx`, with the composer block and the `<ul>` now living in the panel:

```tsx
"use client";

// Presentational note log: composer + entry list + inline edit. Owns nothing but
// its own composer/edit draft state; every write goes out through the props.
//
// Mounted TWICE: inside the floating `NotesWindow` (row-badge path) and inside
// the task editor's collapsible Notes section. `labelSuffix` disambiguates the
// two surfaces' control names when both are open on the same task — axe cannot
// see duplicate accessible names, so this is on us.
import { useCallback, useState } from "react";
import { INTERACTIVE } from "./interaction-styles";
import { type Lang, t } from "./i18n";
import { RichTextEditor } from "./rich-text-editor";
import { canEditNote } from "./note-log";
import { htmlToText } from "./sanitize-html";
import { RichTextView } from "./rich-text-view";
import { formatDisplayTimestamp } from "./tz-display";
import { browserTimeZone } from "./timezone";
import { resourceDisplayName } from "./resource-foundation";
import type { NoteLogEntry, Resource } from "./types";

export interface NoteLogPanelProps {
  entries: readonly NoteLogEntry[];
  onAdd: (html: string, text: string) => void;
  onEdit: (id: number, html: string, text: string) => void;
  onDelete: (id: number) => void;
  self: number | null | undefined;
  resources: readonly Resource[];
  lang: Lang;
  /** Appended to the composer/row control names so the window and the in-modal
   *  section never announce identical labels. */
  labelSuffix?: string;
}
```

`NoteLogPanel` keeps the `composerHtml` / `composerNonce` / `editingId` / `editHtml` state, `handleAdd`, `startEdit`, `cancelEdit`, `commitEdit` and the newest-first `entries.slice().reverse()` ordering exactly as they are today, and renders:

```tsx
  return (
    <>
      <div className="shrink-0 border-b border-line p-3">
        {/* composer — unchanged markup, plus the suffixed Add label */}
        <RichTextEditor key={composerNonce} variant="lean" value="" onChange={setComposerHtml} onCommit={handleAdd} commitOnEnter label={t(lang, "noteLogPlaceholder")} lang={lang} />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={handleAdd}
            aria-label={labelSuffix ? `${t(lang, "noteLogAdd")} – ${labelSuffix}` : undefined}
            className={`rounded-md bg-ui-dark-blue px-3 py-1 text-xs font-medium text-white ${INTERACTIVE}`}
          >
            {t(lang, "noteLogAdd")}
          </button>
        </div>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3 pr-2">
        {ordered.map((entry) => (
          <NoteEntryRow key={entry.id} entry={entry} editing={editingId === entry.id} self={self} resources={resources} tz={tz} lang={lang} labelSuffix={labelSuffix} onStartEdit={startEdit} onChangeEditHtml={setEditHtml} onCommitEdit={commitEdit} onCancelEdit={cancelEdit} onDelete={onDelete} />
        ))}
      </ul>
    </>
  );
```

`NoteEntryRow` gains the same optional `labelSuffix`, appended to its existing per-row names:

```tsx
                aria-label={`${t(lang, "edit")} – #${entry.id}${props.labelSuffix ? ` – ${props.labelSuffix}` : ""}`}
```

and the same for the delete button. With no suffix the names are byte-identical to today, so existing tests keep passing.

- [ ] **Step 2: Make the window render the panel**

In `src/app/notes-window.tsx`, delete `authorLabel`, `NoteEntryRow`, the composer block, the `<ul>`, the composer/edit state and the three edit helpers; keep `NotesWindowProps` (unchanged shape), the chrome, drag/resize, `usePanelInitialFocus` and `useDismissable`. The body becomes:

```tsx
      <NoteLogPanel
        entries={entries}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
        self={self}
        resources={resources}
        lang={lang}
        labelSuffix={entityLabel}
      />
```

Remove every import the file no longer uses (`RichTextEditor`, `canEditNote`, `htmlToText`, `RichTextView`, `formatDisplayTimestamp`, `browserTimeZone`, `resourceDisplayName`, `useCallback`, …) — lint is fatal on unused imports.

- [ ] **Step 3: Verify the move changed no behaviour**

Run: `npx vitest run src/app/notes-window.test.tsx`
Expected: PASS **with no edits to that file**. If a test fails, the move was not faithful — fix the panel, not the test.

- [ ] **Step 4: Add panel-level tests**

Create `src/app/note-log-panel.test.tsx` covering: an entry renders its author, timestamp and body; **Add** calls `onAdd` with html and text; a blank composer does not call `onAdd`; Edit → commit calls `onEdit`; `canEditNote` hides the controls for another author's note; `labelSuffix` appears in the Add/Edit/Delete accessible names.

- [ ] **Step 5: Run gates and commit**

```bash
npx vitest run src/app/note-log-panel.test.tsx src/app/notes-window.test.tsx
npm run dup:check && npm run lint && npx tsc --noEmit
git add src/app/note-log-panel.tsx src/app/note-log-panel.test.tsx src/app/notes-window.tsx
git commit -m "refactor(notes): extract the shared note-log panel from the floating window"
```

---

### Task 13: Inline note log in the task modal

**Files:**
- Modify: `src/app/use-notes-window.ts` (add `notePanelPropsFor`), `src/app/task-manager.tsx:2695`, `src/app/app-modals.tsx:90` + `:155` + `:198`, `src/app/task-form-modal.tsx:54`, `src/app/task-form-fields.tsx:589-602`
- Test: `src/app/task-form-modal.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/task-form-modal.test.tsx`:

```tsx
it("renders the note log inline and writes through on add", async () => {
  const onAdd = vi.fn();
  renderTaskModal({                                  // use the file's own harness
    taskNotePanel: { entries: [{ id: 1, timestamp: "2026-07-01T09:00:00.000Z", html: "<p>kickoff</p>", text: "kickoff", authorName: "Sam" }], onAdd, onEdit: vi.fn(), onDelete: vi.fn(), self: null, resources: [], lang: "en-US", labelSuffix: "Draft charter" },
  });
  await userEvent.click(screen.getByText(/Notes \(1\)/));
  expect(screen.getByText("kickoff")).toBeInTheDocument();

  // ★ headline claim: the WRITE direction actually reaches the handler.
  const editor = screen.getAllByRole("textbox").at(-1)!;
  await userEvent.click(editor);
  await userEvent.keyboard("new note");
  await userEvent.click(screen.getByRole("button", { name: /Add note – Draft charter/ }));
  expect(onAdd).toHaveBeenCalledWith(expect.stringContaining("new note"), "new note");
});

it("keeps the disabled Notes button for an unsaved task", () => {
  renderTaskModal({ taskNotePanel: undefined });
  expect(screen.getByRole("button", { name: /Notes \(0\)/ })).toBeDisabled();
});

it("reaches the notes disclosure by keyboard", async () => {
  renderTaskModal({ taskNotePanel: { entries: [], onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), self: null, resources: [], lang: "en-US" } });
  // ★ .focus() proves nothing — it succeeds on tabIndex={-1}.
  const summary = screen.getByText(/Notes \(0\)/);
  await userEvent.tab();
  for (let i = 0; i < 40 && document.activeElement !== summary; i++) await userEvent.tab();
  expect(document.activeElement).toBe(summary);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/task-form-modal.test.tsx -t "note log inline"`
Expected: FAIL — the modal takes no `taskNotePanel` prop.

- [ ] **Step 3: Expose panel props from the notes hook**

In `src/app/use-notes-window.ts`, add to `UseNotesWindowResult`:

```ts
  notePanelPropsFor: (kind: "task" | "raid", id: number) => NoteLogPanelProps;
```

and to the returned object, reusing the existing `noteHandlersFor` so there is exactly one write path:

```ts
    notePanelPropsFor: (kind, id) => {
      const handlers = noteHandlersFor(kind, id);
      const entries =
        kind === "task"
          ? tasks.find((tk) => tk.id === id)?.noteLog ?? []
          : raid.find((r) => r.id === id)?.noteLog ?? [];
      const label =
        kind === "task"
          ? tasks.find((tk) => tk.id === id)?.taskName ?? ""
          : raid.find((r) => r.id === id)?.title ?? "";
      return { entries, ...handlers, self: notesSelf, resources, lang, labelSuffix: label };
    },
```

Import the `NoteLogPanelProps` type.

- [ ] **Step 4: Thread the prop**

`task-manager.tsx` (beside the existing `taskOnOpenNotes`):

```tsx
        taskNotePanel={editingId !== null ? notePanelPropsFor("task", editingId) : undefined /* existing task only; a new draft has no id to write to */}
```

and destructure `notePanelPropsFor` from `useNotesWindow(...)`.

`app-modals.tsx` — add `taskNotePanel?: NoteLogPanelProps;` to its props interface, destructure it, and pass `taskNotePanel={taskNotePanel}` to `<TaskFormModal>`.

`task-form-modal.tsx` — add the same optional prop with a doc comment, destructure it, pass it to `<TaskFormFields>`.

- [ ] **Step 5: Render the section**

In `src/app/task-form-fields.tsx`, add `taskNotePanel?: NoteLogPanelProps;` to `TaskFormFieldsProps`, destructure it, and replace the Notes button block:

```tsx
        {/* Running dated note log. With a panel threaded (an existing task) it
            renders INLINE and writes straight through to the workspace — a note
            added here survives Cancel, which is correct for an append-only
            journal. Without one (an unsaved new task) the disabled button
            remains, as there is no id to write to. */}
        {taskNotePanel ? (
          <details className="sm:col-span-2 rounded-md border border-line bg-surface p-2">
            <summary className="cursor-pointer text-sm font-medium text-ui-dark-blue dark:text-ui-light-grey">
              {t(lang, "noteLogTitle")} ({taskNotePanel.entries.length})
            </summary>
            <div className="mt-2 flex max-h-72 flex-col overflow-auto pr-2">
              <NoteLogPanel {...taskNotePanel} />
            </div>
          </details>
        ) : (
          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={onOpenNotes}
              disabled={!onOpenNotes}
              className={`inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ui-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:text-ui-light-grey ${INTERACTIVE}`}
            >
              {t(lang, "noteLogTitle")} ({(form.noteLog ?? []).length})
            </button>
          </div>
        )}
```

★ The count comes from `taskNotePanel.entries` (the live workspace), not `form.noteLog` (the draft) — a write-through add must move the number immediately.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/app/task-form-modal.test.tsx src/app/task-form-fields.test.tsx src/app/task-manager.characterization.test.tsx`
Expected: PASS.

- [ ] **Step 7: Mutation-check the write test**

Replace `onAdd={handlers.onAdd}` in `notePanelPropsFor` with a no-op and confirm the inline test fails on `expect(onAdd).toHaveBeenCalledWith(...)`. Restore.

- [ ] **Step 8: Commit**

```bash
npm run lint && npx tsc --noEmit
git add src/app/use-notes-window.ts src/app/task-manager.tsx src/app/app-modals.tsx src/app/task-form-modal.tsx src/app/task-form-fields.tsx src/app/task-form-modal.test.tsx
git commit -m "feat(tasks): render the note log inline in the task editor"
```

---

### Task 14: Full gate run

- [ ] **Step 1: Unit suite and coverage**

```bash
npm run test:run
npm run test:coverage
```
Expected: all green. `rich-text-plain.ts`, `rich-text-projection.ts` and `note-log-panel.tsx` are coverage-gated — if a floor fails, add the missing tests. Do **not** add these files to `coverage.exclude`; that is only for UI glue hooks.

★ A red `timelog-panel.test.tsx` at ~5 s is a known load-dependent flake (third occurrence), not a regression: confirm which test failed, confirm the rest is green, re-run that file alone.

- [ ] **Step 2: Static gates**

```bash
npm run lint
npx tsc --noEmit
npm run dup:check
npm run size:check
```
Expected: all pass. If `dup:check` flags the six editor blocks, extract a small local field component in the offending modal rather than loosening the threshold.

- [ ] **Step 3: axe on the affected scanned views, on a FRESH server**

```bash
PORT=3100 npm run dev    # in a second shell
npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Milestones"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"
PORT=3100 npm run stop
```
Expected: pass. Never reuse a long-running dev server for an axe run after CSS/class changes.

- [ ] **Step 4: Eye-verify what axe cannot see**

Open each of the RAID, change and milestone editors: toolbar buttons render and are keyboard-reachable, the counter tracks typed text (not markup), dictation appends, and a legacy plain description opens with its `&`/`<`/line breaks intact. Open the task editor: the Notes disclosure expands, an added note appears immediately, and the floating window still opens from a row badge.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix(rich-text): address gate findings"
```

---

### Task 15: Release chain

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `docs/open-followups.md`

- [ ] **Step 1: Pick an unused codename**

```bash
grep -c '"' CHANGELOG.md
grep -i '"<candidate>"' CHANGELOG.md
```
The second grep must return nothing. Quote the search — a near-miss spelling collided in slice E.

- [ ] **Step 2: Bump the version**

In `src/app/version.ts` set `APP_VERSION = "0.209.0"` and the milestone to the chosen codename.

- [ ] **Step 3: Add the highlight strings**

Append a new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` with the EN string in `i18n.ts`, e.g.:

```ts
  versionHighlightRichDescriptions:
    "RAID, change and milestone descriptions are now rich text, and a task's note log opens inside the editor.",
```

★ Patch `i18n.de.ts` with a **node utf8 write**, never the Edit tool (CRLF file; Edit corrupts umlauts and curls quotes). Anchor on `\r\n`:

```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');s=s.replace('  versionHighlightPrev:','  versionHighlightRichDescriptions:\r\n    \"Beschreibungen in RAID, Änderungen und Meilensteinen sind jetzt Rich-Text, und das Notizprotokoll einer Aufgabe öffnet sich direkt im Editor.\",\r\n  versionHighlightPrev:');fs.writeFileSync(p,s,'utf8');"
grep -n "Beschreibungen in RAID" src/app/i18n.de.ts
```
Replace `versionHighlightPrev` with the real preceding key. Verify the umlauts survived (`Änderungen`, `öffnet`).

- [ ] **Step 4: CHANGELOG entry**

Add a `## 0.209.0 "<codename>"` section: the six fields becoming rich text with legacy values upgraded on load, the search/export/AI-digest projections, the mitigation-task double-escape fix, and the inline note log.

- [ ] **Step 5: Record the follow-ups**

Append to `docs/open-followups.md`: dictation flattens existing formatting in every rich field; `htmlToText` collapses whitespace so exports are single-line; task rows still export `Task.description` as raw HTML (the same one-line fix, deliberately out of slice B's approved scope); the task inline-AI descriptor still lists the dead field name `"notes"` (`inline-ai-edit/entity-descriptor.ts:94`).

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit && npm run test:run
git add src/app/version.ts CHANGELOG.md src/app/i18n.ts src/app/i18n.de.ts docs/open-followups.md
git commit -m "chore(release): 0.209.0 <codename>"
```

---

### Task 16: Close-out archive

- [ ] **Step 1: Merge every prior archive**

★★★ Do **not** zip the working tree alone, and do **not** take `sorted(glob)[-1]` as the base: `-` (0x2D) sorts before `.` (0x2E), so `_archive-…-2026-07-28-slice-d.zip` sorts after `_archive-…-2026-07-28.zip` and the wrong file wins. The tree holds far fewer documents than the archives.

```python
# npx vite-node or python — merge ALL priors newest-first, working tree wins
import glob, zipfile, os
priors = sorted(glob.glob("docs/superpowers/_archive-*.zip"), key=os.path.getmtime, reverse=True)
out = "docs/superpowers/_archive-slice-docs-2026-07-29.zip"
seen = set()
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk("docs/superpowers"):
        for f in files:
            p = os.path.join(root, f)
            if p.endswith(".zip"): continue
            rel = os.path.relpath(p, "docs/superpowers")
            if rel in seen: continue
            seen.add(rel); z.write(p, rel)
    for prior in priors:
        with zipfile.ZipFile(prior) as pz:
            for n in pz.namelist():
                if n in seen: continue
                seen.add(n); z.writestr(n, pz.read(n))

# assert the superset property before trusting the result
new = set(zipfile.ZipFile(out).namelist())
for prior in priors:
    missing = set(zipfile.ZipFile(prior).namelist()) - new
    assert not missing, (prior, sorted(missing)[:5])
print(len(new), "entries")
```

- [ ] **Step 2: Confirm the count**

Expected: at least as many entries as the largest prior archive (342 as of slice E), plus the two slice-B documents.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/_archive-slice-docs-2026-07-29.zip
git commit -m "chore(docs): archive the slice-B spec and plan"
```

---

## Self-review notes

- **Spec coverage:** module structure → T1/T2; sanitizer migration (1a) → T3; goldens → T4; consumer sweep → T5/T6; the two named bugs → T7/T8; editors for all six fields → T9/T10/T11; note-log extraction + inline section (4a) → T12/T13; gates, release, archive → T14/T15/T16.
- **Deliberately excluded** (spec says so): `ProjectMeta.description`, all `notes` fields, the dictation-flattening fix, a break-preserving `htmlToText`, the task-export HTML leak, the stale `"notes"` descriptor entry. The last three are logged in T15 step 5.
- **Naming is consistent throughout:** `descriptionHtml` / `htmlPlainProjection` / `htmlTextLength` / `capHtmlText` / `sanitizeRichText` (DOM-free) and `descriptionText` / `appendDictationToHtml` (browser-only). No task uses a name another task did not define.
- **Test harness names** (`makeWorkspace`, `renderRaidModal`, `renderTaskModal`, `renderPlannerWithRaid`) are placeholders for each file's **existing** helper — read the top of the test file and use its real one rather than inventing a harness.
