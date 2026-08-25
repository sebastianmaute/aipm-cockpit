# Asset-id extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 20-image per-document cap count only real asset references — not prose a user typed, and not a phantom id bled out of a neighbouring `alt` — then collect the three spellings of that attribute pattern into one module.

**Architecture:** `ASSET_ID_RE` (`document-asset-usage.ts`) is a bare `/data-asset-id="([^"]*)"/g` with no tag anchor and no quote awareness. Replace it with the quote-stepping shape `IMG_TAG_RE` already uses, anchored on any start tag so the cap stays tag-agnostic (open-followups §218 — a `<span data-asset-id>` must keep counting for deletion safety). Then move all three patterns into a new DOM-free `document-asset-patterns.ts` that imports nothing. Behaviour change first, structural move second, so the behaviour change is never buried inside a refactor.

**Tech Stack:** TypeScript, vitest, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-asset-id-extraction-design.md`

---

## Background the engineer needs

Three regexes read `data-asset-id` today. They are **deliberately different** and merging them is a
defect, not a cleanup:

| pattern | file | anchor | quoting | attr case | global | captures |
|---|---|---|---|---|---|---|
| `ASSET_ID_RE` | `document-asset-usage.ts` | none (any element) | `"` only | sensitive | yes | id |
| `IMG_TAG_RE` | `document-export-assets.ts` | `<img …>` | `"` only | sensitive | yes | id |
| `ASSET_IMG_RE` | `document-model.ts` | `<img` | `"` / `'` / bare | INsensitive | no | nothing |

- `ASSET_ID_RE` backs the **cap** and the "used in N documents" column. Tag-agnostic on purpose.
- `IMG_TAG_RE` backs **exports**. `<img>`-anchored on purpose — an export must only fetch bytes for
  something it can draw. **This plan does not change its behaviour at all.**
- `ASSET_IMG_RE` is a `.test()`-only **load survival predicate**: does this image-only paragraph
  survive load? It runs BEFORE any allow-list pass, which is why it is case-insensitive and accepts
  all three quoting styles.

Only `ASSET_ID_RE` changes behaviour in this plan.

**Reproduce the current defect before starting** (this is the spec's probe, already committed):

```bash
node docs/superpowers/specs/_probes/asset-id-extraction.mjs
```

Expected: a markdown table where the `all` today column shows `["abc"]` for `<p>data-asset-id="abc"</p>`
and `[" data-asset-id="]` for the crafted-`alt` row, and the `all` after column shows `[]` and `["real"]`.

## Repo rules that will bite you here

- **Never read a gate's exit code through a pipe.** `npm run test:run | tail -5` reports `tail`'s
  status. Redirect, echo `$?` unpiped, then read the file.
- **`npx tsc --noEmit` exits 2 on diagnostics**, not 1.
- **Use `npx eslint src`**, not `npm run lint` — the latter exits 1 on gitignored leftovers.
- **Never run two vitest processes at once.**
- **`src/app/*.ts` is CRLF.** If you patch by script, anchor on `\r\n`. Do not use `sed -i` on these
  files — under Git Bash it silently re-lines the whole file to LF.
- **Do not `git commit --amend`.** New commits only; `git commit --only <paths>` to scope.
- **Do not push, open an MR, or merge.** Not part of this plan; it needs an explicit instruction.

## File Structure

| file | responsibility | task |
|---|---|---|
| `src/app/document-asset-usage.ts` | MODIFY — the cap/usage scanner; pattern swap + header rewrite | 1, 3 |
| `src/app/document-asset-usage.test.ts` | MODIFY — invert two characterization tests, add two cases | 1, 3 |
| `src/app/document-asset-patterns.ts` | CREATE — all three patterns, DOM-free, imports nothing | 3 |
| `src/app/document-asset-patterns.test.ts` | CREATE — divergence table + DOM-free source scan | 3 |
| `src/app/document-export-assets.ts` | MODIFY — `IMG_TAG_RE` declaration leaves, re-export stays | 3 |
| `src/app/document-model.ts` | MODIFY — import the load predicate instead of declaring it | 3 |
| `docs/open-followups.md` | MODIFY — close §231, narrow §209 | 4 |
| `src/app/version.ts`, `CHANGELOG.md`, + 5 ungated places | MODIFY — release stamp | 5 |

---

### Task 1: Make the cap count only real references

**Files:**
- Modify: `src/app/document-asset-usage.ts` (the `ASSET_ID_RE` declaration, and the module header)
- Test: `src/app/document-asset-usage.test.ts`

- [ ] **Step 1: Invert the first characterization test**

In `src/app/document-asset-usage.test.ts`, find the test named
`"does NOT escape a data-asset-id a user merely TYPED as prose"`. Its sanitizer claim stays and stays
asserted; only the consequence flips. Replace the whole `it(...)` block with:

```typescript
  it("does NOT escape a data-asset-id a user merely TYPED as prose, and no longer counts it", () => {
    // A user documenting this very app, or pasting HTML to talk about it.
    const loaded = loadFully(`<p>data-asset-id="hero"</p>`);
    const [block] = loaded.blocks;

    // ★ The positive observable, and it is the half that did NOT change: HTML
    //   text-node serialisation escapes `&`, `<` and `>` and NEVER `"`, so the
    //   string survives a full load verbatim. Without this assertion the empty
    //   id sets below could pass because the block had been dropped.
    expect(block.type === "paragraph" && block.html).toContain(`data-asset-id="hero"`);

    // ★★ What CHANGED (open-followups §231): the scanner now requires a start
    //    tag, so prose spends no slot of the 20-image cap and contributes
    //    nothing to the reclaimable-room figure the cap message renders.
    const refs = assetRefsInDocument(loaded);
    expect([...refs.all]).toEqual([]);
    expect([...refs.drawable]).toEqual([]);
    expect([...refs.undrawable]).toEqual([]);
  });
