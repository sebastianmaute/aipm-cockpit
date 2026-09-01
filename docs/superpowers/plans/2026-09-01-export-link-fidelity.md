# Export Link Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A link's address survives every export — a real hyperlink where the format holds one, `text (url)` where it does not.

**Architecture:** One parse change (`TextRun` gains an optional `href`) feeds three existing consumers: the DOCX document renderer, the PPTX document renderer, and the DOCX workspace-export table cells, which all already route through `rich-text-runs.ts`. A new pure module mints relationship ids and dedupes targets. The flat sinks (XLSX, PPTX table cells) get a separate export-only projection; `htmlToText` is not touched.

**Tech Stack:** TypeScript, React 19 / Next 16, vitest, DOMPurify, OOXML (WordprocessingML + DrawingML) emitted as strings and zipped by the repo's own `buildZip`.

**Spec:** `docs/superpowers/specs/2026-09-01-export-link-fidelity-design.md`

**Branch:** `fix/export-link-fidelity` at `eb89b5e5`, off `main` `4650ed67` (0.275.0 "Nagata").

**Closes:** `docs/open-followups.md` §119 and §30. Discharges part of §219.

---

## Ground rules for every task

Read these once. They are not repeated per task, and each has cost this repo real work.

- **`src/app/*.ts` are CRLF** (`git ls-files --eol` reports `i/lf w/crlf`). Use the **Edit** tool for every change to an existing source file. **Write re-lines the whole file to LF**, `sed -i` does the same invisibly to `git diff`, and a node anchor built with `\n` silently matches nothing. NEW files may be created with Write.
- **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` reports `tail`'s status. Redirect, echo `$?` unpiped, then grep the file.
- **`npx tsc --noEmit` exits 2** on diagnostics, not 1. `npm run lint` exits 1 from gitignored leftovers — use `npx eslint src`.
- **Never run two vitest processes at once.** A red run carrying `Failed to start forks worker` or a bare `Test timeout` with no rule id is CONTENTION, not evidence — re-run it before believing it.
- **Logs go in the session scratchpad**, never `/tmp` (shared across sessions; a peer's log has overwritten one before).
- **Every new guard is mutation-proved** with a minimal one-token revert, recorded as `N failed / M passed`, where `N + M` equals the file's RUNTIME test count (`test.each` expands, so `grep -c "test("` undercounts). Assert the mutant LANDED before trusting the result, and revert it with an inverse anchored write plus a uniqueness assertion — `git checkout -- <file>` is deny-blocked here.
- **Zero new i18n keys in this branch.** Nothing touches `i18n.ts` or `i18n.de.ts`.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/app/ooxml-links.ts` | NEW. Scheme allowlist + relationship-id sink (mint, dedupe by target). Pure, DOM-free. | 2 |
| `src/app/ooxml-links.test.ts` | NEW. Tests for the above. | 2 |
| `src/app/rich-text-runs.ts` | `TextRun.href`; the `A` arm in the walk. | 3 |
| `src/app/rich-text-runs.test.ts` | The flipped pinning test + new parse coverage. | 3 |
| `src/app/ooxml-docx-primitives.ts` | `<w:hyperlink>` emission, `links` parameter, external rels, widened duplicate guard. | 4 |
| `src/app/doc-render-docx.ts` | Threads a link sink into `docxRichParagraphs`. | 4 |
| `src/app/ooxml-pptx-primitives.ts` | `PptxRun.hyperlinkRelId` → `<a:hlinkClick>`, `PptxSlide.links`, widened guard. | 5 |
| `src/app/doc-render-pptx-slides.ts` | Carries `href` from run to `PptxRun`. | 5 |
| `src/app/doc-render-pptx.ts` | Per-slide sink; passes rels to the package. | 5 |
| `src/app/export-sections.ts` | The export-only `text (url)` projection. | 6 |
| `src/app/export-xlsx.ts`, `src/app/export-pptx.ts` | Consume that projection. | 6 |
| `scripts/sample-link-exports.mjs` | NEW. Emits four sample files for the manual pass. | 8 |
| `docs/open-followups.md` | §119 correction, then §119/§30 closure, then new entries. | 1, 9 |

---

## Task 1: Correct §119's stale cost claim

The entry says `buildDocxPackage` "would have to collect per-part relationships it does not model today". The S3c-2 media slice built exactly that. Correcting this BEFORE closing the entry matters: a closure that lands on a false cost estimate leaves the false estimate in the record forever.

**Files:**
- Modify: `docs/open-followups.md` (§119 body only)

- [ ] **Step 1: Confirm the claim is stale**

```bash
grep -n "Relationship Id=\|relId" src/app/ooxml-docx-primitives.ts | head -8
grep -n "relId is scoped to ONE SLIDE" src/app/ooxml-pptx-primitives.ts
```

Expected: the DOCX file shows `mediaRels` being assembled into `word/_rels/document.xml.rels` with caller-minted ids; the PPTX file shows the per-slide scoping docblock. Both prove relationship assembly exists.

- [ ] **Step 2: Edit the §119 paragraph**

Replace the sentence beginning "★ Not a one-line fix in either format" with text recording what is actually left. `docs/open-followups.md` is **LF**, so an editor that re-lines is not a hazard here — but it IS inside `doc-claims-check`'s scan set, so **cite symbols and commands, never `path:LINE`**.

The replacement must say: the relationship machinery landed with the media slice in both renderers; what remains new is a relationship with **no part** and `TargetMode="External"`, plus carrying `href` on `TextRun`.

- [ ] **Step 3: Verify the doc gates**

```bash
npm run docs:claims:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
```

Expected: both EXIT=0. Exit 1 on the second means a Status line is missing; exit 2 means the gate could not scan at all — opposite responses, do not conflate.

