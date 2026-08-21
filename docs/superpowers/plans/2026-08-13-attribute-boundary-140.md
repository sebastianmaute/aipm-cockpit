# Attribute Boundary (§140) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admit exactly four `data-*` attributes through the rich-text storage boundary under a value allow-list, and use them to ship task lists and text alignment.

**Architecture:** One literal table (`ATTR_VALUES`) maps attribute name → value predicate. A DOMPurify `uponSanitizeAttribute` hook, registered lazily (never at module eval — that is an SSR 500), rejects any value not in the table. `ALLOW_DATA_ATTR: false` on `sanitizeRichHtml` closes §115 and is simultaneously what makes the table reachable. Tiptap's TextAlign is rewired to emit `data-align` instead of `style`, and TaskItem's `renderHTML` is overridden so serialized HTML needs zero new tags while the editor keeps Tiptap's own interactive checkbox nodeView.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Tiptap 3.27.1 · dompurify 3.4.13 · vitest · Playwright/axe · lucide-react (this toolbar only)

**Spec:** `docs/superpowers/specs/2026-08-13-attribute-boundary-140-design.md` (gitignored — decisions are reproduced into `docs/open-followups.md` §140 in Task 10)

**Branch:** `feat/attribute-boundary-140`, cut from `main` at `2263a19b`

---

## Orientation for someone who has never touched this repo

Six things will bite you if nobody says them first. All six are measured, not folklore.