```

- [ ] **Step 2: Invert the second characterization test, keeping its constructor half separate**

Find the test named ``"lets a crafted alt put an id in `drawable` that is NOT in `all`"``. Replace the
whole `it(...)` block with these TWO tests:

```typescript
  it("no longer lets a crafted alt hide the real id from `all`", () => {
    // ★★ `htmlEscape` escapes `& < > "` but NOT `=`, and an asset NAME is free
    //    text (rename), so `alt` can end in `data-asset-id=`. The OLD scanner
    //    paired that trailing `=` with the REAL attribute's opening quote and
    //    produced a phantom id while the real one went missing — an id that
    //    spends no cap slot and can be re-inserted, defeating dedup.
    //    open-followups §231, half two.
    const loaded = loadFully(`<img alt="data-asset-id=" data-asset-id="real">`);
    const [block] = loaded.blocks;
    expect(block.type === "paragraph" && block.html).toContain(`data-asset-id="real"`);

    const refs = assetRefsInDocument(loaded);
    expect([...refs.all]).toEqual(["real"]);
    expect([...refs.drawable]).toEqual(["real"]);
    expect([...refs.undrawable]).toEqual([]);
  });

  it("keeps `undrawable` a subset of `all` by construction", () => {
    // ★★ THIS PINS THE CONSTRUCTOR, NOT A FIXTURE. `undrawable` is BUILT by
    // filtering `all`, so this is constant-true for every input — and it is
    // kept deliberately: the cap message's reclaimable-room arithmetic in
    // documents-asset-section subtracts one size from the other and would go
    // NEGATIVE if a later fix rebuilt `undrawable` from a second scan.
    const loaded = loadFully(`<span data-asset-id="s">x</span><img data-asset-id="i">`);
    const refs = assetRefsInDocument(loaded);
    expect([...refs.undrawable].every((id) => refs.all.has(id))).toBe(true);
  });
```

- [ ] **Step 3: Add the two new cases**

Append these two tests inside the SAME `describe("what being ALREADY-SANITIZED does and does not buy this module", ...)` block, after the tests from Steps 1 and 2:

```typescript
  it("finds BOTH ids when one paragraph holds two images and the first has a crafted alt", () => {
    // ★★★ ORDER ALONE WAS NEVER THE PROTECTION. The old scanner crossed `<img>`
    //     boundaries WITHIN a block: it paired the first tag's alt with the
    //     SECOND tag's markup and yielded `["r1", "><img data-asset-id="]`, so
    //     the second real image was invisible to the cap entirely.
    const loaded = loadFully(
      `<img data-asset-id="r1" alt="data-asset-id="><img data-asset-id="r2" alt="x">`,
    );
    const refs = assetRefsInDocument(loaded);
    expect([...refs.all].sort()).toEqual(["r1", "r2"]);
    expect([...refs.drawable].sort()).toEqual(["r1", "r2"]);
  });

  it("does not count the attribute spelled without a space after the tag name", () => {
    // ★ The THIRD behaviour change, beyond §231's two halves, pinned so it is
    //   not latent: `<imgdata-asset-id="x">` is malformed HTML (the tag name
    //   swallows the attribute) and used to count. It cannot survive the load
    //   path either, so this asserts the SCANNER directly rather than through
    //   loadFully — which is the only way to observe it.
    const raw: ProjectDocument = doc(99, [
      { type: "paragraph", html: `<imgdata-asset-id="x">` },
    ]);
    expect([...assetRefsInDocument(raw).all]).toEqual([]);
  });