- [ ] **Step 4: Commit**

```bash
git commit --only docs/open-followups.md -m "docs: correct 119's cost estimate, which the media slice made stale"
```

---

## Task 2: `ooxml-links.ts` — scheme allowlist and relationship-id sink

**Files:**
- Create: `src/app/ooxml-links.ts`
- Create: `src/app/ooxml-links.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/ooxml-links.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createLinkSink, safeLinkTarget } from "./ooxml-links";

describe("safeLinkTarget", () => {
  it("admits http, https and mailto", () => {
    expect(safeLinkTarget("https://intra/spec")).toBe("https://intra/spec");
    expect(safeLinkTarget("http://intra/spec")).toBe("http://intra/spec");
    expect(safeLinkTarget("mailto:pm@example.com")).toBe("mailto:pm@example.com");
  });

  it("drops a javascript: URL — it must never reach a relationship", () => {
    expect(safeLinkTarget("javascript:alert(1)")).toBeUndefined();
    expect(safeLinkTarget("JavaScript:alert(1)")).toBeUndefined();
  });

  it("drops data:, file: and a relative href", () => {
    expect(safeLinkTarget("data:text/html,<b>x")).toBeUndefined();
    expect(safeLinkTarget("file:///etc/passwd")).toBeUndefined();
    expect(safeLinkTarget("/relative/path")).toBeUndefined();
  });

  it("drops null, empty and whitespace-only", () => {
    expect(safeLinkTarget(null)).toBeUndefined();
    expect(safeLinkTarget("")).toBeUndefined();
    expect(safeLinkTarget("   ")).toBeUndefined();
  });
});

describe("createLinkSink", () => {
  it("mints ids from the first free index", () => {
    const sink = createLinkSink(2);
    expect(sink.relIdFor("https://a")).toBe("rId2");
    expect(sink.relIdFor("https://b")).toBe("rId3");
  });

  it("returns the SAME id for a repeated target, so one url yields one relationship", () => {
    const sink = createLinkSink(2);
    expect(sink.relIdFor("https://a")).toBe("rId2");
    expect(sink.relIdFor("https://a")).toBe("rId2");
    expect(sink.rels()).toEqual([{ relId: "rId2", target: "https://a" }]);
  });

  it("starts past the media ids it was told about", () => {
    // rId1 is the styles part (DOCX) or the slide layout (PPTX); two media
    // parts then hold rId2 and rId3, so the first link is rId4.
    const sink = createLinkSink(4);
    expect(sink.relIdFor("https://a")).toBe("rId4");
  });

  it("reports no rels when nothing was minted — the additive-contract case", () => {
    expect(createLinkSink(2).rels()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/ooxml-links.test.ts`
Expected: FAIL — `Failed to resolve import "./ooxml-links"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/ooxml-links.ts`:

```ts
// src/app/ooxml-links.ts — hyperlink targets and relationship ids for the two
// OOXML renderers. Pure and DOM-free: it takes strings and returns strings, so
// it is testable under bare node and safe to import from either renderer.

/** One external relationship. It has NO part — no zip entry, no content-type
 *  Default — which is exactly what `TargetMode="External"` licenses. */
export type LinkRel = { relId: string; target: string };

/** ★★★ THE ALLOWLIST IS A SECOND BOUNDARY, NOT A REPLACEMENT FOR THE SANITIZER.
 *  `sanitizeRichHtml` already admits `<a href>` (`a` is in RICH_ALLOWED_TAGS,
 *  `href` in ALLOWED_ATTR), and that is the right policy for a value rendered
 *  into the app. This is a different question: the value is about to be written
 *  into a package Word will FOLLOW, so it is re-validated at the boundary where
 *  it leaves the app. */
const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** The href to use, or undefined if this anchor must degrade to a plain run.
 *
 *  ★ A RELATIVE href is dropped, and that is deliberate rather than an
 *  oversight of the parser: `new URL(x)` with no base throws on one, and a
 *  relative path has no meaning at all inside an exported file that has left
 *  the app. There is no base to resolve it against. */
export function safeLinkTarget(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  // ★ `URL.protocol` is lower-cased by the parser, so "JavaScript:" is caught
  // by the same membership test as "javascript:" with no extra folding here.
  return SAFE_LINK_SCHEMES.has(parsed.protocol) ? trimmed : undefined;
}

/** Mints relationship ids for one relationship SCOPE and remembers what it
 *  minted. A scope is `word/_rels/document.xml.rels` for DOCX and ONE SLIDE's
 *  `ppt/slides/_rels/slideN.xml.rels` for PPTX — never a whole deck.
 *
 *  ★★ `firstFreeIndex` is the caller's job because the two formats reserve
 *  different things: rId1 is the STYLES part in DOCX and the SLIDE LAYOUT in
 *  PPTX, and media parts already hold ids above it. Pass
 *  `2 + <media count in this scope>`.
 *
 *  ★ Deduping by target is not an optimisation — a description repeating one
 *  address would otherwise mint a relationship per occurrence, and the rels
 *  part grows without bound on a link-heavy document. */
export type LinkSink = {
  relIdFor(target: string): string;
  rels(): readonly LinkRel[];
};

export function createLinkSink(firstFreeIndex: number): LinkSink {
  const byTarget = new Map<string, string>();
  const minted: LinkRel[] = [];
  return {
    relIdFor(target: string): string {
      const existing = byTarget.get(target);
      if (existing !== undefined) return existing;
      const relId = `rId${firstFreeIndex + minted.length}`;
      byTarget.set(target, relId);
      minted.push({ relId, target });
      return relId;
    },
    rels: () => minted,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/ooxml-links.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Mutation-prove the allowlist**

The allowlist is the security-relevant guard here, so prove the test can see it fail. Widen the set by one token via an anchored write:

```bash
node -e "const f='src/app/ooxml-links.ts';const fs=require('fs');let s=fs.readFileSync(f,'utf8');const a='\"mailto:\"]);';if(s.split(a).length!==2)throw new Error('anchor not unique');s=s.replace(a,'\"mailto:\", \"javascript:\"]);');fs.writeFileSync(f,s);"
npx vitest run src/app/ooxml-links.test.ts > "$SCRATCH/mutant-links.log" 2>&1; echo "EXIT=$?"
```

Expected: EXIT=1, with "drops a javascript: URL" failing. Record the tally as `N failed / M passed`; `N + M` must equal 9.

Revert with the inverse anchored write and assert the tree is clean:

```bash
node -e "const f='src/app/ooxml-links.ts';const fs=require('fs');let s=fs.readFileSync(f,'utf8');const a='\"mailto:\", \"javascript:\"]);';if(s.split(a).length!==2)throw new Error('revert anchor not unique');s=s.replace(a,'\"mailto:\"]);');fs.writeFileSync(f,s);"
git diff --stat
```

Expected: `git diff --stat` prints nothing for that file. End on the diff, never on a green suite — a green suite is also what a failed revert looks like.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"   # 0; note this gate exits 2, not 1, on diagnostics
npx eslint src; echo "EXIT=$?"     # 0
git add src/app/ooxml-links.ts src/app/ooxml-links.test.ts
git commit --only src/app/ooxml-links.ts src/app/ooxml-links.test.ts -m "feat: link scheme allowlist and relationship-id sink"
```