1. **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` reports `tail`'s status — a failing suite reads as green. Always: `npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"` then read the file.
2. **`npm run lint` does not reproduce CI.** It is bare `eslint` with no `--max-warnings`, so it exits 0 with warnings present. The real gate is `npx eslint --max-warnings=0 src/app`. An unused import is FATAL there.
3. **`next build` does not typecheck test files and vitest never typechecks.** Run `npx tsc --noEmit` after editing ANY test.
4. **Tiptap commands are typed by module augmentation inside each package.** A file calling `toggleTaskList()` while only *another* file imports the extension passes vitest and fails `tsc`. This will happen in Task 5 if Task 3/4 are skipped.
5. **`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it.** Patch it with a node utf8 write (Task 6 gives the exact script). An LF-anchored replace silently no-ops.
6. **`DOMPurify.addHook` is `undefined` when there is no DOM** and throws `TypeError`. `sanitize-html.ts` is module-eval-reachable under Next SSR via `templates-builtin.ts` → `plainToHtml`. Registration must be lazy. Task 2 adds the test that enforces this.

---

## File Structure

**Modified:**

| File | Responsibility after this slice |
|---|---|
| `src/app/sanitize-html.ts` | + `ATTR_VALUES` table, `ensureAttrHook()`, three new names on the shared `ALLOWED_ATTR`, `ALLOW_DATA_ATTR: false` and `ADD_URI_SAFE_ATTR` on `sanitizeRichHtml` |
| `src/app/rich-text-editor.tsx` | + `TaskList` / `TaskItem` (renderHTML overridden) / `TextAlign` (rewired to `data-align`) in `EXTENSIONS` |
| `src/app/rich-text-toolbar.tsx` | + optional `ControlSpec.active`; taskList joins `BLOCKS`; new `ALIGN` group; divider indices; the "fifteen controls" comment |
| `src/app/rich-text-plain.ts` | + `markTaskItems()` — DOM-free, the single source of the `[x]` / `[ ]` prefix |
| `src/app/rich-text-projection.ts` | applies `markTaskItems` at its two projection sites |
| `src/app/globals.css` | + `[data-align]` and `[data-type="taskItem"]` rules |
| `src/app/doc-render-html.ts` | + the same rules in `DOCUMENT_PAGE_STYLES` so standalone HTML and PDF match |
| `src/app/i18n.ts` · `src/app/i18n.de.ts` | + 6 keys |
| `package.json` · `package-lock.json` | + `@tiptap/extension-text-align` pinned exact |

**New test files:** none — every suite below extends an existing file (`sanitize-html.test.ts`, `rich-text-toolbar.test.tsx`, `rich-text-projection.test.ts`, `rich-text-plain.test.ts`).

**Docs corrected (Tasks 9–11):** `AGENTS.md`, `docs/AGENTS/ai-assistant.md`, `docs/CODEMAPS/data.md`, `docs/open-followups.md`, `CHANGELOG.md`, `src/app/version.ts`, `README.md`.

---

## Task 1: The sanitizer boundary

**Files:**
- Modify: `src/app/sanitize-html.ts`
- Test: `src/app/sanitize-html.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/sanitize-html.test.ts` (it already imports from `./sanitize-html`; add `sanitizeDocumentHtml` to that import if absent):

```ts
describe("attribute value allow-list (§140)", () => {
  it("keeps data-align at each of the four legal values", () => {
    for (const v of ["left", "center", "right", "justify"]) {
      expect(sanitizeRichHtml(`<p data-align="${v}">x</p>`)).toBe(`<p data-align="${v}">x</p>`);
    }
  });

  it("drops data-align at an illegal value", () => {
    expect(sanitizeRichHtml('<p data-align="middle">x</p>')).toBe("<p>x</p>");
  });

  it("drops a compound data-align that smuggles a second declaration", () => {
    expect(sanitizeRichHtml('<p data-align="justify;position:fixed">x</p>')).toBe("<p>x</p>");
  });

  it("is case-sensitive — upper case is not a legal alignment", () => {
    expect(sanitizeRichHtml('<p data-align="CENTER">x</p>')).toBe("<p>x</p>");
  });

  it("keeps the task-list attributes at their legal values", () => {
    const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>x</p></li></ul>';
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it("drops data-checked at a non-boolean value", () => {
    expect(sanitizeRichHtml('<li data-type="taskItem" data-checked="maybe">x</li>'))
      .toBe('<li data-type="taskItem">x</li>');
  });

  // THIS ASSERTION IS THE §115 FIX. Before this slice sanitizeRichHtml kept
  // every data-* attribute, because ALLOW_DATA_ATTR defaults to TRUE.
  it("drops an unlisted data-* attribute", () => {
    expect(sanitizeRichHtml('<p data-foo="1">x</p>')).toBe("<p>x</p>");
  });

  it("still keeps href, which is guarded by ALLOWED_URI_REGEXP not by the table", () => {
    expect(sanitizeRichHtml('<a href="https://example.com">x</a>'))
      .toContain('href="https://example.com"');
  });

  // §117(b): data-asset-id is exempted from every value test by
  // ADD_URI_SAFE_ATTR, so the table is the only thing that can guard it.
  it("keeps a well-formed data-asset-id on the document boundary", () => {
    expect(sanitizeDocumentHtml('<img data-asset-id="a1-B2_c3" alt="x">'))
      .toContain('data-asset-id="a1-B2_c3"');
  });

  it("drops a data-asset-id with an illegal character", () => {
    expect(sanitizeDocumentHtml('<img data-asset-id="a/../b" alt="x">'))
      .not.toContain("data-asset-id");
  });

  it("drops a data-asset-id longer than 64 characters", () => {
    expect(sanitizeDocumentHtml(`<img data-asset-id="${"a".repeat(65)}" alt="x">`))
      .not.toContain("data-asset-id");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/sanitize-html.test.ts --reporter=dot > /tmp/s1.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s1.log
```
Expected: FAIL. The `data-align` / `data-type` / `data-checked` cases fail because those attributes are not on `ALLOWED_ATTR`; the `data-foo` case fails because `ALLOW_DATA_ATTR` still defaults to true; the `data-asset-id` rejection cases fail because nothing validates the value.

- [ ] **Step 3: Add the table and the lazy hook**

In `src/app/sanitize-html.ts`, immediately after the `const ALLOWED_ATTR = [...]` declaration and its comment block, insert:

```ts
/** The four `data-*` attributes this app admits, each with the FULL set of
 *  values it may carry. This literal IS the policy — §140.
 *
 *  ★★★ WHY A TABLE AND NOT A CSS GRAMMAR. Alignment could have ridden `style`
 *  (which survives DOMPurify: `style` is in DEFAULT_URI_SAFE_ATTRIBUTES, so
 *  ALLOWED_URI_REGEXP never sees it). It was rejected because nothing parses a
 *  CSS value — `position:fixed;inset:0;z-index:99999` passes verbatim — and
 *  these fields are AI-writable. A guard over CSS can be widened one
 *  declaration at a time until it is a CSS allow-list; a guard over a 4-member
 *  string set cannot drift that way.
 *
 *  ★ Lower-case only, deliberately tighter than necessary: Tiptap emits
 *  lower-case, so accepting "CENTER" would widen the set for nothing.
 *
 *  ★ `data-asset-id` is strict on CHARSET and LENGTH and deliberately silent on
 *  FORMAT — it admits uuid, ulid, nanoid, a content hash or an integer, so it
 *  cannot constrain whatever id the images slice mints, while rejecting empty,
 *  whitespace, quotes, angle brackets, path separators and 65+ chars. §117(b). */
const ATTR_VALUES: Readonly<Record<string, (value: string) => boolean>> = {
  "data-align": (v) => v === "left" || v === "center" || v === "right" || v === "justify",
  "data-type": (v) => v === "taskList" || v === "taskItem",
  "data-checked": (v) => v === "true" || v === "false",
  "data-asset-id": (v) => /^[A-Za-z0-9_-]{1,64}$/.test(v),
};

/** The three names task list and alignment need. Kept separate from
 *  ALLOWED_ATTR's own literal only so the ADD_URI_SAFE_ATTR lists below can
 *  reuse it — every name here must appear in BOTH places or it is stripped. */
const GUARDED_DATA_ATTR = ["data-align", "data-type", "data-checked"] as const;

let attrHookRegistered = false;

/** Registers the value-allow-list hook exactly once, LAZILY.
 *
 *  ★★★ NEVER CALL DOMPurify.addHook AT MODULE EVAL. With no DOM it is
 *  `undefined` and throws a TypeError (measured under bare node on dompurify
 *  3.4.13), and this module is module-eval-reachable during Next SSR:
 *  `templates-builtin.ts` imports `plainToHtml` from here and calls it while
 *  building the built-in templates. A top-level registration is a 500 on every
 *  page. `sanitize-html.test.ts` carries a source scan that enforces this.
 *
 *  ★★ The hook is INERT for any attribute not in ATTR_VALUES, which is what
 *  makes ONE globally-registered hook safe for all four DOMPurify.sanitize
 *  calls in this file — including the strip-everything projection below. */
function ensureAttrHook(): void {
  if (attrHookRegistered) return;
  attrHookRegistered = true;
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    const isAllowedValue = ATTR_VALUES[data.attrName];
    if (!isAllowedValue) return;
    if (!isAllowedValue(data.attrValue)) data.keepAttr = false;
  });
}
```

Then change `ALLOWED_ATTR` itself:

```ts
const ALLOWED_ATTR = ["href", "target", "rel", ...GUARDED_DATA_ATTR];
```

★ `GUARDED_DATA_ATTR` is declared above `ALLOWED_ATTR` in the insert above, so move the `ATTR_VALUES` block ABOVE the `ALLOWED_ATTR` line rather than after it. `const` is not hoisted for use in an initializer.

- [ ] **Step 4: Wire both sanitizers**

Replace `sanitizeRichHtml`'s body:

```ts
export function sanitizeRichHtml(html: string): string {
  ensureAttrHook();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: RICH_ALLOWED_TAGS,
    ALLOWED_ATTR,
    // ★★★ §115. The default is TRUE, which SHORT-CIRCUITS every data-*
    // attribute past both the name test and the value test — so the explicit
    // ALLOWED_ATTR list was not the whole gate, and the hook above would never
    // have been asked about a data-checked. Turning it off is simultaneously
    // the §115 fix and the precondition for ATTR_VALUES to be reachable.
    ALLOW_DATA_ATTR: false,
    // ★★ Turning it off drops these three into the VALUE chain, where
    // ALLOWED_URI_REGEXP is tested against EVERY attribute value (not only
    // URI-bearing ones) and rejects any non-URI. So each kept name needs the
    // exemption HERE as well as the entry in ALLOWED_ATTR. The exemption is
    // also why the ATTR_VALUES table has to exist: it is the only remaining
    // guard on these values.
    ADD_URI_SAFE_ATTR: [...GUARDED_DATA_ATTR],
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
  });
}
```

And `sanitizeDocumentHtml`:

```ts
export function sanitizeDocumentHtml(html: string): string {
  ensureAttrHook();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: DOCUMENT_ALLOWED_TAGS,
    ALLOWED_ATTR: DOCUMENT_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ADD_URI_SAFE_ATTR: ["data-asset-id", ...GUARDED_DATA_ATTR],
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
  });
}
```

★ `DOCUMENT_ALLOWED_ATTR` is `[...ALLOWED_ATTR, "data-asset-id", "alt"]`, so it inherits the three new names with no edit.

- [ ] **Step 5: Run to verify they pass**

```bash
npx vitest run src/app/sanitize-html.test.ts --reporter=dot > /tmp/s1.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s1.log
```
Expected: PASS, `EXIT=0`.

- [ ] **Step 6: Run the whole sanitize + rich-text family** — `ALLOW_DATA_ATTR: false` is a behaviour change on a shared boundary

```bash
npx vitest run src/app/sanitize src/app/rich-text src/app/html-start src/app/ai-rich-text --reporter=dot > /tmp/s1b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/s1b.log
```
Expected: PASS. If a test asserted the OLD `data-*`-passthrough behaviour, it is asserting §115 — update it and note it in the commit body.

- [ ] **Step 7: Commit**

```bash
git add src/app/sanitize-html.ts src/app/sanitize-html.test.ts
git commit -m "feat(sanitize): guard four data-* attributes with a value allow-list (§140, closes §115/§117b)"
```

---

## Task 2: Mutation-proof the four guards

No production code changes. This task exists because three of Task 1's four guards can be deleted individually and the suite could still pass — and a guard nothing pins is a guard the next refactor removes.

**Files:**
- Test: `src/app/sanitize-html.test.ts`

- [ ] **Step 1: Add the module-eval source scan**

```ts
// ★★★ THE SSR GUARD. DOMPurify.addHook is undefined with no DOM and throws;
// this module is module-eval-reachable under Next SSR (templates-builtin.ts
// imports plainToHtml from here and calls it at module scope). A top-level
// addHook is therefore a 500 on every page. Nothing else in the repo can see
// this — the browser test environment always has a DOM.
// Comments may name the API; CODE may not call it at top level.
it("never registers the DOMPurify hook at module eval", () => {
  const src = readFileSync(new URL("./sanitize-html.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const topLevelAddHook = src
    .split("\n")
    .filter((line) => /DOMPurify\.addHook/.test(line))
    .filter((line) => !/^\s/.test(line));
  expect(topLevelAddHook).toEqual([]);
  expect(src).toContain("function ensureAttrHook");
});
```

Add `import { readFileSync } from "node:fs";` at the top of the test file if it is not already there.

- [ ] **Step 2: Run the four mutations by hand and record which test goes red**

For each row: make the edit, run the command, confirm RED, then revert the edit.

```bash
npx vitest run src/app/sanitize-html.test.ts --reporter=dot > /tmp/mut.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/mut.log
```

| # | Mutation in `sanitize-html.ts` | Must go red |
|---|---|---|
| 1 | delete `ALLOW_DATA_ATTR: false` from `sanitizeRichHtml` | "drops an unlisted data-* attribute" |
| 2 | delete `ADD_URI_SAFE_ATTR` from `sanitizeRichHtml` | "keeps data-align at each of the four legal values" |
| 3 | delete the `if (!isAllowedValue(...)) data.keepAttr = false;` line | "drops data-align at an illegal value" |
| 4 | move `DOMPurify.addHook(...)` to module top level | "never registers the DOMPurify hook at module eval" |

- [ ] **Step 3: Record the count in the commit body**

★★ A surviving mutant is a QUESTION, not a pass — "equivalent mutant" and "missing test" look identical from the harness. If any row stays green, the suite is missing an input; find it and add the case before moving on.

- [ ] **Step 4: Commit**

```bash
git add src/app/sanitize-html.test.ts
git commit -m "test(sanitize): pin the §140 boundary guards, 4/4 mutation-proved"
```

---

## Task 3: Text alignment, rewired to `data-align`

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/app/rich-text-editor.tsx`
- Test: `src/app/rich-text-editor.test.tsx`

- [ ] **Step 1: Re-measure the version before installing**

```bash
npm view @tiptap/extension-text-align version
npm view @tiptap/extension-text-align peerDependencies
node -p "require('./node_modules/@tiptap/core/package.json').version"
```
Expected shape (NOT specific numbers — the registry moves; it read `3.30.0` / peer `{'@tiptap/core':'3.30.0'}` on 2026-08-13 while installed core was `3.27.1`): **latest > installed, and the peer is an EXACT pin, not a range.** That is why the next step uses `-E`.

- [ ] **Step 2: Install pinned exact**

```bash
npm i -E @tiptap/extension-text-align@3.27.1
node -p "require('./package.json').dependencies['@tiptap/extension-text-align']"
```
Expected: `3.27.1` with **no** caret. A caret resolves to the newer release whose exact peer pin does not match installed core, and the install fails.

- [ ] **Step 3: Write the failing test**

Append to `src/app/rich-text-editor.test.tsx`:

```tsx
import { Editor } from "@tiptap/core";
import { EXTENSIONS } from "./rich-text-editor";

describe("alignment is stored as data-align, never as style (§140)", () => {
  it("serializes a centred paragraph with data-align and no style attribute", () => {
    const editor = new Editor({ extensions: EXTENSIONS, content: "<p>hello</p>" });
    editor.chain().selectAll().setTextAlign("center").run();
    const html = editor.getHTML();
    editor.destroy();
    expect(html).toContain('data-align="center"');
    expect(html).not.toContain("style=");
  });

  it("round-trips a stored data-align back into editor state", () => {
    const editor = new Editor({ extensions: EXTENSIONS, content: '<p data-align="right">hi</p>' });
    const active = editor.isActive({ textAlign: "right" });
    editor.destroy();
    expect(active).toBe(true);
  });

  it("survives the storage boundary unchanged", () => {
    const editor = new Editor({ extensions: EXTENSIONS, content: "<p>hello</p>" });
    editor.chain().selectAll().setTextAlign("justify").run();
    const html = editor.getHTML();
    editor.destroy();
    expect(sanitizeRichHtml(html)).toBe(html);
  });
});
```

Add `import { sanitizeRichHtml } from "./sanitize-html";` if the file does not already have it.

- [ ] **Step 4: Run to verify it fails**

```bash
npx vitest run src/app/rich-text-editor.test.tsx --reporter=dot > /tmp/s3.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s3.log
```
Expected: FAIL — `setTextAlign` is not a command yet.

- [ ] **Step 5: Register the rewired extension**

In `src/app/rich-text-editor.tsx`, add the import beside the other extension imports:

```tsx
import TextAlign from "@tiptap/extension-text-align";
```

And insert into `EXTENSIONS`, after `Superscript`:

```tsx
  // ★★★ REWIRED TO `data-align`, NOT the stock `style="text-align:…"`.
  // The storage boundary admits an attribute VALUE only from a fixed set
  // (sanitize-html.ts ATTR_VALUES). `style` survives DOMPurify — it is in
  // DEFAULT_URI_SAFE_ATTRIBUTES, so ALLOWED_URI_REGEXP never tests it — but
  // nothing parses a CSS value, so admitting `style` would let AI-writable
  // fields carry `position:fixed;inset:0;z-index:99999`. A 4-member string set
  // is a guard that cannot be widened a declaration at a time. §140.
  // ★ Only parseHTML/renderHTML change; the alignments filter, the commands
  // (setTextAlign / unsetTextAlign / toggleTextAlign) and the Mod-Shift-l/e/r/j
  // shortcuts are the stock extension's and are used as-is.
  // ★ `types` MUST be set — the extension's own default is [], i.e. inert.
  TextAlign.extend({
    addGlobalAttributes() {
      return [
        {
          types: this.options.types,
          attributes: {
            textAlign: {
              default: this.options.defaultAlignment,
              parseHTML: (element: HTMLElement) => {
                const alignment = element.getAttribute("data-align") ?? "";
                return this.options.alignments.includes(alignment)
                  ? alignment
                  : this.options.defaultAlignment;
              },
              renderHTML: (attributes: { textAlign?: string | null }) =>
                attributes.textAlign ? { "data-align": attributes.textAlign } : {},
            },
          },
        },
      ];
    },
  }).configure({ types: ["heading", "paragraph"] }),
```

- [ ] **Step 6: Run to verify it passes**

```bash
npx vitest run src/app/rich-text-editor.test.tsx --reporter=dot > /tmp/s3.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s3.log
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: PASS and `EXIT=0` for both.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/app/rich-text-editor.tsx src/app/rich-text-editor.test.tsx
git commit -m "feat(editor): text alignment stored as data-align (§140)"
```

---

## Task 4: Task list, serialized without a form control

**Files:**
- Modify: `src/app/rich-text-editor.tsx`
- Test: `src/app/rich-text-editor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe("task list serializes without a form control (§140)", () => {
  it("emits only data attributes — no input, label, span or div", () => {
    const editor = new Editor({ extensions: EXTENSIONS, content: "<p>buy milk</p>" });
    editor.chain().selectAll().toggleTaskList().run();
    const html = editor.getHTML();
    editor.destroy();
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-type="taskItem"');
    expect(html).toContain('data-checked="false"');
    for (const tag of ["<input", "<label", "<span", "<div"]) {
      expect(html).not.toContain(tag);
    }
  });

  it("survives the storage boundary unchanged", () => {
    const editor = new Editor({ extensions: EXTENSIONS, content: "<p>buy milk</p>" });
    editor.chain().selectAll().toggleTaskList().run();
    const html = editor.getHTML();
    editor.destroy();
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it("round-trips a checked item", () => {
    const stored =
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li></ul>';
    const editor = new Editor({ extensions: EXTENSIONS, content: stored });
    const html = editor.getHTML();
    editor.destroy();
    expect(html).toContain('data-checked="true"');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/rich-text-editor.test.tsx --reporter=dot > /tmp/s4.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s4.log
```
Expected: FAIL — `toggleTaskList` is not a command yet.

- [ ] **Step 3: Register TaskList and the overridden TaskItem**

Add the import (no install needed — `@tiptap/extension-list` is already a `starter-kit` dependency):

```tsx
import { TaskItem, TaskList } from "@tiptap/extension-list";
```

Insert into `EXTENSIONS`:

```tsx
  TaskList,
  // ★★★ renderHTML IS OVERRIDDEN AND THE NODEVIEW IS NOT. Read this before
  // "simplifying" it back to the stock extension.
  // The stock renderHTML emits
  //   <li data-type="taskItem" data-checked="…">
  //     <label><input type="checkbox"><span></span></label><div>…</div>
  //   </li>
  // — four tags (label/input/span/div) and two attrs (type/checked) beyond
  // RICH_ALLOWED_TAGS, on a list that SPREADS into DOCUMENT_ALLOWED_TAGS. And an
  // <input type=checkbox> whose only sibling is an empty <span> has no
  // accessible name, i.e. an axe-critical failure in Documents (an A11Y_VIEWS
  // member).
  // ★★ Overriding renderHTML costs NOTHING in editor UX, which is the whole
  // reason this is cheap: TaskItem also declares addNodeView, and the nodeView
  // owns the EDITING DOM (it builds the checkbox and sets checkbox.ariaLabel).
  // NodeViews are editor-only; getHTML() serializes through renderHTML. So the
  // editor keeps Tiptap's interactive labelled checkbox while storage gets
  // markup that needs zero new tags.
  // ★ The read-only consequence is handled in globals.css (a ::before glyph)
  // and in rich-text-plain.ts's markTaskItems (the "[x] " export prefix).
  TaskItem.extend({
    renderHTML({ HTMLAttributes, node }) {
      return [
        "li",
        { ...HTMLAttributes, "data-type": "taskItem", "data-checked": String(node.attrs.checked === true) },
        0,
      ];
    },
  }),
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/rich-text-editor.test.tsx --reporter=dot > /tmp/s4.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s4.log
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: PASS, `EXIT=0`.

- [ ] **Step 5: Mutation-check the override**

Comment out the `TaskItem.extend({...})` wrapper (register bare `TaskItem`), re-run. Expected: RED on "emits only data attributes". Revert.

- [ ] **Step 6: Commit**

```bash
git add src/app/rich-text-editor.tsx src/app/rich-text-editor.test.tsx
git commit -m "feat(editor): task list with attribute-only serialization (§140)"
```

---

## Task 5: Toolbar — five controls

**Files:**
- Modify: `src/app/rich-text-toolbar.tsx`
- Test: `src/app/rich-text-toolbar.test.tsx`

- [ ] **Step 1a: Extend the `makeEditor` stub FIRST — otherwise every new test throws**

`src/app/rich-text-toolbar.test.tsx` line 17 defines `makeEditor`, and it is not ready for these controls. Two concrete gaps, both fatal:

- Its `chain` object has no `toggleTaskList` / `toggleTextAlign`, so `spec.run(editor)` evaluates `undefined.run()` → `TypeError` the moment a test clicks one of the five new buttons.
- Its `isActive` is typed `(name: string, attrs?: { level?: number })`, but alignment calls `editor.isActive({ textAlign: "center" })` — an OBJECT in the first position. Today that silently keys `active["[object Object]"]` and returns `false`, so a pressed-state test would pass vacuously whatever the code does.

Patch both:

```tsx
    toggleBlockquote: () => chain, toggleCodeBlock: () => chain,
    toggleTaskList: () => chain,
    toggleTextAlign: (_alignment: string) => chain,
```

```tsx
  const editor = {
    // ★ Two call shapes: a NAME (+ optional level) for marks/blocks, and an
    // ATTRS OBJECT for alignment (`isActive({ textAlign })`). Keying the object
    // form off its single entry keeps one lookup table for both — without this
    // branch the object stringifies to "[object Object]" and every alignment
    // pressed-state assertion passes vacuously.
    isActive: (name: string | Record<string, string>, attrs?: { level?: number }) => {
      if (typeof name === "object") {
        const [k, v] = Object.entries(name)[0] ?? [];
        return active[`${k}:${v}`] ?? false;
      }
      return active[attrs?.level ? `${name}${attrs.level}` : name] ?? false;
    },
```

- [ ] **Step 1b: Write the failing tests**

Follow the file's own mount shape — `makeEditor()` then `render(<RichTextToolbar … />)`. There is no `renderToolbar` helper.

```tsx
it("exposes the task-list and four alignment controls by accessible name", () => {
  const { editor } = makeEditor();
  render(<RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />);
  for (const name of ["Task list", "Align left", "Align center", "Align right", "Justify"]) {
    expect(screen.getByRole("button", { name })).toBeTruthy();
  }
});

// ★ A deliberate change-detector, and it is NOT redundant with the existing
// "has TOOLBAR_CONTROL_COUNT enabled buttons" test. That one compares the DOM
// against the DERIVED constant, so both sides move together when a control is
// added and it stays green — it pins the WIRING, not the number. This pins the
// number, so adding a control is a conscious edit here.
it("renders exactly twenty controls", () => {
  expect(TOOLBAR_CONTROL_COUNT).toBe(20);
});

it("reports alignment pressed state through the attrs-object query", () => {
  const { editor } = makeEditor({ "textAlign:center": true });
  render(<RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />);
  expect(screen.getByRole("button", { name: "Align center" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Align left" }).getAttribute("aria-pressed")).toBe("false");
});

it("runs the alignment command on click", async () => {
  const { editor, run } = makeEditor();
  render(<RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Align right" }));
  expect(run).toHaveBeenCalled();
});
```

★ Accessible names are asserted as the literal EN strings the rest of this file already uses (it asserts `"Insert link"` / `"Remove link"` that way), not via `t(...)` — keep the file internally consistent.

★★ The existing order test at the bottom of the count block asserts `buttons[TOOLBAR_CONTROL_COUNT - 2]` is "Insert link" and `- 1` is "Remove link". Both stay TRUE after this task, because the five new controls join `CONTROLS` and Link/Unlink still render last. Do not renumber them.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/rich-text-toolbar.test.tsx --reporter=dot > /tmp/s5.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s5.log
```
Expected: FAIL — `TOOLBAR_CONTROL_COUNT` is 15, and the five accessible names do not exist. The existing count test stays GREEN throughout (it compares DOM to the derived constant), which is the point of adding the absolute assertion.

- [ ] **Step 3: Widen `ControlSpec` with an optional active predicate**

```ts
interface ControlSpec {
  key: TranslationKey;
  icon: ElementType;
  name: string;
  accent?: ToolbarButtonAccent;
  /** Overrides the default `editor.isActive(spec.name)` pressed-state query.
   *  ★ Alignment needs this because it is an ATTRIBUTE query
   *  (`isActive({ textAlign })`), not a node/mark NAME. `name` then serves only
   *  as the React key.
   *  ★★★ It is evaluated inside the `useEditorState` selector below and must
   *  stay there — the selector scopes re-render to a change in the SELECTED
   *  value, so any render-time `editor.` read left outside is refreshed only
   *  when some already-selected value happens to move, and is stale otherwise,
   *  with the suite green. */
  active?: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}
```

- [ ] **Step 4: Add the controls**

Extend the lucide import list with `AlignCenterIcon, AlignJustifyIcon, AlignLeftIcon, AlignRightIcon, ListChecksIcon` (all verified present in the installed `lucide-react`), keeping the list alphabetical.

Add `taskList` as the third entry of `BLOCKS`, between `orderedList` and `blockquote`:

```ts
  { key: "commTplTaskList", icon: ListChecksIcon, name: "taskList", run: (e) => e.chain().focus().toggleTaskList().run() },
```

Add the new group and fold it into `CONTROLS`:

```ts
/** Text alignment. `toggleTextAlign` is the stock command and already UNSETS
 *  when the caret is at that alignment, which is exactly 4-toggle-button
 *  semantics — do not hand-roll a set/unset branch.
 *  ★ Four inline toggles rather than a popover menu: a second PopoverPanel in
 *  this row would double the reach of open-followups §146 (Escape from a menu
 *  drops focus at document.body) on the very surface §144(a) built the keyboard
 *  contract for. The heading menu stays this row's only popover. */
const ALIGN: readonly ControlSpec[] = [
  { key: "commTplAlignLeft", icon: AlignLeftIcon, name: "align-left", active: (e) => e.isActive({ textAlign: "left" }), run: (e) => e.chain().focus().toggleTextAlign("left").run() },
  { key: "commTplAlignCenter", icon: AlignCenterIcon, name: "align-center", active: (e) => e.isActive({ textAlign: "center" }), run: (e) => e.chain().focus().toggleTextAlign("center").run() },
  { key: "commTplAlignRight", icon: AlignRightIcon, name: "align-right", active: (e) => e.isActive({ textAlign: "right" }), run: (e) => e.chain().focus().toggleTextAlign("right").run() },
  { key: "commTplAlignJustify", icon: AlignJustifyIcon, name: "align-justify", active: (e) => e.isActive({ textAlign: "justify" }), run: (e) => e.chain().focus().toggleTextAlign("justify").run() },
];

const CONTROLS: readonly ControlSpec[] = [...MARKS, ...BLOCKS, ...ALIGN];
```

Update the divider set — indices move because `taskList` was inserted at 10:

```ts
/** Dividers BEFORE these CONTROLS indices. MARKS occupy 0-7 (divider at 6
 *  splits the six marks from superscript/subscript); BLOCKS occupy 8-12
 *  (divider at 8 opens the group, at 11 splits the three lists from
 *  blockquote/code-block); ALIGN occupies 13-16 (divider at 13 opens it). */
const GROUP_DIVIDER_BEFORE = new Set([6, 8, 11, 13]);
```

`LINK_INDEX`, `UNLINK_INDEX` and `TOOLBAR_CONTROL_COUNT` need **no edit** — all three derive from `CONTROLS.length`.

- [ ] **Step 5: Route the pressed state through the predicate**

In the `useEditorState` selector:

```ts
      pressed: CONTROLS.map((spec) => (spec.active ? spec.active(live) : live.isActive(spec.name))),
```

- [ ] **Step 6: Fix the two stale in-file comments**

The header comment says task list and alignment "are deliberately ABSENT … Do not add a control here without widening the sanitizer first." The sanitizer HAS now been widened, so replace that paragraph:

```
// ★ Task list and text alignment ARE here as of §140, which widened the storage
// boundary to admit `data-align`, `data-type` and `data-checked` under a value
// allow-list (sanitize-html.ts ATTR_VALUES). The rule that produced the earlier
// absence still stands: no toolbar in this app may introduce a new HTML
// attribute on its own — the attribute surface is shared by every rich field
// AND by documents, so it is a security boundary that gets a designed slice and
// a review, never a toolbar button.
```

And the render comment "fifteen controls render inside four modals" → "twenty controls render inside four modals".

- [ ] **Step 7: Run to verify it passes**

```bash
npx vitest run src/app/rich-text-toolbar.test.tsx --reporter=dot > /tmp/s5.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s5.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/rich-text-toolbar.tsx; echo "EXIT=$?"
```
Expected: PASS, `EXIT=0` on all three. If `tsc` reports that `toggleTaskList`/`toggleTextAlign` do not exist on the chained-commands type, Task 3 or 4's registration was not completed — that is the module-augmentation trap from Orientation §4, not a bug in this file.

- [ ] **Step 8: Commit**

```bash
git add src/app/rich-text-toolbar.tsx src/app/rich-text-toolbar.test.tsx
git commit -m "feat(toolbar): task list + four alignment toggles, 15 -> 20 controls (§140)"
```

---

## Task 6: i18n

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, after `commTplSuperscript`, add:

```ts
  commTplTaskList: "Task list",
  commTplAlignLeft: "Align left",
  commTplAlignCenter: "Align center",
  commTplAlignRight: "Align right",
  commTplAlignJustify: "Justify",
  commTplTaskCheckbox: "Task item checkbox",
```

- [ ] **Step 2: Add the DE keys via a node utf8 write, NOT the Edit tool**

★★ `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts there (and curls double quotes) — it bites umlaut-free strings too. An LF-anchored replace silently no-ops; the anchor below uses `\r\n`.

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const s = fs.readFileSync(p, "utf8");
const anchor = "  commTplSuperscript:";
const i = s.indexOf(anchor);
if (i === -1) throw new Error("anchor not found");
const eol = s.indexOf("\r\n", i);
if (eol === -1) throw new Error("no CRLF after anchor — file may have been converted to LF");
const add =
  "\r\n  commTplTaskList: \"Aufgabenliste\"," +
  "\r\n  commTplAlignLeft: \"Linksbündig\"," +
  "\r\n  commTplAlignCenter: \"Zentriert\"," +
  "\r\n  commTplAlignRight: \"Rechtsbündig\"," +
  "\r\n  commTplAlignJustify: \"Blocksatz\"," +
  "\r\n  commTplTaskCheckbox: \"Kontrollkästchen der Aufgabe\",";
fs.writeFileSync(p, s.slice(0, eol) + add + s.slice(eol), "utf8");
console.log("inserted");
'
```

★★ The `ü` / `ä` escapes above are for the SHELL SCRIPT only — they are written as real bytes into the file. The `i18n-encoding` test BANS ASCII substitutions (`fuer`, `buendig`) in the file itself, and a separate rule bans `\uXXXX` escapes appearing in the committed source. Verify in the next step that real umlauts landed.

- [ ] **Step 3: Verify the bytes**

```bash
grep -n "commTplAlignLeft\|commTplTaskCheckbox" src/app/i18n.de.ts
node -e 'const s=require("fs").readFileSync("src/app/i18n.de.ts","utf8"); const l=s.split("\r\n").filter(x=>/commTplAlign|commTplTask/.test(x)); console.log(l.join("\n")); console.log("has real umlaut:", /[äöüÄÖÜß]/.test(l.join("")))'
```
Expected: six lines printed, `has real umlaut: true`, and no `\u` escape visible in the file.

- [ ] **Step 4: Typecheck — this is what enforces EN/DE key parity**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n --reporter=dot > /tmp/s6.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s6.log
```
Expected: `EXIT=0` both. A missing DE key is a tsc error, not a test failure.

- [ ] **Step 5: Wire the checkbox label**

In `src/app/rich-text-editor.tsx`, configure the overridden `TaskItem` so the nodeView's accessible name is translated instead of Tiptap's hardcoded English `"Task item checkbox for …"`. `EXTENSIONS` is a module-level constant with no `lang` in scope, so pass the key's EN string and leave localisation of this one nodeView label as a follow-up ONLY if `EXTENSIONS` cannot be parameterised without restructuring — otherwise add `.configure({ a11y: { checkboxLabel: () => t(lang, "commTplTaskCheckbox") } })` where a `lang` is available.

★ Decide this explicitly and record the choice in the commit body. Do not leave a hardcoded English string in place silently.

- [ ] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/rich-text-editor.tsx
git commit -m "i18n: task list + alignment control labels (§140)"
```

---

## Task 7: CSS — in-app and standalone HTML

**Files:**
- Modify: `src/app/globals.css`, `src/app/doc-render-html.ts`
- Test: `src/app/doc-render-html.test.ts`

- [ ] **Step 1: Write the failing test for the standalone renderer**

```ts
it("emits the task-list and alignment rules in standalone mode", () => {
  const html = renderDocumentHtml(doc, ws, "en-US", "standalone");
  expect(html).toContain('[data-align="center"]');
  expect(html).toContain('li[data-type="taskItem"]');
});
```

★ Reuse the file's existing `doc` / `ws` fixtures and its own `renderDocumentHtml` call shape — do not invent new ones.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/doc-render-html.test.ts --reporter=dot > /tmp/s7.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s7.log
```
Expected: FAIL.

- [ ] **Step 3: Add the rules to `globals.css`**

Append, OUTSIDE any `@media print` block:

```css
/* §140 — rich-text attributes. Deliberately attribute selectors, not Tailwind
   utilities: Tailwind v4 emits a utility only if it finds the class name while
   scanning repo files, and `text-justify` appears ZERO times in src/, so a
   class-based alignment would silently have no rule for one of its four
   values. An attribute selector has no such dependency. */
[data-align="left"] { text-align: left; }
[data-align="center"] { text-align: center; }
[data-align="right"] { text-align: right; }
[data-align="justify"] { text-align: justify; }

/* Task list. The stored markup carries NO <input> on purpose (see
   rich-text-editor.tsx TaskItem) — the editor's nodeView supplies the real
   checkbox, and read-only surfaces get this glyph.
   ★★ KNOWN LIMIT, recorded in open-followups: generated content is exposed to
   the accessibility tree as a character name, not as "checked". This avoided an
   axe-critical UNLABELED CONTROL; it does not make read-only announcement
   equivalent to a real checkbox. */
ul[data-type="taskList"] { list-style: none; padding-left: 0; }
li[data-type="taskItem"] { display: flex; gap: 0.5rem; }
li[data-type="taskItem"]::before { content: "\2610"; }
li[data-type="taskItem"][data-checked="true"]::before { content: "\2611"; }
```

★ CSS `\2610` / `\2611` escapes are used rather than literal glyphs: this file is scanned by Tailwind and read by several tools, and the escape is unambiguous under any encoding. Both are BMP characters, so a literal would also work — the escape is for reviewability.

★★ NEVER put a `*` wildcard inside a Tailwind arbitrary-value bracket anywhere in a tracked file — Tailwind emits it as invalid CSS and `globals.css` fails to compile, 500-ing the app. Nothing above uses one; keep it that way.

- [ ] **Step 4: Add the same rules to the standalone document renderer**

In `src/app/doc-render-html.ts`, extend `DOCUMENT_PAGE_STYLES`:

```ts
const DOCUMENT_PAGE_STYLES = `
    @page { size: A4 portrait; margin: 18mm 16mm; }
    .page-break { break-after: page; page-break-after: always; height: 0; }
    [data-align="left"] { text-align: left; }
    [data-align="center"] { text-align: center; }
    [data-align="right"] { text-align: right; }
    [data-align="justify"] { text-align: justify; }
    ul[data-type="taskList"] { list-style: none; padding-left: 0; }
    li[data-type="taskItem"] { display: flex; gap: 0.5rem; }
    li[data-type="taskItem"]::before { content: "\\2610"; }
    li[data-type="taskItem"][data-checked="true"]::before { content: "\\2611"; }`;
```

★★★ Do NOT move this constant relative to `PRINT_STYLES` in the interpolation. The file's own ★★★ note explains why: `@page` declarations cascade, so the LAST `size` wins, and `DOCUMENT_PAGE_STYLES` must come after `PRINT_STYLES` or the document silently prints landscape. The suite asserts relative POSITION for exactly this reason.

★ The double backslash is required — this is a JS template literal, so `\2610` would be parsed as a JS escape.

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run src/app/doc-render-html.test.ts --reporter=dot > /tmp/s7.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s7.log
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/app/doc-render-html.ts src/app/doc-render-html.test.ts
git commit -m "feat(render): alignment + task-list styles in app and standalone HTML (§140)"
```

---

## Task 8: The `[x]` / `[ ]` prefix for flat exports

**Files:**
- Modify: `src/app/rich-text-plain.ts`, `src/app/rich-text-projection.ts`
- Test: `src/app/rich-text-projection.test.ts`

**Why this shape.** `descriptionText` (search, AI digests) and `descriptionTextWithBreaks` (every flat export, via `richCell`) BOTH begin with `separateBlockBoundaries(descriptionHtml(...))`, and `separateBlockBoundaries` has exactly two non-test call sites — both in `rich-text-projection.ts`. So one helper applied at those two sites reaches both projections from a single implementation. It deliberately does NOT touch `htmlPlainProjection`, which feeds `htmlTextLength` → `capHtmlText` → `sanitizeRichText` → all six backends: changing that would move stored caps and byte-stability fixtures.

- [ ] **Step 1: Write the failing test**

```ts
const TASKS =
  '<ul data-type="taskList">' +
  '<li data-type="taskItem" data-checked="true"><p>done thing</p></li>' +
  '<li data-type="taskItem" data-checked="false"><p>open thing</p></li>' +
  "</ul>";

it("marks task state in the flat export projection", () => {
  const out = descriptionTextWithBreaks(TASKS);
  expect(out).toContain("[x] done thing");
  expect(out).toContain("[ ] open thing");
});

it("marks task state in the search/AI projection too — one implementation", () => {
  const out = descriptionText(TASKS);
  expect(out).toContain("[x] done thing");
  expect(out).toContain("[ ] open thing");
});

it("leaves non-task HTML byte-identical", () => {
  expect(descriptionText("<p>plain</p><p>text</p>")).toBe("plain text");
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/rich-text-projection.test.ts --reporter=dot > /tmp/s8.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s8.log
```
Expected: FAIL on the first two.

- [ ] **Step 3: Add the DOM-free helper**

In `src/app/rich-text-plain.ts`, beside `separateBlockBoundaries`:

```ts
/** Visible markers for a task item's checked state, used by the plain-text
 *  projections so a flat export states the state instead of dropping it.
 *  ONE definition — both projections call the same helper, so they cannot
 *  drift into two spellings. */
export const TASK_MARK_CHECKED = "[x] ";
export const TASK_MARK_UNCHECKED = "[ ] ";

/** Replaces a task item's opening tag with its state marker.
 *
 *  ★★ DOM-FREE, like everything else in this module — it runs inside the entity
 *  sanitizers' call graph, which executes under bare node in the sample
 *  generator. Regex, not DOMParser.
 *
 *  ★★★ The markers land in a String.replace REPLACEMENT position, where "$`"
 *  and "$&" are special. Both constants above are literal square brackets and
 *  an x/space, so neither contains "$" — do NOT parameterise this with a
 *  caller-supplied string without escaping "$" first.
 *
 *  ★ Applied ONLY at the two projection sites, never inside
 *  htmlPlainProjection: that one feeds htmlTextLength -> capHtmlText ->
 *  sanitizeRichText -> all six backends, so a prefix there would move stored
 *  caps and every byte-stability fixture. */
export function markTaskItems(html: string): string {
  return html.replace(
    /<li\b[^>]*\bdata-type\s*=\s*"taskItem"[^>]*>/gi,
    (tag) => (/\bdata-checked\s*=\s*"true"/i.test(tag) ? TASK_MARK_CHECKED : TASK_MARK_UNCHECKED),
  );
}
```

- [ ] **Step 4: Apply it at the two projection sites**

In `src/app/rich-text-projection.ts`, wrap the upgraded HTML in both functions:

```ts
export function descriptionText(stored: string | undefined): string {
  return htmlPlainProjection(
    htmlToText(separateBlockBoundaries(markTaskItems(descriptionHtml(stored, "projection")))),
  );
}
```

```ts
export function descriptionTextWithBreaks(stored: string | undefined): string {
  return htmlPlainProjection(
    htmlToText(separateBlockBoundaries(markTaskItems(descriptionHtml(stored, "projection")), "\n"), {
      preserveBreaks: true,
    }),
    { preserveBreaks: true },
  );
}
```

★ `markTaskItems` runs BEFORE `separateBlockBoundaries` — it must see the `<li>` tag intact, and `separateBlockBoundaries` replaces block tags with a separator.

Add `markTaskItems` to the existing import from `./rich-text-plain`.

- [ ] **Step 5: Run to verify it passes, then run the byte-stability suites**

```bash
npx vitest run src/app/rich-text-projection.test.ts src/app/rich-text-plain.test.ts src/app/rich-text-plain.property.test.ts --reporter=dot > /tmp/s8.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s8.log
npx vitest run src/app/golden-workspace --reporter=dot > /tmp/s8b.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/s8b.log
```
Expected: PASS on both. `golden-workspace` must be untouched — no fixture carries a task list, and this slice deliberately does not add one to `sample-workspace-small.json`. A red golden here means the prefix leaked into `htmlPlainProjection`.

- [ ] **Step 6: Commit**

```bash
git add src/app/rich-text-plain.ts src/app/rich-text-projection.ts src/app/rich-text-projection.test.ts
git commit -m "feat(export): state task-item checked state in the plain-text projection (§140)"
```

---

## Task 9: Correct the three doc claims this slice falsifies

Three files carry the same claim in three places, and all three go false the moment Task 1 lands. None is gated — `docs:symbols:check` proves a NAME exists, never that a CLAIM is true.

**Files:**
- Modify: `AGENTS.md`, `docs/AGENTS/ai-assistant.md`, `docs/CODEMAPS/data.md`

- [ ] **Step 1: Re-measure the three differences on the NEW code**

```bash
node -e '
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
(async () => {
  const m = await import("./src/app/sanitize-html.ts");
  console.log("data-foo rich:", m.sanitizeRichHtml("<p data-foo=\"1\">a</p>"));
  console.log("data-foo doc :", m.sanitizeDocumentHtml("<p data-foo=\"1\">a</p>"));
  console.log("img rich     :", m.sanitizeRichHtml("<p>a</p><img src=\"x.png\"><p>b</p>"));
  console.log("img doc      :", m.sanitizeDocumentHtml("<p>a</p><img src=\"x.png\"><p>b</p>"));
})();
' 2>&1 | tail -6
```

★ Run this with `npx vite-node` if the bare `node` import of a `.ts` file fails — the repo already uses `vite-node` for `scripts/generate-sample-workspace.ts`.

Expected after Task 1: **both** sanitizers now drop `data-foo`, so the `data-*` row is no longer a difference. Record the actual output; write the replacement from THAT, not from this expectation.

- [ ] **Step 2: Rewrite the claim in all three files**

The bullet currently reads "the BEHAVIOUR delta is three things and exactly ONE of them widens", enumerating (a) `img` dropped, (b) `data-*` newly admitted — WIDENING, (c) cap cut 20 000 → 5 000. After §140 the count is **TWO** and **none widens**: (a) and (c) survive, (b) is gone.

Replace it in each file with a statement built from Step 1's measured output, and add a line recording that (b) was closed by §140 rather than deleting it silently — a reader who remembers the old three-item list will otherwise assume the doc is stale.

- [ ] **Step 3: Fix the two counts in AGENTS.md**

- "`RichTextToolbar` renders FIFTEEN controls whose names repeat verbatim in every editor — eight marks (`MARKS`), four blocks (`BLOCKS`), Link, Unlink, and the heading menu trigger" → twenty, with the group breakdown updated (eight marks, **five** blocks, **four** alignments, Link, Unlink, heading trigger).
- Do NOT touch "it cost 15 tab stops per editor" — that sentence describes the PRE-§144(a) state and is historical. Read it in context before editing anything containing "15".

- [ ] **Step 4: Update the §140 paragraph in AGENTS.md's rich-text bullet**

It currently says task list and alignment are unbuilt and blocked on the attribute boundary, and that `sanitizeRichHtml` inherits `ALLOW_DATA_ATTR`'s default. Both are now false. State what shipped and keep the RULE that produced the caution ("no toolbar may introduce a new HTML attribute on its own").

- [ ] **Step 5: Verify no claim was replaced with an unverified one**

```bash
npm run docs:symbols:check > /tmp/d1.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/d1.log
npm run docs:claims:check > /tmp/d2.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/d2.log
```
Expected: `EXIT=0` both.

★★★ Green here proves only that names exist and that no NEW `path:LINE` citation was added. It cannot tell you a replacement sentence is true. **Run a command against each replacement sentence, not against the error it replaces** — a correction is a new claim and inherits none of the verification of the thing it corrects. The last three branches each shipped correction rounds that introduced fresh falsehoods this way.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md docs/AGENTS/ai-assistant.md docs/CODEMAPS/data.md
git commit -m "docs: the rich/document sanitizer delta is two, not three — §140 closed the data-* row"
```

---

## Task 10: Register

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Close §140**

Retitle to CLOSED with the date. Reproduce, in the entry itself, the decisions that live only in the gitignored spec: why `data-align` beat `style` and `class`; the `ALLOW_DATA_ATTR:false` → `ADD_URI_SAFE_ATTR` → hook chain and why each link is required; the lazy-registration SSR reason; and the TaskItem `renderHTML`-vs-nodeView finding (which the entry never had — it is the reason the tag list did not have to grow by four).

- [ ] **Step 2: Close §115 and §117(b)**

§115: closed by `ALLOW_DATA_ATTR: false` on the one remaining offender, with the re-admission set now non-empty (three names) rather than the empty set the entry predicted. Say so — the entry's own analysis said the fix was two lines *because* the set was empty, and that reasoning no longer holds.

§117: mark (b) CLOSED, leave (a) and (c) open, and note that (b)'s guard is the shared `ATTR_VALUES` table so a future image slice inherits it.

- [ ] **Step 3: Amend §141(b) — this is the item most at risk of being dropped**

Add to §141(b), dated, naming the three renderers:

> **Extended 2026-08-13 by §140.** The entity rich fields can now also carry TASK LISTS and TEXT ALIGNMENT. Alignment is a paragraph-level property and `htmlToRichLines` returns styled RUNS, so it cannot be carried by the existing model — this needs a new LINE-level field on that type plus a mapping in `doc-render-docx.ts` and `doc-render-pptx.ts`. Task items need the equivalent of the `[x]` / `[ ]` marker that `markTaskItems` gives the flat projections. §140 shipped in-app CSS, standalone HTML/PDF and the flat-text prefix; DOCX and PPTX are the stated gap.

- [ ] **Step 4: Record the read-only checkbox a11y limit**

New entry (take the next free number — the register's index header records it; it was **§147** as of 0.236.0, so confirm before using it). Content: task-item checked state in read-only surfaces is a `::before` glyph plus `data-checked`, exposed to AT as a character name rather than as "checked"; the `content: "☑" / "checked"` alt-text syntax is the candidate fix but support is uneven; axe cannot see this.

- [ ] **Step 5: Update the register's index header**

The file's header carries the max entry number and the next free one. Bump both.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md
git commit -m "docs(register): close §140/§115/§117b, extend §141b with the owed DOCX/PPTX work"
```

---

## Task 11: Release

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`

- [ ] **Step 1: Bump `src/app/version.ts`**

`APP_VERSION` → `0.237.0`, `APP_BUILD_DATE` → today, plus the milestone/codename. ★ The codename must be unique — check `CHANGELOG.md` before choosing, and note the file may be CRLF (an LF-anchored node replace silently no-ops).

- [ ] **Step 2: Add the CHANGELOG entry**

★ NEVER put a `[session link removed]...` URL in `CHANGELOG.md` or an MR description.

- [ ] **Step 3: Bump the five ungated places — no gate checks any of them**

```bash
node -e '
const v = require("./src/app/version.ts") // if this fails, read the constant with grep instead
' 2>/dev/null
grep -n "\"version\"" package.json
grep -n "\"version\"" package-lock.json | head -3
grep -n "shields\|badge" README.md | head -5
grep -rn "<!-- Generated:" docs/CODEMAPS/*.md
```
Update: `package.json` `version`; **both** `package-lock.json` occurrences (root `version` and `packages[""]`); the README shields badge (version **and** codename); the `<!-- Generated: … -->` header on all five `docs/CODEMAPS/*.md`.

- [ ] **Step 4: Verify every place agrees**

```bash
grep -rn "0\.237\.0" package.json package-lock.json README.md src/app/version.ts docs/CODEMAPS/*.md CHANGELOG.md | wc -l
```
Expected: at least 10 lines (1 version.ts + 1 package.json + 2 lock + 1 README + 5 codemaps + changelog).

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS
git commit -m "chore(release): 0.237.0"
```

---

## Task 12: Full gates and review

- [ ] **Step 1: Run every gate, unpiped**

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npm run test:run > /tmp/full.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/full.log
npm run test:shuffle > /tmp/shuf.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuf.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/cov.log
npm run dup:check > /tmp/dup.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/dup.log
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/size.log
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "EXIT=$?"
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "EXIT=$?"
npm audit --production > /tmp/audit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/audit.log
```

★ `test:shuffle` is the only local reproduction of the BLOCKING `unit-tests-shuffled` job, and this slice adds tests. Do not skip it.

- [ ] **Step 2: Run the prod-CSP smoke — the only gate that sees the prod policy**

```bash
npm run build > /tmp/build.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/build.log
npm run e2e:smoke:prod > /tmp/smoke.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/smoke.log
```
A new Tiptap extension is exactly the class of change §54 hid behind. `TextAlign`'s source injects no CSS, which is a reason to EXPECT green — not a reason to skip. If port 3200 is held, free it first; the script refuses to run rather than kill a foreign server.

- [ ] **Step 3: Run axe on the affected views, serially**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 > /tmp/axe.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/axe.log
```
★★★ `--workers=1` is mandatory whenever more than one view is matched: CI runs axe serially and local defaults to CPU-count, and over-subscription produces `Test timeout of 60000ms exceeded` inside `page.evaluate` — a failure with no rule id and no impact, i.e. NOT a violation. Read the failure body, never the summary line. Warm the route first so a cold Turbopack compile does not eat the 60s budget.

★ axe is structurally silent about this slice: the e2e seed contains no task list and no alignment, so the scan renders neither. A green run here says nothing about §140 — the unit tests are the only detector.

- [ ] **Step 4: Security review**

Dispatch `security-reviewer` on the `sanitize-html.ts` diff specifically. Scope it: the value table, the hook's rejection path, the `ADD_URI_SAFE_ATTR` exemptions, and whether any admitted value can reach a sink that interprets it.

- [ ] **Step 5: Cold review**

Dispatch a reviewer with NO context from this session, briefed to REFUTE the branch's claims rather than confirm them. Ask explicitly for: a mutation COUNT on the new guards, and any doc sentence in the diff whose attached command does not actually support it. Every prior branch's correction round introduced new falsehoods; the cold read is what catches them.

- [ ] **Step 6: Eye-verify**

jsdom has no layout, so nothing in the unit suite has seen the toolbar at twenty controls in a narrow modal, or the task-list glyph alignment. Check by eye in `change-edit-modal` (three editors) and the notes window, in one light and one dark scheme.

- [ ] **Step 7: Final commit and stop**

Do NOT push, open an MR, or merge without an explicit instruction. "Release" means push → MR → poll → merge on green, and merge only after the pipeline is green — never `--auto-merge`.

---

## Self-review

**Spec coverage** — every numbered spec item maps to a task:

| Spec | Task |
|---|---|
| §4.1 table · §4.2 lazy hook · §4.3 config chain | 1 |
| §7.1 boundary tests · §7.2 mutations · §7.3 source scan | 1, 2 |
| §3 + §5.1 alignment as `data-align` | 3 |
| §5.2 TaskItem renderHTML override | 4 |
| §5.3 toolbar, 15 → 20, `ControlSpec.active` | 5 (incl. 1a, the stub extension) |
| §5.4 i18n | 6 |
| §6.1 CSS in-app + standalone | 7 |
| §6.3 `[x]` prefix, single implementation | 8 |
| §6.2 stated a11y limit | 10 (step 4) |
| §8 doc decay (3 claims + 2 counts) | 9 |
| §8 register + release | 10, 11 |
| §7.5 tsc trap · §7.6 axe silence · §7.7 gates · §7.8 review | 5 (step 7), 12 |

**Refinement over the spec, recorded here rather than left implicit:** §6.3 asked for "one exported constant plus a test asserting both paths agree". Task 8 does better — because `separateBlockBoundaries` has exactly two non-test call sites and both projections pass through it, ONE helper at those two sites reaches both paths structurally, so the two implementations the spec worried about never come into existence. The spec's constraint is satisfied more strongly than it was written.

**Placeholder scan:** no TBD/TODO. Two steps deliberately require a decision at implementation time rather than pre-deciding: Task 6 Step 5 (whether `EXTENSIONS` can be parameterised for the checkbox label) and Task 11 Step 1 (the codename must be unique against `CHANGELOG.md`). Both say explicitly what to decide and to record the choice.

**Three defects found and fixed during this self-review**, all in Task 5 and all of the same class — a claim about existing code that a command refutes:

1. The first draft called a helper `renderToolbar()`. `grep -n "function renderToolbar" src/app/rich-text-toolbar.test.tsx` returns nothing — it does not exist. Replaced with the file's real `makeEditor()` + `render(<RichTextToolbar … />)` shape.
2. The stub `chain` has no `toggleTaskList`/`toggleTextAlign`, so the first click test would have thrown `TypeError: Cannot read properties of undefined (reading 'run')`. Now Step 1a.
3. The stub `isActive` is `(name: string, …)` while alignment queries `isActive({ textAlign })`. Unpatched it keys `active["[object Object]"]` and returns `false` — so a pressed-state test would pass **vacuously whatever the implementation does**. That is the worst of the three, because it fails silently green. Also Step 1a.

**Type consistency:** `ATTR_VALUES`, `GUARDED_DATA_ATTR`, `ensureAttrHook`, `attrHookRegistered`, `ALIGN`, `markTaskItems`, `TASK_MARK_CHECKED`, `TASK_MARK_UNCHECKED`, `TOOLBAR_CONTROL_COUNT`, `ControlSpec.active` are spelled identically at every appearance. `GUARDED_DATA_ATTR` is declared before `ALLOWED_ATTR` uses it (Task 1 Step 3 says so explicitly, since `const` is not hoisted for initializer use). The hook event property names `attrName` / `attrValue` / `keepAttr` match dompurify 3.4.13's `UponSanitizeAttributeHookEvent` declaration.