```

- [ ] **Step 4: Run the tests and verify they FAIL**

```bash
npx vitest run src/app/document-asset-usage.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests |✗|×" /tmp/t1.log | head -20
```

Expected: `EXIT=1`, with four failures — the two inverted tests, the two-image bleed, and the glued
tagname. The `undrawable` subset test should already PASS (it is constant-true).

If the two-image test passes here, stop: the fixture is not reaching the scanner and the test is
vacuous.

- [ ] **Step 5: Change the pattern**

In `src/app/document-asset-usage.ts`, replace the declaration:

```typescript
const ASSET_ID_RE = /data-asset-id="([^"]*)"/g;
```

with:

```typescript
/** The attribute inside ANY start tag, stepping over quoted attribute values.
 *
 *  ★★★ TAG-AGNOSTIC ON PURPOSE, AND THAT IS THE HALF NOT TO "SIMPLIFY".
 *   A reference the sanitizer preserved on a non-`img` element still matters
 *   for deletion safety and the "used in N documents" count, so a
 *   `<span data-asset-id>` MUST keep counting (open-followups §218). Anchoring
 *   this on `<img` would silently change what the cap counts and what that
 *   column means. `document-asset-usage.test.ts` fails if you do.
 *
 *  ★★ QUOTE-AWARE, sharing the alternation `IMG_TAG_RE` uses: a preceding
 *   `alt="…"` is consumed whole as one alternative, so its contents cannot
 *   supply an opening quote for this attribute. Before that, a crafted alt
 *   ending in `data-asset-id=` produced a phantom id and hid the real one, and
 *   a text node spelling the attribute spent a cap slot (open-followups §231).
 *
 *  ★ Double-quote-only and case-sensitive on the ATTRIBUTE name, both
 *   deliberate: DOMPurify re-serialises every attribute double-quoted on load,
 *   so by the time this runs there is nothing else to match. Tag-name case is
 *   NOT the discriminator — `<IMG data-asset-id="x">` counts here.
 *
 *  ★ Empty ids are admitted by the pattern and rejected by the caller's
 *   `.filter`, which is how this and `ASSET_IMG_RE` (document-model.ts) agree
 *   on emptiness through two different mechanisms in two files. */