---

## Task 3: The parse carries `href`

**Files:**
- Modify: `src/app/rich-text-runs.ts` (`TextRun`, `pushText`, `walk`)
- Modify: `src/app/rich-text-runs.test.ts` (flip one test, add four)

- [ ] **Step 1: Flip the test that pins the defect, and add the new coverage**

`rich-text-runs.test.ts` currently contains `it("carries no mark for a tag that only wraps (a link)", ...)`. That test asserts the DEFECT. Rewrite it — do not delete it — with a comment recording what changed:

```ts
  // ★★ FLIPPED 2026-09-01 (open-followups §119/§30). This test used to assert
  // that an <a> contributed NOTHING but its text — i.e. it pinned the defect
  // that lost every link address in .docx and .pptx. The tag still carries no
  // MARK (a RunMark has no payload and cannot hold a URL); what changed is that
  // the run now carries the address in its own `href` field.
  it("carries no mark for a link, but does carry its href", () => {
    const lines = htmlToRichLines('<p>Spec: <a href="https://intra/spec">the spec</a></p>');
    expect(lines).toHaveLength(1);
    expect(lines[0].runs).toEqual([
      { text: "Spec: ", marks: [] },
      { text: "the spec", marks: [], href: "https://intra/spec" },
    ]);
  });

  it("keeps marks and href together when a link wraps a mark", () => {
    const lines = htmlToRichLines('<p><a href="https://a"><strong>bold link</strong></a></p>');
    expect(lines[0].runs).toEqual([{ text: "bold link", marks: ["bold"], href: "https://a" }]);
  });

  it("keeps marks and href together when a mark wraps a link", () => {
    const lines = htmlToRichLines('<p><strong><a href="https://a">bold link</a></strong></p>');
    expect(lines[0].runs).toEqual([{ text: "bold link", marks: ["bold"], href: "https://a" }]);
  });

  it("drops an unsafe scheme to a plain run rather than carrying it", () => {
    const lines = htmlToRichLines('<p><a href="javascript:alert(1)">click</a></p>');
    expect(lines[0].runs).toEqual([{ text: "click", marks: [] }]);
  });

  it("omits href entirely on an ordinary run, never as own-and-undefined", () => {
    const lines = htmlToRichLines("<p>plain</p>");
    expect(Object.hasOwn(lines[0].runs[0], "href")).toBe(false);
  });
```

★ That last test is not pedantry. This file's own `continuation` docblock records the same rule for a different field: an absent field and an own-but-undefined one compare differently under `toEqual` and serialise differently, and a run built one way must be indistinguishable from one built the other.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/app/rich-text-runs.test.ts`
Expected: FAIL — the four new assertions report a run with no `href` key; the flipped test fails on the same.

- [ ] **Step 3: Add `href` to the type**

In `src/app/rich-text-runs.ts`, change the `TextRun` declaration:

```ts
export type TextRun = { text: string; marks: RunMark[]; href?: string };
```

- [ ] **Step 4: Thread `href` through `pushText`**

`pushText` takes a sixth parameter and sets the field only when present:

```ts
  function pushText(
    text: string,
    marks: readonly RunMark[],
    kind: BlockKind,
    item: LiLine | null,
    align: Align | undefined,
    href: string | undefined,
  ): void {
    if (text === "") return;
    if (!current) current = item === null ? { kind, runs: [], align } : continuationOf(item, align);
    // ★ The field is ABSENT on an unlinked run, never own-and-undefined — the
    // same rule the `continuation` docblock states for line heads.
    current.runs.push(href === undefined ? { text, marks: [...marks] } : { text, marks: [...marks], href });
  }
```

`pushPreText` gains the same trailing parameter and forwards it to `pushText`.

- [ ] **Step 5: Add the `A` arm to the walk**

`walk` takes a seventh parameter `href: string | undefined = undefined`, forwards it at both text-node call sites and through every existing recursive call unchanged. The anchor is handled where the mark arm already sits — the final `else` branch that today walks an unrecognised tag through:

```ts
      // ★★ `A` is deliberately in NEITHER `MARK_BY_TAG` nor `LINE_TAGS`: a link
      // is not a style (a RunMark carries no payload, so it could not hold a
      // URL) and it does not end a line. It travels exactly as `align` and
      // `item` do — down through the subtree, unchanged by inline marks.
      // ★ An <a> whose href fails `safeLinkTarget` walks on with the INHERITED
      // href rather than clearing it, so a bad nested anchor inside a good one
      // cannot silently strip the outer link. Nesting anchors is invalid HTML
      // and the parser flattens it, so this is a belt-and-braces branch.
      if (tag === "A") {
        walk(el, marks, kind, false, item, align, safeLinkTarget(el.getAttribute("href")) ?? href);
        continue;
      }
      const mark = MARK_BY_TAG[tag];
      walk(el, mark ? addMark(marks, mark) : marks, kind, false, item, align, href);
```

Import at the top of the file: `import { safeLinkTarget } from "./ooxml-links";`

★ Check the `continue`/loop shape at the real call site before pasting — the mark arm is the last statement of the element branch, so the `A` arm goes immediately above it and must not fall through.

- [ ] **Step 6: Run to verify it passes**

```bash
npx vitest run src/app/rich-text-runs.test.ts > "$SCRATCH/runs.log" 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" "$SCRATCH/runs.log"
```

Expected: EXIT=0, all tests passing including every pre-existing one. A pre-existing failure here means `href` leaked onto an unlinked run.

- [ ] **Step 7: Mutation-prove the allowlist is actually consulted**

Replace `safeLinkTarget(el.getAttribute("href"))` with `(el.getAttribute("href") ?? undefined)` by anchored write, run the file, and expect "drops an unsafe scheme to a plain run" to fail. Record `N failed / M passed`. Revert by inverse anchored write with a uniqueness assertion, then `git diff --stat` clean.

- [ ] **Step 8: Full suite, typecheck, commit**

```bash
npm run test:run > "$SCRATCH/suite.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/suite.log"
npx tsc --noEmit; echo "EXIT=$?"
git commit --only src/app/rich-text-runs.ts src/app/rich-text-runs.test.ts -m "feat: carry a validated href on TextRun"
```

Expected: the full suite green. Nothing outside this file should change behaviour yet — the two renderers ignore the new field until Tasks 4 and 5.

---

## Task 4: DOCX emits `<w:hyperlink>` and an external relationship

**Files:**
- Modify: `src/app/ooxml-docx-primitives.ts` (`markedRun`, `docxRichParagraphs`, `buildDocxPackage`)
- Modify: `src/app/doc-render-docx.ts` (threads the sink)
- Modify: `src/app/ooxml-docx-primitives.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/ooxml-docx-primitives.test.ts`:

```ts
  it("wraps a linked run in w:hyperlink carrying the sink's rel id", () => {
    const sink = createLinkSink(2);
    const xml = docxRichParagraphs('<p><a href="https://intra/spec">the spec</a></p>', sink);
    expect(xml).toContain('<w:hyperlink r:id="rId2"');
    expect(sink.rels()).toEqual([{ relId: "rId2", target: "https://intra/spec" }]);
  });

  it("declares xmlns:r ON the hyperlink element, leaving w:document untouched", () => {
    const sink = createLinkSink(2);
    const xml = docxRichParagraphs('<p><a href="https://a">x</a></p>', sink);
    expect(xml).toContain(
      '<w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    );
  });

  it("emits no hyperlink and mints no rel for an unlinked paragraph", () => {
    const sink = createLinkSink(2);
    const xml = docxRichParagraphs("<p>plain</p>", sink);
    expect(xml).not.toContain("w:hyperlink");
    expect(sink.rels()).toEqual([]);
  });

  it("writes an external relationship with TargetMode and adds NO zip part", async () => {
    const blob = buildDocxPackage("<w:p/>", "", "landscape", [], [
      { relId: "rId2", target: "https://intra/spec?a=1&b=2" },
    ]);
    const parts = await unzipBlob(blob);
    const rels = parts.get("word/_rels/document.xml.rels") ?? "";
    expect(rels).toContain('Id="rId2"');
    expect(rels).toContain('TargetMode="External"');
    expect(rels).toContain("relationships/hyperlink");
    expect(rels).toContain("https://intra/spec?a=1&amp;b=2");
    // The property that separates a link from a media part: no new zip entry.
    expect([...parts.keys()].filter((p) => p.startsWith("word/media/"))).toEqual([]);
    expect(parts.get("[Content_Types].xml")).not.toContain("hyperlink");
  });

  it("throws when a link id collides with a media id", () => {
    expect(() =>
      buildDocxPackage("<w:p/>", "", "landscape", [
        { path: "word/media/image1.png", data: new Uint8Array([1]), relId: "rId2", extension: "png" },
      ], [{ relId: "rId2", target: "https://a" }]),
    ).toThrow(/duplicate relationship id/i);
  });
```