const ASSET_ID_RE =
  /<[a-zA-Z][^\s/>]*(?:[^>"']|"[^"]*"|'[^']*')*?\bdata-asset-id="([^"]*)"/g;
```

- [ ] **Step 6: Run the tests and verify they PASS**

```bash
npx vitest run src/app/document-asset-usage.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Test Files" /tmp/t1.log
```

Expected: `EXIT=0`, all tests passing.

- [ ] **Step 7: Mutation-check the new tests**

Temporarily restore the old one-line pattern (keep the new docstring), rerun, and confirm the four
tests from Steps 1–3 go RED. A test that passes against the old regex pins nothing.

```bash
npx vitest run src/app/document-asset-usage.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -cE "✗|×" /tmp/t1.log
```

Expected: `EXIT=1` and 4 failing. Then put the new pattern back and confirm green again.

Do **not** revert with `git checkout -- <file>` (deny-blocked in this repo). Edit the line back by
hand, then prove the tree is clean with `git diff --stat` showing only the intended files.

- [ ] **Step 8: Rewrite the module header**

The header of `src/app/document-asset-usage.ts` currently carries a long ★★★ paragraph explaining
that sanitising is NOT a guard against a `data-asset-id` in text content, and that `ASSET_ID_RE`
therefore counts typed prose against the cap. The first half stays true; the second is now false.

Replace that ★★★ paragraph (the block beginning `★★★ SANITISING IS NOT A GUARD AGAINST A
data-asset-id IN TEXT CONTENT` and ending at `open-followups §231.`) with:

```
// ★★ SANITISING IS STILL NOT A GUARD AGAINST A `data-asset-id` IN TEXT
// CONTENT — that has been measured and it has not changed: `<p>data-asset-id=
// "hero"</p>` comes back BYTE-IDENTICAL from a full load, because HTML
// text-node serialisation escapes `&`, `<` and `>` and never `"`. What changed
// (open-followups §231, closed) is that this module no longer NEEDS it to be a
// guard: `ASSET_ID_RE` requires a start tag, so prose cannot reach it. Do not
// restore a claim that the sanitizer protects this — it does not, and the next
// pattern change would inherit a false premise. Pinned by "does NOT escape a
// data-asset-id a user merely TYPED as prose, and no longer counts it".
```

Also update the `AssetRefs` type docstring: the ★★★ paragraph asserting `drawable` is NOT a subset of
`all` and citing the crafted-`alt` measurement must say that the measured input no longer violates
it, while keeping the warning that the relationship is not guaranteed by construction. Replace the
sentence beginning `Measured 2026-08-24 —` through `NOT fixed here.` with:

```
 *  Measured 2026-08-25: no known input violates it any more —
 *  `<img alt="data-asset-id=" data-asset-id="real">` used to yield
 *  `all` = [`" data-asset-id="`] with the real id ABSENT, and now yields
 *  `["real"]` in both (open-followups §231, closed). The guarantee is still
 *  NOT structural: `all` and `drawable` are computed by two DIFFERENT patterns
 *  over raw HTML, so treat a subset relationship as a measured fact that a
 *  future pattern change can break, never as an invariant.
```

- [ ] **Step 9: Run the full local gate chain**

Never through a pipe. One vitest process at a time.

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint src; echo "ESLINT_EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "SUITE_EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

Expected: `TSC_EXIT=0`, `ESLINT_EXIT=0`, `SUITE_EXIT=0`. `tsc` exits **2** on diagnostics, not 1.

- [ ] **Step 10: Commit**

```bash
git add src/app/document-asset-usage.ts src/app/document-asset-usage.test.ts
git commit --only src/app/document-asset-usage.ts src/app/document-asset-usage.test.ts -F - <<'MSG'
fix(documents): count only real asset references against the image cap

ASSET_ID_RE was a bare attribute match with no tag anchor and no quote
awareness, so it matched the attribute's spelling anywhere in the stored
HTML. Two consequences, both now closed (open-followups §231):

- a paragraph a user typed containing data-asset-id="..." spent a slot of
  the 20-image per-document cap, and since 0.258.1 the cap message offered
  that slot back as reclaimable room, which meant deleting their sentence;
- an alt ending in data-asset-id= paired with the real attribute's opening
  quote, yielding a phantom id while the real one went missing, so it spent
  no slot and could be re-inserted past dedup.

The replacement requires a start tag and steps over quoted attribute values,
the shape IMG_TAG_RE already uses. It stays tag-agnostic: a span reference
still counts, because deletion safety and the used-in-N-documents column
depend on it (§218).

A third, malformed shape stops counting too and is pinned rather than left
latent.
MSG
```

---

### Task 2: Verify no consumer changed behaviour

`assetRefsInDocument` feeds the asset library's cap enforcement and its "used in N documents" column.
Task 1 changed what it returns for pathological input. This task proves it did not change anything
for ordinary input.

**Files:**
- Test: `src/app/documents-asset-section.test.tsx` (read only — do not modify)

- [ ] **Step 1: Run the consumer's own suite**

```bash
npx vitest run src/app/documents-asset-section.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log
```

Expected: `EXIT=0`. If anything fails here, the change reached a consumer it should not have —
investigate before continuing, do not adjust the consumer's test to match.

- [ ] **Step 2: Confirm the export side is untouched**

`IMG_TAG_RE` was not modified, so `documentAssetIds` and the export buckets must be byte-identical.

```bash
npx vitest run src/app/document-export-assets.test.ts > /tmp/t2b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2b.log
```

Expected: `EXIT=0`.

- [ ] **Step 3: No commit**

This task adds no files. It is a gate, not a change.

---

### Task 3: Collect the three patterns into one module

Behaviour-preserving. Every test written in Task 1 must stay green with no edits.

**Files:**
- Create: `src/app/document-asset-patterns.ts`
- Create: `src/app/document-asset-patterns.test.ts`
- Modify: `src/app/document-export-assets.ts`
- Modify: `src/app/document-model.ts`
- Modify: `src/app/document-asset-usage.ts`

- [ ] **Step 1: Create the module**

Create `src/app/document-asset-patterns.ts`. Move the FULL existing docstrings across with their
declarations — they carry measured failure modes and are the reason each pattern differs. Do not
summarise them.

```typescript
// src/app/document-asset-patterns.ts — every regex that reads `data-asset-id`,
// in one file so their differences can be read against each other.
//
// ★★★ THE THREE ARE DELIBERATELY DIFFERENT AND MUST NOT BE MERGED. They answer
// three different questions: what spends a slot of the per-document image cap
// (any element — deletion safety, open-followups §218), what an export can
// actually draw (`<img>` only), and whether an image-only paragraph survives
// load at all (before any allow-list pass, so all quoting styles and any case).
// Collapsing any pair silently changes a user-visible count or drops data.
// `assetRefsInDocument` (document-asset-usage.ts) carries the relationship.
//
// ★★ DOM-FREE BY CONTRACT and it imports NOTHING. `document-model.ts` — itself
// DOM-free, and the validator every load path routes through — depends on this
// module, so a DOM reference here would break bare-node use (the sample
// generator) and an import here could create a cycle in the
// settings-types ⇄ workspace ⇄ document-model graph (open-followups §92).
// A comment-stripped source scan in this module's test enforces both.

/** The attribute inside ANY start tag, stepping over quoted attribute values.
 *  Backs the 20-image per-document cap and the "used in N documents" column.
 *
 *  ★★★ TAG-AGNOSTIC ON PURPOSE. A reference the sanitizer preserved on a
 *   non-`img` element still matters for deletion safety and the usage count,
 *   so a `<span data-asset-id>` MUST keep counting (open-followups §218).
 *   Anchoring this on `<img` silently changes what the cap counts.
 *
 *  ★★ QUOTE-AWARE. A preceding `alt="…"` is consumed whole as one alternative,
 *   so its contents cannot supply an opening quote. Before that, a crafted alt
 *   ending in `data-asset-id=` produced a phantom id and hid the real one, and
 *   a text node spelling the attribute spent a cap slot (§231, closed).
 *
 *  ★ Case-sensitivity is on the ATTRIBUTE name, never the tag name:
 *   `<IMG data-asset-id="x">` counts, `<IMG DATA-ASSET-ID="x">` does not. */
export const ANY_TAG_ASSET_ID_RE =
  /<[a-zA-Z][^\s/>]*(?:[^>"']|"[^"]*"|'[^']*')*?\bdata-asset-id="([^"]*)"/g;

/** The one regex an EXPORT uses for `<img data-asset-id>`. Shared by the three
 *  renderers and `documentAssetIds`.
 *
 *  ★★★ QUOTE-AWARE, and it must stay that way. A plain `[^>]*` stops at the
 *   first `>` even inside a quoted attribute value, and that is reachable from
 *   the product's own rename control: the insert path escapes `>` to `&gt;`,
 *   but the HTML serialiser does not re-escape it in an attribute, so a DOM
 *   round trip hands back `alt="chart>v2.png"` verbatim. Measured: with `alt`
 *   AFTER data-asset-id the match truncates and `v2.png">` survives as visible
 *   text in every export; with `alt` BEFORE it the tag is missed entirely, so
 *   no bytes load and the image disappears without a word. The three
 *   alternation branches start on disjoint character classes, so there is no
 *   backtracking risk.
 *
 *  ★★★ It carries /g, so `lastIndex` is shared state. Use it ONLY with
 *   `String.replace` (which resets it) or `String.matchAll` (which clones it).
 *   A `.test()` or bare `.exec()` in a loop would carry position between
 *   unrelated callers — a bug that only shows up once two of them run in one
 *   tick, i.e. in production and never in a focused test. */
export const IMG_TAG_RE =
  /<img\b(?:[^>"']|"[^"]*"|'[^']*')*\bdata-asset-id="([^"]*)"(?:[^>"']|"[^"]*"|'[^']*')*>/g;

/** `.test()`-only survival predicate: does this image-only paragraph survive
 *  load? Captures nothing.
 *
 *  ★★ Case-INSENSITIVE, unlike the two above, which only ever see html already
 *   lower-cased by DOMPurify. This one runs BEFORE any allow-list pass on the
 *   load path, so a hand-edited or imported `<IMG DATA-ASSET-ID>` reaches it
 *   verbatim and must not be dropped before it can be normalised.
 *
 *  ★★★ ALL THREE HTML QUOTING STYLES, FOR THE SAME REASON THE `/i` EXISTS.
 *   Whatever writes `<IMG DATA-ASSET-ID>` in caps is hand-written or foreign
 *   HTML, and that is precisely the input class that spells attributes
 *   `id='x'` or bare `id=x`; both are valid HTML5 and both measure zero visible
 *   text, so under a double-quote-only pattern the block was DELETED on load
 *   with no error. Erring toward keeping costs at worst one stray blank
 *   paragraph the user can see and delete; erring toward dropping is silent
 *   data loss.
 *   ★★ The unquoted branch excludes `"` and `'` (not merely whitespace and
 *   `>`), so `data-asset-id=""` and `data-asset-id=''` still fail every branch
 *   and are still dropped — an empty value renders nothing on every surface.
 *
 *  ★ NOT `/g` — a global regex carries `lastIndex` across `.test` calls and
 *   would drop every other image-only paragraph in a document. */
export const ASSET_IMG_TEST_RE =
  /<img\b[^>]*\bdata-asset-id\s*=\s*(?:"[^"]+"|'[^']+'|[^\s"'>]+)/i;
```

- [ ] **Step 2: Create the module's test**

Create `src/app/document-asset-patterns.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ANY_TAG_ASSET_ID_RE,
  IMG_TAG_RE,
  ASSET_IMG_TEST_RE,
} from "./document-asset-patterns";

/** Fresh matcher per call — these are /g module consts and `matchAll` clones,
 *  but building the array here keeps each assertion independent. */
const ids = (re: RegExp, s: string): string[] =>
  [...s.matchAll(re)].map((m) => m[1]).filter((x) => x.length > 0);

describe("the three data-asset-id patterns, side by side", () => {
  // ★★★ This table is the point of the module. Each row states what all three
  // answer for one input, so a reader changing one pattern sees immediately
  // what the other two do with the same string. open-followups §209.
  const rows: Array<[string, string[], string[], boolean]> = [
    // input,                                            anyTag,    img,       survivesLoadPredicate
    [`<img data-asset-id="real" alt="x">`,               ["real"],  ["real"],  true],
    [`<span data-asset-id="x">t</span>`,                 ["x"],     [],        false],
    [`<p>data-asset-id="abc"</p>`,                       [],        [],        false],
    [`<img alt="data-asset-id=" data-asset-id="real">`,  ["real"],  ["real"],  true],
    [`<img data-asset-id='sq'>`,                         [],        [],        true],
    [`<IMG DATA-ASSET-ID="d">`,                          [],        [],        true],
    [`<IMG data-asset-id="up">`,                         ["up"],    [],        true],
    [`<img data-asset-id="">`,                           [],        [],        false],
  ];

  for (const [html, anyTag, img, survives] of rows) {
    it(`agrees on ${JSON.stringify(html)}`, () => {
      expect(ids(ANY_TAG_ASSET_ID_RE, html)).toEqual(anyTag);
      expect(ids(IMG_TAG_RE, html)).toEqual(img);
      expect(ASSET_IMG_TEST_RE.test(html)).toBe(survives);
    });
  }

  it("keeps the load predicate NON-global", () => {
    // ★ A /g here would carry lastIndex across .test() calls and drop every
    //   other image-only paragraph in a document. Two identical calls must
    //   agree; with /g the second returns false.
    const html = `<img data-asset-id="a">`;
    expect(ASSET_IMG_TEST_RE.test(html)).toBe(true);
    expect(ASSET_IMG_TEST_RE.test(html)).toBe(true);
    expect(ASSET_IMG_TEST_RE.global).toBe(false);
  });

  it("does not touch the DOM", () => {
    // Guard: document-model.ts depends on this module and must stay usable
    // under bare node (the sample generator). A source scan is the
    // enforcement, matching the repo's other source scans.
    // ★ cwd-relative, NOT `new URL(..., import.meta.url)` — under vitest
    // `import.meta.url` is not a file: URL and readFileSync throws.
    const src = readFileSync("src/app/document-asset-patterns.ts", "utf8");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/DOMPurify|dompurify|\bwindow\b|\bdocument\b\s*\./);
  });

  it("imports nothing, so it cannot join the document-model cycle", () => {
    // ★★ open-followups §92 records a settings-types ⇄ workspace ⇄
    //    document-model cycle. document-model.ts imports THIS module, so an
    //    import here is how that cycle would grow a fourth member.
    const src = readFileSync("src/app/document-asset-patterns.ts", "utf8");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/^\s*import\s/m);
  });
});
```

- [ ] **Step 3: Run the new test and verify it FAILS**

```bash
npx vitest run src/app/document-asset-patterns.test.ts > /tmp/t3.log 2>&1; echo "EXIT=$?"; head -20 /tmp/t3.log
```

Expected: `EXIT=1` before Step 1 is saved. If Step 1 is already saved it should pass — in that case
verify the table is not vacuous by changing one expected value and confirming it goes red.

- [ ] **Step 4: Point `document-export-assets.ts` at the module**

Delete the `IMG_TAG_RE` declaration and its docstring from `src/app/document-export-assets.ts` (the
docstring moved to the new module in Step 1). In its place put a re-export so the three renderers'
imports do not change:

```typescript
// ★ Re-exported, not declared here: the declaration and its full docstring live
//   in document-asset-patterns.ts beside the two patterns it must be read
//   against (open-followups §209). Kept exported from this module because the
//   three renderers and this file's own `documentAssetIds` import it from here.
export { IMG_TAG_RE } from "./document-asset-patterns";
```

A re-export creates no local binding, so this file ALSO needs a normal import for its own use inside
`documentAssetIds` (find it with `grep -n "matchAll(IMG_TAG_RE)" src/app/document-export-assets.ts`).
Add it with the other imports at the top:

```typescript
import { IMG_TAG_RE } from "./document-asset-patterns";
```

★ Both statements naming the same module is legal and intended: one re-exports for the renderers, the
other binds it locally. Dropping the import and keeping only the re-export fails to compile.

- [ ] **Step 5: Point `document-model.ts` at the module**

In `src/app/document-model.ts`, delete the `ASSET_IMG_RE` declaration and its docstring (both moved
in Step 1) and import the renamed export instead. Add to the imports at the top:

```typescript
import { ASSET_IMG_TEST_RE } from "./document-asset-patterns";
```

Then update its single call site:

```typescript
      if (htmlTextLength(html) === 0 && !ASSET_IMG_TEST_RE.test(html)) return null;
```

- [ ] **Step 6: Point `document-asset-usage.ts` at the module**

In `src/app/document-asset-usage.ts`, delete the local `ASSET_ID_RE` declaration and its docstring
(moved in Step 1), and replace the `IMG_TAG_RE` import:

```typescript
import { ANY_TAG_ASSET_ID_RE, IMG_TAG_RE } from "./document-asset-patterns";
```

Then update the two call sites, which are the only uses:

```typescript
function assetIdsInBlock(block: DocBlock): string[] {
  if (block.type !== "paragraph") return [];
  return Array.from(block.html.matchAll(ANY_TAG_ASSET_ID_RE), (m) => m[1]).filter(
    (id) => id.length > 0,
  );
}
```

The `matchAll(IMG_TAG_RE)` call inside `assetRefsInDocument` is unchanged.

- [ ] **Step 7: Run the full suite and verify NOTHING changed**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint src; echo "ESLINT_EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "SUITE_EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

Expected: all zero. **No test written in Task 1 may need editing.** If one does, this task changed
behaviour and the change must be found rather than accommodated.

- [ ] **Step 8: Run the ratchets**

```bash
npm run size:check; echo "SIZE_EXIT=$?"
npm run dup:check; echo "DUP_EXIT=$?"
```

Expected: both 0. `dup:check` compares the TOTAL duplicated-line percentage across all formats
against the threshold in `package.json`; the three patterns share an alternation fragment textually,
so if it trips, that is where to look.

- [ ] **Step 9: Commit**

```bash
git add src/app/document-asset-patterns.ts src/app/document-asset-patterns.test.ts src/app/document-export-assets.ts src/app/document-model.ts src/app/document-asset-usage.ts
git commit -F - <<'MSG'
refactor(documents): one module for the three data-asset-id patterns

The cap scanner, the export scanner and the load survival predicate each
read data-asset-id and each answers a different question, so they cannot be
merged (open-followups §218). What was missing was anywhere they could be
read against each other: three files apart, nothing kept them in step and
nothing gated their differences.

They now live in document-asset-patterns.ts with their full docstrings and a
test asserting the divergence table directly. The module imports nothing, so
it cannot grow the settings-types/workspace/document-model cycle (§92), and
its DOM-free contract is scanned the way document-model.ts's already is —
that scan reads one file, so moving a pattern out of it would otherwise have
dropped the guard silently.

document-export-assets.ts re-exports IMG_TAG_RE, so the three renderers are
untouched. No behaviour change: the tests from the previous commit pass
unedited.
MSG
```

---

### Task 4: Update the register and sweep the prose

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Close §231**

Change the §231 heading to end with ` — CLOSED 2026-08-25` and rewrite its `**Status:**` line to:

```
**Status:** CLOSED 2026-08-25. Both halves fixed by making `ASSET_ID_RE` require a start tag and
step over quoted attribute values; the pattern now lives in `document-asset-patterns.ts` as
`ANY_TAG_ASSET_ID_RE`. The measured before/after table is in
`docs/superpowers/specs/2026-08-25-asset-id-extraction-design.md`, reproducible with
`node docs/superpowers/specs/_probes/asset-id-extraction.mjs`. ★ A THIRD shape changed with them:
malformed `<imgdata-asset-id="x">` stopped counting. Pinned, not latent.
```

Leave the body describing the defect intact — it is the record of what was wrong.

- [ ] **Step 2: Narrow §209**

Add to §209, immediately after its `**Status:**` line:

```
★★ **NARROWED 2026-08-25.** The three spellings now live in one module,
`document-asset-patterns.ts`, as `ANY_TAG_ASSET_ID_RE` / `IMG_TAG_RE` /
`ASSET_IMG_TEST_RE`, with their divergences asserted directly by
`document-asset-patterns.test.ts` — so "nothing gates them agreeing" no longer holds. The clean
shape this entry asked for (a pure module depended on by `document-model.ts`, `document-asset-usage.ts`
and the renderers, depending on none of them) is what was built. What REMAINS open is narrow: the
three renderers still import `IMG_TAG_RE` through a re-export in `document-export-assets.ts` rather
than from the new module directly, so the dependency this entry describes is one hop longer than it
needs to be.
```

- [ ] **Step 3: Sweep for prose describing the OLD behaviour**

A behaviour change falsifies prose in files nobody assigned. Find every mention and fix or delete
each — do not assume this plan's file list is the population.

```bash
grep -rn "ASSET_ID_RE" src docs --include=*.ts --include=*.tsx --include=*.md
grep -rn "ASSET_IMG_RE" src docs --include=*.ts --include=*.tsx --include=*.md
```

Every hit naming `ASSET_ID_RE` or `ASSET_IMG_RE` as a CURRENT symbol is now stale — both were
renamed. Known sites: `document-export-assets.ts`'s `IMG_TAG_RE` docstring names both;
`document-asset-usage.ts`'s `AssetRefs` docstring names `ASSET_ID_RE` several times;
`document-asset-usage.test.ts` has a comment table naming all three; `document-model.ts` line ~217
names `IMG_TAG_RE`. Re-run both greps after editing and confirm no stale name survives.

- [ ] **Step 4: Run the doc gates**

```bash
npm run docs:symbols:check; echo "SYMBOLS_EXIT=$?"
npm run docs:claims:check; echo "CLAIMS_EXIT=$?"
```

Expected: both 0. `docs:symbols:check` fails if `AGENTS.md` or `docs/AGENTS/*.md` names a symbol that
no longer exists — a rename of `ASSET_ID_RE` is exactly what it catches, so if it goes red, fix the
doc rather than restoring the name. It does NOT scan `docs/open-followups.md`.

- [ ] **Step 5: Commit**

```bash
git add docs/open-followups.md src/app/document-export-assets.ts src/app/document-asset-usage.ts src/app/document-asset-usage.test.ts src/app/document-model.ts
git commit -F - <<'MSG'
docs: close §231, narrow §209, and sweep the prose they falsified

§231 is fixed in both halves and a third malformed shape changed with them.
§209's clean shape — a pure module the model and the usage helper both
import, depending on nothing — is what was built, so what remains is only
that the renderers reach IMG_TAG_RE through a re-export.

The sweep is the part worth naming: renaming two of the three patterns
falsified comments in four files that no task listed, including a docstring
that described the cap counting text content as current behaviour.
MSG
```

---

### Task 5: Release stamp

This is a user-visible behaviour fix, so it takes a version bump. **Do not push, open an MR, or
merge** — that needs a separate explicit instruction.

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json` (2 places),
  `README.md` (shields badge), `docs/CODEMAPS/*.md` (5 headers)

- [ ] **Step 1: Read the current version**

```bash
grep -n "APP_VERSION\|APP_BUILD_DATE\|APP_MILESTONE" src/app/version.ts | head -5
```

At the time of writing, `main` is `0.259.1 "Tsutsui"`. This is a patch fix, so the next version is
`0.259.2` and the milestone codename stays `Tsutsui` (it tracks the MINOR series). Confirm against
what the command actually prints — `main` may have moved.

- [ ] **Step 2: Bump `src/app/version.ts`**

Set `APP_VERSION` to the next patch, `APP_BUILD_DATE` to today, and update the trailing comment:

```typescript
export const APP_VERSION = "0.259.2";
export const APP_BUILD_DATE = "2026-08-25"; // 0.259.2: asset-id cap counts only real references
```

No new `versionHighlight*` key is needed — that is for highlights surfaced in the UI, and this fix
has no UI copy.

- [ ] **Step 3: Add the CHANGELOG entry**

Add a new entry at the top of `CHANGELOG.md`, matching the surrounding format. Do NOT put a
`[session link removed]...` URL in it.

```markdown
## 0.259.2 "Tsutsui" — 2026-08-25

### Fixed

- The per-document image cap now counts only real asset references. A paragraph that merely
  contained the text `data-asset-id="…"` used to spend one of the twenty slots, and the cap message
  then offered that slot back as reclaimable room — which would have meant deleting the sentence.
  An image whose `alt` ended in `data-asset-id=` also hid the real reference from the count, so it
  spent no slot and could be re-added past the duplicate check.

### Changed

- The three regexes that read `data-asset-id` now live in one module with their differences asserted
  by a test, instead of three files apart with nothing keeping them in step.
```

- [ ] **Step 4: Bump the five ungated places**

No gate checks any of these and they have drifted by up to eleven releases before. Set all of them to
the same version:

```bash
grep -n '"version"' package.json
grep -n '"version"' package-lock.json | head -3
grep -n "img.shields.io" README.md | head -3
grep -rn "Generated:" docs/CODEMAPS/*.md
```

`package.json` has one, `package-lock.json` has two (the root `version` and the `packages[""]` one),
`README.md`'s badge carries version AND codename, and each of the five `docs/CODEMAPS/*.md` files has
a `<!-- Generated: … | App <version> "<codename>" … -->` header.

- [ ] **Step 5: Verify every place agrees**

```bash
grep -rn "0\.259\.1" package.json package-lock.json README.md docs/CODEMAPS/*.md src/app/version.ts
```

Expected: no output. Any hit is a place that did not get bumped.

- [ ] **Step 6: Final gate chain**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint src; echo "ESLINT_EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "SUITE_EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "SHUFFLE_EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
npm run size:check; echo "SIZE_EXIT=$?"
npm run dup:check; echo "DUP_EXIT=$?"
npm run docs:symbols:check; echo "SYMBOLS_EXIT=$?"
npm run docs:claims:check; echo "CLAIMS_EXIT=$?"
```

Expected: all zero. `test:shuffle` is the only local reproduction of CI's `unit-tests-shuffled` job
and must be run because this plan adds tests.

★ If `codec-roundtrip.property.test.ts` fails with an astral-character hazard-floor assertion, that
is a known unseeded-fast-check flake unrelated to this work (open-followups §244). Re-run once before
investigating.

- [ ] **Step 7: Commit**

```bash
git add src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS
git commit -F - <<'MSG'
chore(release): 0.259.2 "Tsutsui"

Asset-id cap counts only real references (§231 closed), and the three
data-asset-id patterns are collected into one module (§209 narrowed).

Includes the five version-carrying places no gate checks (§236).
MSG
```

- [ ] **Step 8: Report, do not release**

Print the branch state and stop:

```bash
git log --oneline dc1bb4e9..HEAD
git status --short
```

Pushing, opening an MR and merging require an explicit instruction and are deliberately not in this
plan.

---

## Verification checklist

- [ ] `<span data-asset-id>` still counts against the cap (§218 not regressed)
- [ ] `IMG_TAG_RE` behaviour unchanged — export buckets and OOXML part order untouched
- [ ] The four Task 1 tests go red against the old pattern (mutation-checked, Task 1 Step 7)
- [ ] No Task 1 test needed editing during Task 3
- [ ] `grep -rn "ASSET_ID_RE\|ASSET_IMG_RE" src docs` returns no stale current-symbol claim
- [ ] All gates zero, including `test:shuffle`
- [ ] Nothing pushed