★ `unzipBlob` already exists in `export-ooxml.test.ts`. Import it, or lift it to a shared test helper if that import crosses a boundary the file does not already cross — do not re-implement a second unzip.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/ooxml-docx-primitives.test.ts`
Expected: FAIL — `docxRichParagraphs` takes one argument; `buildDocxPackage` takes four.

- [ ] **Step 3: Emit the hyperlink**

In `markedRun`, wrap when the run carries an href:

```ts
function markedRun(run: TextRun): string {
  const props = [...run.marks]
    .sort((a, b) => DOCX_MARK_RPR[a].rank - DOCX_MARK_RPR[b].rank)
    .map((mark) => DOCX_MARK_RPR[mark].xml)
    .join("");
  const rPr = props === "" ? "" : `<w:rPr>${props}</w:rPr>`;
  const r = `<w:r>${rPr}${docxCellRuns(run.text)}</w:r>`;
  if (run.hyperlinkRelId === undefined) return r;
  // ★★★ `xmlns:r` IS DECLARED HERE, ON THE ELEMENT, and that is load-bearing.
  // `w:document`'s root declares only `xmlns:w` — the media path solves the
  // same problem the same way, declaring xmlns:r locally on `a:blip`. Adding
  // the namespace to the ROOT would change the bytes of EVERY package,
  // including one with no links, breaking the additive contract and moving
  // docs/baselines/ooxml-parts.json.
  return `<w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${run.hyperlinkRelId}">${r}</w:hyperlink>`;
}
```

★ Each linked run is wrapped individually rather than grouping adjacent runs that share a target. Consecutive `w:hyperlink` elements are valid and Word renders them as separate links to the same place; grouping is an optimisation with a correctness risk (a mark boundary inside a link) and is not worth it here.

`run.hyperlinkRelId` is a local field on the render-side run — resolve it in `docxRichParagraphs`, which owns the sink:

```ts
export function docxRichParagraphs(html: string, links?: LinkSink): string {
```

and where it maps `TextRun`s, resolve `run.href` through the sink into `hyperlinkRelId` (undefined when no sink was passed, which keeps every existing caller byte-identical).

- [ ] **Step 4: Add the `links` parameter and widen the guard**

In `buildDocxPackage`, add the fifth parameter and replace the rId1-only loop:

```ts
  links: readonly LinkRel[] = [],
): Blob {
  // ★★ ONE namespace, two families. rId1 is the styles part; media and links
  // both mint above it. A DUPLICATE id is valid XML that resolves to whichever
  // relationship appears FIRST — an image silently becoming a link target,
  // with no schema error and no visible symptom. The rId1 check alone could
  // not see that.
  const seen = new Set<string>();
  for (const relId of [...media.map((m) => m.relId), ...links.map((l) => l.relId)]) {
    if (relId === "rId1") {
      throw new Error(`relId "rId1" is reserved for the styles part`);
    }
    if (seen.has(relId)) throw new Error(`duplicate relationship id "${relId}"`);
    seen.add(relId);
  }
```

★ Keep the media-specific wording of the original rId1 error where it names the part, so the existing test asserting that message still passes; if it does not, that test is telling you the message changed and it must be updated deliberately.

Append the link relationships beside `mediaRels`:

```ts
  // ★★ Unlike a media Target, this one is NOT part-relative. A media Target
  // resolves against `word/`; a hyperlink Target is the raw absolute URL, and
  // making it relative would be the same class of silent breakage in the other
  // direction. `TargetMode="External"` is what licenses a relationship with no
  // part in the package at all.
  const linkRels = links
    .map(
      (l) =>
        `\n  <Relationship Id="${l.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(l.target)}" TargetMode="External"/>`,
    )
    .join("");
```

and interpolate `${mediaRels}${linkRels}` into `docRels`. Nothing else changes — no `<Default>`, no `entries` addition.

- [ ] **Step 5: Thread the sink from the two renderer call sites**

In `doc-render-docx.ts`, create one sink per document with `createLinkSink(2 + <media count>)`, pass it into both `docxRichParagraphs` calls, and hand `sink.rels()` to `buildDocxPackage`. In `ooxml-docx-primitives.ts`'s table-cell path, thread the sink the caller already owns.

- [ ] **Step 6: Run to verify it passes**

```bash
npx vitest run src/app/ooxml-docx-primitives.test.ts src/app/export-ooxml.test.ts src/app/ooxml-package-manifest.test.ts > "$SCRATCH/docx.log" 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" "$SCRATCH/docx.log"
```

Expected: EXIT=0. **If `ooxml-package-manifest.test.ts` goes red, STOP.** That means a link-free package changed bytes, i.e. the additive contract broke. Fix the contract. Do not run `npm run ooxml:manifest`.

- [ ] **Step 7: Mutation-prove the duplicate guard and the TargetMode**

Two mutants, run and reverted one at a time:
1. Delete ` TargetMode="External"` from the relationship string → the external-relationship test must fail.
2. Replace `if (seen.has(relId)) throw` with `if (false) throw` → the collision test must fail.

Record each as `N failed / M passed`, assert each mutant landed, revert by inverse anchored write, and finish on a clean `git diff --stat`.

- [ ] **Step 8: Pin the `dataSection` consumer**

★★ **`export-sections.ts` has a consumer a file-name diff does not show.** `doc-data-section.ts`'s
`resolveDataSection` calls the REAL `buildExportSections` and returns the section unchanged, so a
document's `dataSection` block renders through these same sinks. Five call sites resolve it —
`doc-render-docx.ts`, `doc-render-html.ts`, `doc-render-pptx.ts`, plus `document-preview.tsx` and
`documents-history-modal.tsx` on the UI side.

The HTML path needs nothing: `tableHtml` sends every cell through `exportCellHtml`, which renders a
`RichCell` as markup, so links already survive there and in the in-app preview. The DOCX and PPTX
paths inherit this task's change and Task 6's. Pin that inheritance, because it is the property
`tableHtml`'s own docblock names as the goal — "a document embedding the RAID register gets the
same fidelity as the register's own export":

```ts
  it("gives a dataSection block the same link fidelity as the register's own export", () => {
    // A document embedding a register whose rich column carries a link must
    // reach .docx as a real hyperlink, not as flattened text — the dataSection
    // path resolves through the REAL buildExportSections, so it shares these
    // sinks with the workspace exporter by construction.
    const sink = createLinkSink(2);
    const xml = docxRichParagraphs('<p><a href="https://intra/raid">mitigation</a></p>', sink);
    expect(xml).toContain('<w:hyperlink xmlns:r=');
    expect(sink.rels()).toHaveLength(1);
  });
```

- [ ] **Step 9: Commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git commit --only src/app/ooxml-docx-primitives.ts src/app/ooxml-docx-primitives.test.ts src/app/doc-render-docx.ts -m "feat: emit real hyperlinks in .docx via external relationships"
```

---

## Task 5: PPTX emits `<a:hlinkClick>` per slide

**Files:**
- Modify: `src/app/ooxml-pptx-primitives.ts` (`PptxRun`, the `<a:r>` emitter, `PptxSlide`, `buildPptxPackage`)
- Modify: `src/app/doc-render-pptx-slides.ts` (`pptxRun`)
- Modify: `src/app/doc-render-pptx.ts` (per-slide sink)
- Modify: `src/app/ooxml-pptx-primitives.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
  it("emits a:hlinkClick inside a:rPr for a linked run", () => {
    const xml = pptxTextBox({ /* the file's existing minimal opts */ }, [
      { runs: [{ text: "the spec", hyperlinkRelId: "rId2" }] },
    ]);
    expect(xml).toContain('<a:hlinkClick r:id="rId2"/>');
  });

  it("needs no local xmlns:r — p:sld already binds it", () => {
    const xml = pptxTextBox({ /* same opts */ }, [
      { runs: [{ text: "x", hyperlinkRelId: "rId2" }] },
    ]);
    expect(xml).not.toContain("xmlns:r=");
  });

  it("writes each slide's link rels into that slide's own rels part", async () => {
    const blob = buildPptxPackage([
      { xml: "<p:sp/>", media: [], links: [{ relId: "rId2", target: "https://a" }] },
      { xml: "<p:sp/>", media: [], links: [{ relId: "rId2", target: "https://b" }] },
    ]);
    const parts = await unzipBlob(blob);
    expect(parts.get("ppt/slides/_rels/slide1.xml.rels")).toContain("https://a");
    expect(parts.get("ppt/slides/_rels/slide2.xml.rels")).toContain("https://b");
    expect(parts.get("ppt/slides/_rels/slide1.xml.rels")).not.toContain("https://b");
  });

  it("throws when a slide's link id collides with that slide's media id", () => {
    expect(() =>
      buildPptxPackage([
        {
          xml: "<p:sp/>",
          media: [{ path: "ppt/media/image1.png", data: new Uint8Array([1]), relId: "rId2", extension: "png" }],
          links: [{ relId: "rId2", target: "https://a" }],
        },
      ]),
    ).toThrow(/duplicate relationship id/i);
  });
```

★ The second slide reusing `rId2` is the POINT, not a copy-paste slip: slide rel ids are per-slide and restart at rId2, exactly as this file's own `PptxSlide` docblock states. A test that numbered them deck-wide would pass while pinning the wrong rule.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/ooxml-pptx-primitives.test.ts`
Expected: FAIL — `PptxRun` has no `hyperlinkRelId`, `PptxSlide` has no `links`.

- [ ] **Step 3: Implement**

`PptxRun` gains `hyperlinkRelId?: string`. In the `<a:r>` emitter, append to the existing `children` string:

```ts
  // ★ `a:hlinkClick` is a CHILD of `a:rPr`, not an attribute of it, and it must
  // come after the fill/face children — DrawingML's schema is sequenced.
  // ★★ NO local xmlns:r here, unlike the DOCX side: `wrapPptxSlide` binds the
  // prefix on `<p:sld>` itself, and this file's `r:embed` comment already
  // records that asymmetry. Adding a redundant one would be harmless XML and a
  // misleading precedent.
  const hlink = run.hyperlinkRelId === undefined ? "" : `<a:hlinkClick r:id="${run.hyperlinkRelId}"/>`;
```

`PptxSlide` gains `links?: readonly LinkRel[]`. `buildPptxPackage` widens its per-slide guard the same way DOCX did — rId1 reserved, no duplicates across `slide.media ∪ slide.links` **within one slide** — and appends the same external-relationship XML into that slide's rels part.

`doc-render-pptx-slides.ts`'s `pptxRun` carries the id through; `doc-render-pptx.ts` creates one sink **per slide** with `createLinkSink(2 + <that slide's media count>)`.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/ooxml-pptx-primitives.test.ts src/app/doc-render-pptx.test.ts src/app/ooxml-package-manifest.test.ts > "$SCRATCH/pptx.log" 2>&1; echo "EXIT=$?"
```

Expected: EXIT=0, manifest green without regeneration.

- [ ] **Step 5: Mutation-prove the per-slide scoping**

Mutate the sink construction in `doc-render-pptx.ts` from one-per-slide to one-per-deck. The "each slide's link rels into that slide's own rels part" test must fail. Record `N failed / M passed`, revert, `git diff --stat` clean.

★ If that mutant does NOT fail, the test is not pinning what it claims. A surviving mutant is a question, not a pass — go find the input that separates the two.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git commit --only src/app/ooxml-pptx-primitives.ts src/app/ooxml-pptx-primitives.test.ts src/app/doc-render-pptx-slides.ts src/app/doc-render-pptx.ts -m "feat: emit real hyperlinks in .pptx, scoped per slide"
```

---

## Task 6: The flat sinks carry the address inline

**Files:**
- Modify: `src/app/export-sections.ts` (the new projection)
- Modify: `src/app/export-xlsx.ts`, `src/app/export-pptx.ts`, `src/app/doc-render-pptx.ts` (cell path)
- Modify: `src/app/export-sections.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
  it("appends the address to a link's text for a flat sink", () => {
    const cell = { html: '<p>Spec: <a href="https://intra/spec">the spec</a></p>', text: "Spec: the spec" };
    expect(cellTextWithLinks(cell)).toBe("Spec: the spec (https://intra/spec)");
  });

  it("leaves an unlinked value exactly as cellText produced it", () => {
    const cell = { html: "<p>plain</p>", text: "plain" };
    expect(cellTextWithLinks(cell)).toBe(cellText(cell));
  });

  it("passes a non-rich cell straight through", () => {
    expect(cellTextWithLinks("raw")).toBe("raw");
    expect(cellTextWithLinks(42)).toBe(42);
  });

  it("omits the address when the link text ALREADY is the address", () => {
    const cell = { html: '<p><a href="https://a">https://a</a></p>', text: "https://a" };
    expect(cellTextWithLinks(cell)).toBe("https://a");
  });

  it("drops an unsafe scheme rather than printing it", () => {
    const cell = { html: '<p><a href="javascript:alert(1)">click</a></p>', text: "click" };
    expect(cellTextWithLinks(cell)).toBe("click");
  });
```

★ The fourth case is why this is a projection and not a string append: a pasted URL is its own link text, and `https://a (https://a)` is worse than what it replaced.

And the pin that protects everything else reading the plain projection:

```ts
  it("leaves htmlToText byte-unchanged — search and the AI digests read it", () => {
    expect(htmlToText('<p>Spec: <a href="https://intra/spec">the spec</a></p>')).toBe("Spec: the spec");
  });
```

★ That assertion is POSITIVE on purpose. A test asserting the new projection differs from the old one goes green if both change together; this one goes red the moment anyone widens `htmlToText`, which is the thing §30 forbids.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/export-sections.test.ts`
Expected: FAIL — `cellTextWithLinks` is not exported.

- [ ] **Step 3: Implement**

Add to `export-sections.ts` a projection that parses the cell's `html`, walks it with the same `htmlToRichLines` the renderers use, and rebuilds the text with `text (url)` for each run whose `href` is present and differs from its own text. Reuse the parse — do not write a second anchor walk, and do not touch `htmlToText`.

- [ ] **Step 4: Wire the three flat call sites**

`export-xlsx.ts` (the shared-string cell), `export-pptx.ts` (both row values and the trailing columns), and `doc-render-pptx.ts`'s table path swap `cellText` for `cellTextWithLinks`. The whitespace collapse in the PPTX path stays where it is, applied after.

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run src/app/export-sections.test.ts src/app/export-ooxml.test.ts > "$SCRATCH/flat.log" 2>&1; echo "EXIT=$?"
```

Expected: EXIT=0. A red `export-ooxml.test.ts` here is a real signal — it asserts exported substrings, so it will notice the new suffix. Update those assertions deliberately, and only where the fixture genuinely contains a link.

- [ ] **Step 6: Mutation-prove the htmlToText pin**

Widen `htmlToText`'s `ALLOWED_TAGS` from `[]` to `["a"]` by anchored write. The byte-unchanged test must fail. Record `N failed / M passed`, revert, `git diff --stat` clean.

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git commit --only src/app/export-sections.ts src/app/export-sections.test.ts src/app/export-xlsx.ts src/app/export-pptx.ts src/app/doc-render-pptx.ts -m "feat: carry link addresses inline in the flat export sinks"
```

---

## Task 7: Prove the additive contract across the whole suite

**Files:**
- Modify: `src/app/ooxml-package-manifest.test.ts` (one added assertion)

- [ ] **Step 1: Add the explicit link-free assertion**

```ts
  it("adds nothing to a package built with an empty links array", async () => {
    const withoutArg = await unzipBlob(buildDocxPackage("<w:p/>", "", "landscape", []));
    const withEmpty = await unzipBlob(buildDocxPackage("<w:p/>", "", "landscape", [], []));
    expect([...withEmpty.keys()]).toEqual([...withoutArg.keys()]);
    for (const [path, data] of withEmpty) expect(data).toBe(withoutArg.get(path));
  });
```

- [ ] **Step 2: Run the gates that can see package drift**

```bash
npm run test:run > "$SCRATCH/full.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/full.log"
npm run test:shuffle > "$SCRATCH/shuffle.log" 2>&1; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: all EXIT=0 (tsc exits 2 on diagnostics). Run these SEQUENTIALLY — never two vitest processes at once.

- [ ] **Step 3: Commit**

```bash
git commit --only src/app/ooxml-package-manifest.test.ts -m "test: pin the links additive contract against the part manifest"
```

---

## Task 8: Produce the sample files for the manual pass

**Files:**
- Create: `scripts/sample-link-exports.mjs`

- [ ] **Step 1: Write the script**

It builds four files into the session scratchpad — DOCX and PPTX, each from the document renderer and from the workspace exporter — from a fixture containing: an `https` link, a `mailto` link, a URL that is its own link text, a link inside bold, a link whose target repeats (proving one relationship serves both), a `javascript:` link that must appear as inert text, **and at least one image**, so the same pass discharges §219.

- [ ] **Step 2: Run it**

```bash
node scripts/sample-link-exports.mjs "$SCRATCH"
ls -la "$SCRATCH"/*.docx "$SCRATCH"/*.pptx
```

Expected: four files, each non-zero.

- [ ] **Step 3: Add a scripts-doc entry**

A new `package.json` script needs a `scriptsDescriptions` entry or `docs:scripts:check` fails the build:

```bash
npm run build > "$SCRATCH/build.log" 2>&1; echo "EXIT=$?"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/sample-link-exports.mjs
git commit --only scripts/sample-link-exports.mjs package.json -m "chore: script to emit link-bearing sample exports for the manual pass"
```

- [ ] **Step 5: HAND OFF TO THE USER — this is a gate, not a formality**

Tell the user the four paths and ask them to open each in **Word** and in **LibreOffice**, confirming for each file: the links are live and land on the right address; the `javascript:` one is inert text; the repeated target still works in both places; the image renders.

★★★ Nothing in this repo can open a `.docx` or a `.pptx`. A wrong `Type` URI or a missing `TargetMode` unzips clean, asserts clean, and opens with the link dead or the file repaired. **Do not proceed to Task 10 until the user reports back**, and record exactly what they opened and confirmed — a vague "looked fine" is how §219 became invisible.

---

## Task 9: Close the register entries and file what was not built

**Files:**
- Modify: `docs/open-followups.md`
- Modify: `docs/superpowers/specs/2026-08-31-followup-slice-roadmap.md`

- [ ] **Step 1: Find every place each closure has to touch**

```bash
grep -n "119\|§119" docs/open-followups.md | head -20
grep -n "30\.\|§30" docs/open-followups.md | head -20
```

★★ A closure is a FOUR-place edit at minimum — heading marker, summary-table STATUS cell, summary-table ANCHOR, and the `**Status:**` witness — but 2026-09-01 saw one take SIX and another FIVE, the extras being cross-reference anchors inside OTHER entries' bodies plus body claims the fix falsified. `isClosed` reads the TITLE only. A body line must never contain the word CLOSED.

- [ ] **Step 2: Close §119 and §30** with the decision recorded and the reproduce commands that now return the fixed shape.

- [ ] **Step 3: Narrow §219** to exactly what the manual pass did NOT cover. If the pass covered everything it names, close it; if not, narrow it rather than closing.

- [ ] **Step 4: File the deliberate non-goals** above 328 — real XLSX cell hyperlinks (one-per-cell, cannot hold a multi-link description) and the flat PPTX table cell keeping the inline form. Confirm the next free number:

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

★ A number is reserved only once it is on `origin/main`; two branches have minted the same one before.

★★ **A concurrent branch is minting from the same range right now.** `fix/colour-only-state-1-4-1` (roadmap slice 7 + §325) has agreed to take **331-332**; this branch takes **329-330**. Whichever merges SECOND re-runs the command above and renumbers rather than assuming the agreement held — the agreement binds the two sessions, not the register.

★★ That branch also edits `docs/open-followups.md`, so expect a conflict there. Adjudicate the summary table PER ROW. Resolving by taking one side wholesale loses the other branch's entries with every gate still green, and `git diff --cc` cannot see it — it is a census of INVENTED content, blind to a resolution that took one side whole. Diff against your own tip afterwards, not only against the merge base.

- [ ] **Step 5: Correct the roadmap** — record the 4a/4b split, and correct its claim that hyperlink relationships move the part manifest.

- [ ] **Step 6: Gates and commit**

```bash
npm run docs:claims:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
git commit --only docs/open-followups.md docs/superpowers/specs/2026-08-31-followup-slice-roadmap.md -m "docs: close 119 and 30, file the deliberate non-goals"
```

---

## Task 10: RELEASE — gated twice, do not fold into any other task

**Do not start this task unless BOTH hold:**
1. The user has explicitly said to release. `mr-only-on-explicit-say` is standing — no push, no MR, no merge without it.
2. The user has reported back on Task 8's manual pass and it passed.

A code review is required before every release (`review-before-release`), and it happens before the bump, not after.

- [ ] **Step 1: Cold code review** of the whole branch by a reviewer with no context from this session. Verify every actionable claim at source before acting on it — reviewers report false findings, and a correction is a NEW claim inheriting none of the verification of what it corrects.

- [ ] **Step 2: Merge `origin/main` in** and verify both sides survived by grepping for strings from each, rather than trusting a clean merge exit.

- [ ] **Step 3: Bump** `src/app/version.ts` (APP_VERSION, APP_MILESTONE, APP_BUILD_DATE) — the codename must be unique within the MINOR line — add the CHANGELOG entry, then:

```bash
npm run version:sync; echo "EXIT=$?"
npm run version:check; echo "EXIT=$?"   # 1 = drift, 2 = the gate could not scan
```

- [ ] **Step 4: Push, open the MR.** ★★ No `[session link removed]...` URL in the MR description or in `CHANGELOG.md`; commit trailers and MR comments are exempt.

- [ ] **Step 5: Poll the pipeline to a terminal state. Merge ONLY on green:**

```bash
glab mr merge <id> --auto-merge=false
```

★★★ `glab` DEFAULTS `--auto-merge=true`. Omitting the flag is NOT opting out — pass `=false` explicitly.

---

## Self-review

**Spec coverage.** Every section maps to a task: the parse and scheme allowlist → Tasks 2-3; DOCX rels and the widened guard → Task 4; PPTX per-slide → Task 5; the flat projection and the `htmlToText` pin → Task 6; the additive contract and the manifest → Tasks 4, 5, 7; verification and §219 → Task 8; register and roadmap updates → Tasks 1 and 9; the release gate → Task 10. The spec's ordering constraint (correct §119 before closing it) is Task 1 versus Task 9.

**Type consistency.** `LinkRel` and `LinkSink` are declared once in `ooxml-links.ts` (Task 2) and used unchanged in Tasks 4, 5. `createLinkSink(firstFreeIndex)` takes the same argument shape at all three construction sites. `safeLinkTarget` is consumed only by the parse (Task 3) and the flat projection (Task 6). `hyperlinkRelId` is the render-side field name on both `PptxRun` and the DOCX run; `href` is the parse-side field on `TextRun`. Those two names are deliberately different — one is a URL, the other is a relationship id, and conflating them is the bug this naming prevents.

**Known gap, recorded rather than papered over.** Task 6 Step 3 describes the projection's behaviour and its reuse of `htmlToRichLines` but does not paste a finished function body, because the exact shape depends on the whitespace handling in `descriptionTextWithBreaks` that the implementer must read first. The five tests in Step 1 fully specify the behaviour, which is what the implementer builds against.
