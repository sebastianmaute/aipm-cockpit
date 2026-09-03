# Ingest Breadth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI Assistant read Outlook mail (`.msg`, `.eml`, `.mhtml`), extract real content from HTML, recurse into mail attachments, and give all three attachment consumers one identical set of supported types.

**Architecture:** One orchestrator (`attachment-ingest.ts`) owns read, classify, extract and recurse; the three consumers call it instead of each running their own copy. Parsers are pure functions from bytes to values, driven by the orchestrator rather than calling back into it, so the dependency graph stays acyclic and every parser is node-testable with no DOM. `.msg` reduces to a `Map<string, Uint8Array>` of named streams, deliberately mirroring `readZipEntries`, so it inherits the shape and testability of the existing Office extractors.

**Tech Stack:** TypeScript, vitest, no new runtime dependencies. Hand-rolled MS-CFB and MIME parsers derived from published Microsoft specifications (MS-CFB, MS-OXMSG, MS-OXPROPS, MS-OXRTFCP).

**Spec:** `docs/superpowers/specs/2026-09-03-ingest-breadth-design.md`

---

## Read this before Task 1

Landmines that will cost you a day each if you learn them the hard way.

- **Every `src/app/*.ts(x)` file is CRLF.** The `Write` tool re-lines a CRLF file to LF; `Edit` preserves it. For `src/app/i18n.de.ts` use neither — patch it with a node UTF-8 write anchored on `\r\n`, or the umlauts corrupt. New files you create are fine either way.
- **Never read a gate's exit code through a pipe.** `npm run test:run | tail -5` reports `tail`'s status. Redirect to a file, `echo "EXIT=$?"` unpiped, then read the file.
- **`npx tsc --noEmit` exits 2 on diagnostics, not 1.**
- **Never run two vitest processes at once.** A vitest failure carrying `Failed to start forks worker` is machine contention, not evidence.
- **Coverage floors are blocking in CI** (global lines 92 / funcs 91 / branch 80 / stmts 89) and `npm run test:run` does not enforce them. Every new `.ts` file here is coverage-gated. The malformed-input tests are most of the branch count — write them or the unit job fails.
- **`npm run size:check` counts `split("\n").length`, one more than `wc -l`.** A file at `wc -l` 799 is already at the 800 limit.
- **`npm run lint` exits 1 from gitignored leftovers.** Use `npx eslint --max-warnings=0 src` instead. Every eslint warning is fatal, including unused parameters — `_`-prefixing does not exempt them.

Per-file test command used throughout: `npx vitest run <path>`.

---

## File Structure

**New files, all under `src/app/`:**

| File | Responsibility |
|---|---|
| `attachment-ingest.ts` | Orchestrator. Reads a File or bytes, classifies, extracts, recurses into mail, owns the budget. The only module the three consumers call. |
| `html-extract.ts` | Hostile HTML to Markdown. Boilerplate drop, entity decode, block structure. Pure, no DOM. |
| `mime-parse.ts` | RFC 5322 / 2045. Text in, header map plus part tree out. Serves `.eml`, `.mhtml`, `.mht`. |
| `eml-extract.ts` | `MimeMessage` to `ParsedMail`. |
| `cfbf.ts` | MS-CFB compound file reader. DIFAT chaining, FAT and miniFAT walks, red-black directory tree, all guards. |
| `lzfu.ts` | MS-OXRTFCP decompression, plus RTF to plain-text de-encapsulation. |
| `msg-extract.ts` | CFBF stream tree to `ParsedMail`. Resolves properties by storage path. |
| `mail-extract.ts` | Router over `.eml`/`.msg`, and the single `ParsedMail` to Markdown renderer. |

**Modified files:**

| File | Change |
|---|---|
| `chat-attachments.ts` | Widen `AttachmentKind`; export `ATTACHMENT_ACCEPT` and the tables it derives from. |
| `chat-panel.tsx` | Call the orchestrator; use `ATTACHMENT_ACCEPT`; render the per-attachment summary. |
| `step0-import-panel.tsx` | Call the orchestrator; use `ATTACHMENT_ACCEPT`. |
| `chat-api.ts` | `readAttachmentData` moves into the orchestrator; re-export or delete. |
| `i18n.ts`, `i18n.de.ts` | Add `chatAttachmentEncrypted` and the summary-line keys. |

**Phases.** Each ends green and shippable on its own.

- **Phase 1 (Tasks 1-5)** — unify the pipeline, fix the drift, fix HTML. Ships alone and is worth shipping alone.
- **Phase 2 (Tasks 6-11)** — `.eml` / `.mhtml`, recursion, budget, disclosure, summary UI.
- **Phase 3 (Tasks 12-17)** — `.msg`.

---

## Phase 1 — Unify the pipeline, fix the drift, fix HTML

### Task 1: Derive the accept string from one table

**Files:**
- Modify: `src/app/chat-attachments.ts`
- Test: `src/app/chat-attachments.test.ts`

The three consumers hand-maintain their own `accept=` strings and have already drifted by six tokens. Everything downstream depends on there being one source.

- [ ] **Step 1: Write the failing test**

Append to `src/app/chat-attachments.test.ts`:

```ts
describe("ATTACHMENT_ACCEPT", () => {
  // ★ THE DEFECT THIS EXISTS FOR. Three consumers hand-wrote this string and
  //  drifted: the wizard's list was a strict subset missing .markdown and every
  //  MIME type, so a correctly-typed file with no extension was filtered out of
  //  its picker while classifyAttachment would have accepted it.
  it("offers every extension classifyAttachment accepts", () => {
    const tokens = ATTACHMENT_ACCEPT.split(",");
    for (const ext of [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp",
                       ".txt", ".md", ".markdown", ".csv", ".html", ".htm",
                       ".vtt", ".docx", ".xlsx", ".xlsm", ".pptx"]) {
      expect(tokens).toContain(ext);
      expect(classifyAttachment("application/octet-stream", `f${ext}`)).not.toBeNull();
    }
  });

  it("offers the MIME types too, so an extensionless file still passes the picker", () => {
    const tokens = ATTACHMENT_ACCEPT.split(",");
    expect(tokens).toContain("application/pdf");
    expect(tokens).toContain("text/plain");
    expect(tokens).toContain("image/*");
  });

  it("lists no token twice", () => {
    const tokens = ATTACHMENT_ACCEPT.split(",");
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
```

Add `ATTACHMENT_ACCEPT` to the file's existing import from `./chat-attachments`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/chat-attachments.test.ts`
Expected: FAIL — `ATTACHMENT_ACCEPT is not defined`.

- [ ] **Step 3: Implement**

In `src/app/chat-attachments.ts`, promote the private sets to exported constants and derive the string. Replace the existing `SUPPORTED_IMAGE_MIMES`, `PDF_EXTENSIONS`, `IMAGE_EXTENSIONS` and `TEXT_EXTENSIONS` declarations with:

```ts
export const SUPPORTED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export const PDF_EXTENSIONS = new Set([".pdf"]);
export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
export const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".vtt"]);
export const HTML_EXTENSIONS = new Set([".html", ".htm"]);
export const OFFICE_EXTENSIONS = new Set([".docx", ".xlsx", ".xlsm", ".pptx"]);

/** Extra MIME tokens the picker should offer. Extensions alone are not enough:
 *  a file arriving as application/octet-stream with no extension is classified
 *  by MIME, and a picker listing only extensions filters it out before
 *  classifyAttachment ever sees it. */
const ACCEPT_MIMES = [
  "application/pdf",
  "image/*",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/vtt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

/** ★★★ THE SINGLE SOURCE FOR EVERY FILE PICKER IN THE APP. Three consumers
 *  (chat-panel, step0-import-panel, and anything added later) must use this and
 *  never hand-write an accept string. They did hand-write them once and drifted
 *  by six tokens — .markdown plus every MIME type — so the wizard silently
 *  rejected files the assistant accepted. Deriving it from the same sets
 *  classifyAttachment consults makes that class of drift unrepresentable. */
export const ATTACHMENT_ACCEPT = [
  ...PDF_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...TEXT_EXTENSIONS,
  ...HTML_EXTENSIONS,
  ...OFFICE_EXTENSIONS,
  ...ACCEPT_MIMES,
].join(",");
```

`classifyAttachment`'s extension fallback keeps working unchanged, except that its `TEXT_EXTENSIONS.has(ext)` check no longer matches `.html`/`.htm` — Task 3 adds the `HTML_EXTENSIONS` branch. Until then, add `HTML_EXTENSIONS` to the existing text branch so behaviour is unchanged:

```ts
  if (ext !== "" && TEXT_EXTENSIONS.has(ext)) return "text";
  if (ext !== "" && HTML_EXTENSIONS.has(ext)) return "text";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/chat-attachments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-attachments.ts src/app/chat-attachments.test.ts
git commit -m "feat: derive one attachment accept string from the classifier's own tables"
```

---

### Task 2: Wire all three consumers to `ATTACHMENT_ACCEPT`

**Files:**
- Modify: `src/app/chat-panel.tsx` (the `accept=` on the file input)
- Modify: `src/app/step0-import-panel.tsx` (the `accept=` on the file input)
- Test: `src/app/step0-import-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/step0-import-panel.test.tsx`, inside the existing top-level `describe`:

```ts
  // ★★ The wizard's hand-written accept string was a strict subset of the
  //  assistant's — missing .markdown and every MIME token. Assert against the
  //  shared constant, not a literal, or this test drifts the same way.
  it("offers the shared accept list, not a hand-written subset", () => {
    renderPanel();
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.getAttribute("accept")).toBe(ATTACHMENT_ACCEPT);
  });
```

Import `ATTACHMENT_ACCEPT` from `./chat-attachments`. If the file has no `renderPanel` helper, use whatever render helper the existing tests in that file use.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/step0-import-panel.test.tsx`
Expected: FAIL — the received string is the old 22-token subset.

- [ ] **Step 3: Implement**

In `src/app/step0-import-panel.tsx`, add `ATTACHMENT_ACCEPT` to the existing import from `./chat-attachments`, then replace the long literal on the file input with:

```tsx
              accept={ATTACHMENT_ACCEPT}
```

Do the same in `src/app/chat-panel.tsx` — add `ATTACHMENT_ACCEPT` to its existing `./chat-attachments` import and replace its literal with `accept={ATTACHMENT_ACCEPT}`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/app/step0-import-panel.test.tsx src/app/chat-panel.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Verify no hand-written accept strings remain**

```bash
grep -rn 'accept="\.' src/app --include=*.tsx
```
Expected: only `asset-library.tsx`, `branding-image-input.tsx`, `color-scheme-editor.tsx` and `theme-gallery.tsx`, which pick images or JSON and are not attachment consumers. No hit in `chat-panel.tsx` or `step0-import-panel.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-panel.tsx src/app/step0-import-panel.tsx src/app/step0-import-panel.test.tsx
git commit -m "fix: point every file picker at the shared accept list"
```

---

### Task 3: `html-extract.ts`

**Files:**
- Create: `src/app/html-extract.ts`
- Test: `src/app/html-extract.test.ts`

Raw markup currently reaches the model as `text/plain`. A saved page is mostly `<script>` and navigation chrome, which spends the extraction budget on noise.

- [ ] **Step 1: Write the failing test**

Create `src/app/html-extract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractHtmlMarkdown } from "./html-extract";

describe("extractHtmlMarkdown", () => {
  // ★★★ THE DEFECT THIS EXISTS FOR. .html classified as `text`, so the raw
  //  source — script bodies included — was handed to the model verbatim.
  it("drops script and style bodies entirely", () => {
    const out = extractHtmlMarkdown(
      `<html><head><style>.a{color:red}</style></head>` +
      `<body><script>var secret = 41 + 1;</script><p>Kept</p></body></html>`,
    );
    expect(out).toContain("Kept");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("color:red");
  });

  it("drops nav and footer chrome", () => {
    const out = extractHtmlMarkdown(
      `<body><nav>Home About</nav><p>Body text</p><footer>(c) 2026</footer></body>`,
    );
    expect(out).toContain("Body text");
    expect(out).not.toContain("Home About");
    expect(out).not.toContain("(c) 2026");
  });

  it("renders headings and list items as Markdown", () => {
    const out = extractHtmlMarkdown(`<h2>Title</h2><ul><li>one</li><li>two</li></ul>`);
    expect(out).toContain("## Title");
    expect(out).toContain("- one");
    expect(out).toContain("- two");
  });

  it("renders a table as a Markdown table", () => {
    const out = extractHtmlMarkdown(
      `<table><tr><th>Role</th><th>Hours</th></tr><tr><td>PM</td><td>40</td></tr></table>`,
    );
    expect(out).toContain("| Role | Hours |");
    expect(out).toContain("| PM | 40 |");
  });

  it("decodes entities", () => {
    expect(extractHtmlMarkdown(`<p>A &amp; B &lt; C &#39;quoted&#39; &nbsp;end</p>`))
      .toContain("A & B < C 'quoted'");
  });

  it("keeps block boundaries apart rather than running words together", () => {
    expect(extractHtmlMarkdown(`<p>one</p><p>two</p>`)).toMatch(/one\s*\n\s*\n?\s*two/);
  });

  it("returns the empty-document marker for markup with no text", () => {
    expect(extractHtmlMarkdown(`<html><head><title>x</title></head><body></body></html>`))
      .toBe("_(document contained no extractable text)_");
  });

  it("does not throw on unterminated markup", () => {
    expect(() => extractHtmlMarkdown(`<p>text <div><span`)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/html-extract.test.ts`
Expected: FAIL — cannot resolve `./html-extract`.

- [ ] **Step 3: Implement**

Create `src/app/html-extract.ts`:

```ts
// src/app/html-extract.ts — hostile HTML -> Markdown, for AI ingestion.
//
// ★★ DELIBERATELY NOT `htmlPlainProjection` (rich-text-plain.ts). That helper is
// genuinely DOM-free and would mostly work, but it imports sanitize-html.ts,
// which pulls DOMPurify into the module graph and costs this extractor family
// its zero-import purity. It is also a different job: that one projects
// ALREADY-SANITIZED rich text, this one strips a hostile web page. Sharing
// would couple two things that only look alike.
//
// ★ Output is model-facing only. It is never rendered as HTML anywhere, so this
// module is an EXTRACTOR, not a sanitizer — do not cite it as an XSS boundary.

/** Elements whose entire subtree is noise for a reader. */
const DROP_SUBTREE = ["script", "style", "head", "nav", "footer", "aside", "noscript", "svg"];

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", rsquo: "\u2019", lsquo: "\u2018",
  ldquo: "\u201c", rdquo: "\u201d", middot: "\u00b7", bull: "\u2022", copy: "\u00a9",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const n = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    if (body.startsWith("#")) {
      const n = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function dropSubtrees(html: string): string {
  let out = html;
  for (const tag of DROP_SUBTREE) {
    // Non-greedy, case-insensitive, dot-matches-newline via [\s\S].
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, "gi"), " ");
    // An unterminated one: drop from the open tag to end of input.
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*$`, "i"), " ");
  }
  return out;
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

/** Render <table> to a Markdown table before generic tag-stripping flattens it.
 *  Tables are the one structure whose loss actually changes meaning — a
 *  resourcing mail's allocations live in one. */
function renderTables(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table\s*>/gi, (table) => {
    const rows: string[][] = [];
    const trRe = /<tr\b[\s\S]*?<\/tr\s*>/gi;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(table)) !== null) {
      const cells: string[] = [];
      const cellRe = /<(t[dh])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
      let c: RegExpExecArray | null;
      while ((c = cellRe.exec(tr[0])) !== null) cells.push(cellText(c[2]));
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return " ";
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
    const lines = [
      `| ${pad(rows[0]).join(" | ")} |`,
      `| ${Array(width).fill("---").join(" | ")} |`,
      ...rows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`),
    ];
    return `\n\n${lines.join("\n")}\n\n`;
  });
}

export function extractHtmlMarkdown(html: string): string {
  let s = dropSubtrees(html);
  s = renderTables(s);
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, lvl: string, inner: string) =>
    `\n\n${"#".repeat(Number(lvl))} ${cellText(inner)}\n\n`);
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (_m, inner: string) => `\n- ${cellText(inner)}`);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|ul|ol|section|article|h[1-6]|blockquote)\s*>/gi, "\n\n");
  s = s.replace(/<[^>]*>/g, " ");            // every remaining tag, incl. unterminated
  s = s.replace(/<[^>]*$/g, " ");            // a trailing "<span" with no ">"
  s = decodeEntities(s);
  s = s.replace(/[ \t\u00a0]+/g, " ");
  s = s.split("\n").map((l) => l.trim()).join("\n");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s === "" ? "_(document contained no extractable text)_" : s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/html-extract.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-prove the two guards that matter**

Delete `"script"` from `DROP_SUBTREE`, re-run. Expected: the first test goes RED (`secret` appears). Restore it.
Delete the `renderTables(s)` call, re-run. Expected: the table test goes RED. Restore it.
Record the result as `N failed / M passed`; the sum must be 8.

Revert each mutation with an anchored write and confirm `git diff --stat` is empty before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/app/html-extract.ts src/app/html-extract.test.ts
git commit -m "feat: extract readable Markdown from HTML instead of dumping raw markup"
```

---

### Task 4: Route `.html` through the new extractor

**Files:**
- Modify: `src/app/chat-attachments.ts`
- Test: `src/app/chat-attachments.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/chat-attachments.test.ts`:

```ts
describe("html classification", () => {
  it("classifies html as its own kind, not as text", () => {
    expect(classifyAttachment("text/html", "page.html")).toBe("html");
    expect(classifyAttachment("application/octet-stream", "page.htm")).toBe("html");
  });

  it("still classifies plain text as text", () => {
    expect(classifyAttachment("text/plain", "notes.txt")).toBe("text");
    expect(classifyAttachment("text/csv", "rows.csv")).toBe("text");
  });

  it("builds a text block for html, since the caller passes extracted Markdown", () => {
    expect(buildAttachmentBlock("html", "text/html", "## Title")).toEqual({
      type: "document",
      source: { type: "text", media_type: "text/plain", data: "## Title" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/chat-attachments.test.ts`
Expected: FAIL — received `"text"`, expected `"html"`.

- [ ] **Step 3: Implement**

In `src/app/chat-attachments.ts`:

Widen the union:

```ts
export type AttachmentKind = "pdf" | "image" | "text" | "office" | "html" | "mail";
```

In `classifyAttachment`, remove `text/html` from the MIME text branch and add an HTML branch above it:

```ts
  // --- HTML (extracted to Markdown; raw markup would spend the budget on chrome) ---
  if (mime === "text/html") return "html";
```

Replace the two extension-fallback lines added in Task 1 with:

```ts
  if (ext !== "" && TEXT_EXTENSIONS.has(ext)) return "text";
  if (ext !== "" && HTML_EXTENSIONS.has(ext)) return "html";
```

In `buildAttachmentBlock`, add before the final `text` fallthrough:

```ts
  if (kind === "html" || kind === "mail") {
    // `data` is already extracted Markdown, produced by the ingest orchestrator.
    return {
      type: "document",
      source: { type: "text", media_type: "text/plain", data },
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/chat-attachments.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix every exhaustiveness break**

Run: `npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"` (remember: exit 2 means diagnostics).

Expected breaks and their fixes:
- `src/app/chat-api.ts` — `readAttachmentData(file, kind: "pdf" | "image" | "text" | "office")`. Widen the parameter to `AttachmentKind`, importing the type from `./chat-attachments`. Task 5 moves this function out entirely; widening is the minimal step now.
- `src/app/step0-import-panel.tsx` — `mimeForKind` already falls through to `"text/plain"`, which is correct for both new kinds; no change needed unless tsc says otherwise.

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-attachments.ts src/app/chat-attachments.test.ts src/app/chat-api.ts
git commit -m "feat: give html its own attachment kind so it routes through the extractor"
```

---

### Task 5: `attachment-ingest.ts` — one pipeline for three consumers

**Files:**
- Create: `src/app/attachment-ingest.ts`
- Test: `src/app/attachment-ingest.test.ts`
- Modify: `src/app/chat-panel.tsx`, `src/app/step0-import-panel.tsx`, `src/app/chat-api.ts`

No recursion yet — this task only unifies the three duplicated read/classify/extract sequences so Phase 2 has one place to add the tree walk.

- [ ] **Step 1: Write the failing test**

Create `src/app/attachment-ingest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ingestBytes } from "./attachment-ingest";

const enc = (s: string) => new TextEncoder().encode(s);

describe("ingestBytes", () => {
  it("rejects an unsupported type", async () => {
    const r = await ingestBytes(enc("x"), "application/x-thing", "a.thing");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unsupported-type");
  });

  it("rejects an oversized file before reading it", async () => {
    const r = await ingestBytes(new Uint8Array(21 * 1024 * 1024), "text/plain", "big.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("too-large");
  });

  it("decodes text", async () => {
    const r = await ingestBytes(enc("hello"), "text/plain", "a.txt");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.node.kind).toBe("text");
      expect(r.node.block.source).toMatchObject({ type: "text", data: "hello" });
    }
  });

  it("routes html through the html extractor", async () => {
    const r = await ingestBytes(enc("<p>Hi</p><script>x()</script>"), "text/html", "a.html");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.node.kind).toBe("html");
      const src = r.node.block.source as { data: string };
      expect(src.data).toContain("Hi");
      expect(src.data).not.toContain("x()");
    }
  });

  it("base64-encodes a pdf without decoding it as text", async () => {
    const r = await ingestBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf", "a.pdf");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.block.source).toMatchObject({ type: "base64", data: "JVBERg==" });
  });

  it("reports one node and no children for a flat file", async () => {
    const r = await ingestBytes(enc("hello"), "text/plain", "a.txt");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.children).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/attachment-ingest.test.ts`
Expected: FAIL — cannot resolve `./attachment-ingest`.

- [ ] **Step 3: Implement**

Create `src/app/attachment-ingest.ts`:

```ts
// src/app/attachment-ingest.ts — the ONE read/classify/extract pipeline.
//
// ★★★ THREE CONSUMERS CALL THIS AND NONE MAY REIMPLEMENT IT: chat-panel.tsx,
// step0-import-panel.tsx and anything added later. They each carried their own
// copy once, and the copies drifted — the wizard silently rejected six token
// classes the assistant accepted. Phase 2 adds mail recursion HERE, which is
// the other reason the pipeline cannot live in the callers: a dropped .eml is a
// TREE, and three separate tree walks with three separate budgets is not a
// thing anyone should maintain.

import {
  classifyAttachment,
  checkAttachmentSize,
  buildAttachmentBlock,
  type AttachmentKind,
  type AttachmentBlock,
  type AttachmentError,
} from "./chat-attachments";
import { officeKindOf, extractOfficeMarkdown } from "./office-extract";
import { extractHtmlMarkdown } from "./html-extract";

export type IngestNode = {
  fileName: string;
  kind: AttachmentKind;
  block: AttachmentBlock;
  /** Nested attachments, for mail. Empty for every flat file. */
  children: IngestNode[];
};

export type IngestResult =
  | { ok: true; node: IngestNode }
  | { ok: false; error: AttachmentError | "read-failed" | "encrypted" };

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  // Chunked so a large attachment cannot blow the argument limit of String.fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** Extract one file's model-facing payload. Bytes in, `data` for
 *  buildAttachmentBlock out. Mail kinds are handled in Phase 2. */
async function payloadFor(
  kind: AttachmentKind,
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<string> {
  if (kind === "office") {
    const fmt = officeKindOf(mimeType, fileName);
    if (!fmt) throw new Error("unknown office format");
    return extractOfficeMarkdown(bytes, fmt);
  }
  if (kind === "html") return extractHtmlMarkdown(new TextDecoder().decode(bytes));
  if (kind === "text") return new TextDecoder().decode(bytes);
  return bytesToBase64(bytes);
}

export async function ingestBytes(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<IngestResult> {
  const sizeErr = checkAttachmentSize(bytes.byteLength);
  if (sizeErr) return { ok: false, error: sizeErr };
  const kind = classifyAttachment(mimeType, fileName);
  if (!kind) return { ok: false, error: "unsupported-type" };
  try {
    const data = await payloadFor(kind, bytes, mimeType, fileName);
    return {
      ok: true,
      node: { fileName, kind, block: buildAttachmentBlock(kind, mimeType, data), children: [] },
    };
  } catch {
    return { ok: false, error: "read-failed" };
  }
}

/** Browser entry point. Reads the File, then defers to ingestBytes so both
 *  paths share one implementation — the wizard already had a bytes-oriented
 *  path and the assistant a File-oriented one, and they had diverged. */
export async function ingestFile(file: File): Promise<IngestResult> {
  const sizeErr = checkAttachmentSize(file.size);
  if (sizeErr) return { ok: false, error: sizeErr };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, error: "read-failed" };
  }
  return ingestBytes(bytes, file.type, file.name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/attachment-ingest.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Point the consumers at it**

In `src/app/chat-panel.tsx`, replace the body of the `for` loop inside `handleFiles` with:

```tsx
    for (const file of Array.from(files)) {
      const result = await ingestFile(file);
      if (!result.ok) {
        errors.push(attachmentErrorText(result.error, file.name));
        continue;
      }
      staged.push({
        id: `att-${(attachSeqRef.current += 1)}`,
        name: file.name,
        block: result.node.block,
      });
    }
```

Widen `attachmentErrorText` to cover the new error codes. `"encrypted"` maps to the generic
read-failure string for now; Task 6 adds the dedicated key and rewires this one line. Nothing
produces `"encrypted"` until Phase 3, so this is correct at every point in between:

```tsx
  function attachmentErrorText(
    err: "too-large" | "unsupported-type" | "read-failed" | "encrypted",
    name: string,
  ): string {
    if (err === "too-large") return t(lang, "chatAttachmentTooLarge", name);
    if (err === "unsupported-type") return t(lang, "chatAttachmentUnsupported", name);
    return t(lang, "chatAttachmentReadFailed", name);
  }
```

In `src/app/step0-import-panel.tsx`, replace the per-file body in its loop with the same `ingestFile` call, mapping `result.error` onto its existing `dropped` reasons (`"too-large"`, `"unsupported"`), and replace the SharePoint path's read/classify/extract block with `await ingestBytes(bytes, mime, name)`.

Delete `readFileData` and `mimeForKind` from `step0-import-panel.tsx`, and `readAttachmentData` from `chat-api.ts`, once nothing references them.

- [ ] **Step 6: Verify the duplicates are gone**

```bash
grep -rn "readAttachmentData\|readFileData\|mimeForKind" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```
Expected: no output.

- [ ] **Step 7: Run the gates**

```bash
npx vitest run src/app/attachment-ingest.test.ts src/app/chat-panel.test.tsx src/app/step0-import-panel.test.tsx src/app/chat-attachments.test.ts > /tmp/p1.log 2>&1; echo "EXIT=$?"
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src; echo "LINT_EXIT=$?"
```
Expected: `EXIT=0`, `TSC_EXIT=0`, `LINT_EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add src/app/attachment-ingest.ts src/app/attachment-ingest.test.ts src/app/chat-panel.tsx src/app/step0-import-panel.tsx src/app/chat-api.ts
git commit -m "refactor: one attachment pipeline for all three consumers"
```

**Phase 1 is shippable here.** HTML is fixed, the drift is closed, and the pipeline has one home.

---

## Phase 2 — Mail envelopes, recursion, budget

### Task 6: `chatAttachmentEncrypted` and the summary-line strings

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts` (node UTF-8 write only — see below)
- Test: `src/app/i18n-encoding.test.ts` runs automatically

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, immediately after `chatAttachmentReadFailed`:

```ts
  chatAttachmentEncrypted: "{0} is password-protected — save it without protection and try again",
  chatAttachmentSummaryOne: "{0} — 1 attachment",
  chatAttachmentSummaryMany: "{0} — {1} attachments",
  chatAttachmentSummarySkipped: "{0} — {1} attachments, {2} skipped",
```

- [ ] **Step 2: Add the DE keys**

★★★ Do NOT use Edit or Write on `i18n.de.ts` — the Edit tool corrupts umlauts and curls quotes there, and Write re-lines the whole CRLF file. Patch it with node:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const s = fs.readFileSync(p, "utf8");
const anchor = "  chatAttachmentReadFailed: \"{0} konnte nicht gelesen werden\",\r\n";
if (!s.includes(anchor)) { console.error("anchor missing"); process.exit(1); }
if (s.split(anchor).length !== 2) { console.error("anchor not unique"); process.exit(1); }
const add = anchor +
  "  chatAttachmentEncrypted: \"{0} ist kennwortgeschützt — speichere die Datei ohne Schutz und versuche es erneut\",\r\n" +
  "  chatAttachmentSummaryOne: \"{0} — 1 Anhang\",\r\n" +
  "  chatAttachmentSummaryMany: \"{0} — {1} Anhänge\",\r\n" +
  "  chatAttachmentSummarySkipped: \"{0} — {1} Anhänge, {2} übersprungen\",\r\n";
fs.writeFileSync(p, s.replace(anchor, add), "utf8");
console.log("ok");
'
```

- [ ] **Step 3: Rewire the encrypted error to its own string**

In `src/app/chat-panel.tsx`, `attachmentErrorText` currently folds `"encrypted"` into the generic
read-failure string (Task 5 left it that way deliberately, because the key did not exist yet). Add
the branch now:

```tsx
    if (err === "encrypted") return t(lang, "chatAttachmentEncrypted", name);
```

- [ ] **Step 4: Verify parity and encoding**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts; echo "EXIT=$?"
git ls-files --eol src/app/i18n.de.ts
```
Expected: `TSC_EXIT=0` (parity holds), encoding test passes, and the eol line still reads `i/lf w/crlf`. If it reads `w/lf`, the file was re-lined — revert and redo with node.

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/chat-panel.tsx
git commit -m "feat: add attachment encrypted and summary strings in EN and DE"
```

---

### Task 7: `mime-parse.ts`

**Files:**
- Create: `src/app/mime-parse.ts`
- Test: `src/app/mime-parse.test.ts`

`.eml` is text, so this task needs no binary handling at all.

- [ ] **Step 1: Write the failing test**

Create `src/app/mime-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseMimeMessage, MAX_MIME_DEPTH } from "./mime-parse";

const CRLF = "\r\n";
const msg = (lines: string[]) => lines.join(CRLF);

describe("parseMimeMessage", () => {
  it("reads headers and a plain body", () => {
    const m = parseMimeMessage(msg([
      "From: a@example.com", "To: b@example.com", "Subject: Hello",
      "Date: Wed, 03 Sep 2026 10:00:00 +0000", "", "Body text", "",
    ]));
    expect(m.headers.get("from")).toBe("a@example.com");
    expect(m.headers.get("subject")).toBe("Hello");
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].text).toContain("Body text");
  });

  it("unfolds a continued header", () => {
    const m = parseMimeMessage(msg(["Subject: one", " two", "", "b", ""]));
    expect(m.headers.get("subject")).toBe("one two");
  });

  it("decodes an RFC 2047 encoded-word subject", () => {
    const m = parseMimeMessage(msg(["Subject: =?utf-8?B?R3LDvMOfZQ==?=", "", "b", ""]));
    expect(m.headers.get("subject")).toBe("Grüße");
  });

  it("decodes quoted-printable", () => {
    const m = parseMimeMessage(msg([
      "Content-Type: text/plain", "Content-Transfer-Encoding: quoted-printable",
      "", "caf=C3=A9 s=", "oft", "",
    ]));
    expect(m.parts[0].text).toContain("café soft");
  });

  it("splits a multipart body and keeps each part's headers", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="BND"', "",
      "--BND", "Content-Type: text/plain", "", "hello",
      "--BND", "Content-Type: text/html", "", "<p>hi</p>",
      "--BND--", "",
    ]));
    expect(m.parts).toHaveLength(2);
    expect(m.parts[0].mimeType).toBe("text/plain");
    expect(m.parts[1].mimeType).toBe("text/html");
  });

  it("base64-decodes an attachment part and keeps its filename", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", 'Content-Type: text/csv; name="rows.csv"',
      'Content-Disposition: attachment; filename="rows.csv"',
      "Content-Transfer-Encoding: base64", "", "YSxiCjEsMg==",
      "--B--", "",
    ]));
    const att = m.parts.find((p) => p.fileName === "rows.csv");
    expect(att).toBeDefined();
    expect(new TextDecoder().decode(att!.bytes)).toBe("a,b\n1,2");
  });

  // ★★ SECURITY. An unterminated boundary must consume the remainder, never loop.
  it("does not loop on a missing closing boundary", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "", "--B",
      "Content-Type: text/plain", "", "orphan", "",
    ]));
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].text).toContain("orphan");
  });

  // ★★ SECURITY. Nesting is capped and the cap is disclosed.
  it("caps nesting depth and says so", () => {
    let body = "deepest";
    for (let i = 0; i < MAX_MIME_DEPTH + 3; i++) {
      body = msg([`Content-Type: multipart/mixed; boundary="B${i}"`, "", `--B${i}`, "", body, `--B${i}--`]);
    }
    const m = parseMimeMessage(body);
    expect(m.diagnostics.join(" ")).toContain("nesting");
  });

  // ★★ SECURITY. A header flood is capped rather than retained.
  it("caps the header count", () => {
    const flood = Array.from({ length: 5000 }, (_, i) => `X-N-${i}: v`);
    const m = parseMimeMessage(msg([...flood, "", "body", ""]));
    expect(m.headers.size).toBeLessThanOrEqual(512);
    expect(m.diagnostics.join(" ")).toContain("header");
  });

  it("never throws on malformed base64", () => {
    expect(() => parseMimeMessage(msg([
      "Content-Transfer-Encoding: base64", "", "!!!not base64!!!", "",
    ]))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/mime-parse.test.ts`
Expected: FAIL — cannot resolve `./mime-parse`.

- [ ] **Step 3: Implement**

Create `src/app/mime-parse.ts`:

```ts
// src/app/mime-parse.ts — RFC 5322 / 2045 parser for .eml, .mhtml and .mht.
//
// Pure and node-testable: text in, headers plus a flat part list out. No DOM,
// no fetch, no throwing — a malformed message yields partial results plus
// diagnostics, because a corrupt attachment must never lose the whole mail.

export const MAX_MIME_DEPTH = 10;
export const MAX_HEADERS = 512;
export const MAX_HEADER_BYTES = 64 * 1024;

export type MimePart = {
  mimeType: string;
  fileName: string | null;
  /** Decoded text, for a textual part. */
  text: string;
  /** Decoded bytes, for any part. */
  bytes: Uint8Array;
  /** True when the part is itself a message (message/rfc822). */
  isMessage: boolean;
};

export type MimeMessage = {
  headers: Map<string, string>;
  parts: MimePart[];
  diagnostics: string[];
};

function decodeBase64(s: string): Uint8Array {
  try {
    const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

function decodeQuotedPrintable(s: string): Uint8Array {
  const joined = s.replace(/=\r?\n/g, "");             // soft line breaks
  const out: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "=" && i + 2 < joined.length) {
      const hex = joined.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) { out.push(Number.parseInt(hex, 16)); i += 2; continue; }
    }
    out.push(joined.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

/** RFC 2047 encoded-words in a header value. */
export function decodeEncodedWords(v: string): string {
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, enc: string, data: string) => {
    try {
      const bytes = enc.toUpperCase() === "B"
        ? decodeBase64(data)
        : decodeQuotedPrintable(data.replace(/_/g, " "));
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      return whole;
    }
  });
}

function paramOf(headerValue: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|([^;\\s]+))`, "i");
  const m = re.exec(headerValue);
  return m ? (m[2] ?? m[3] ?? null) : null;
}

function splitHeaders(raw: string): { headers: Map<string, string>; body: string; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const sep = /\r?\n\r?\n/.exec(raw);
  const headerText = sep ? raw.slice(0, sep.index) : raw;
  const body = sep ? raw.slice(sep.index + sep[0].length) : "";
  const capped = headerText.length > MAX_HEADER_BYTES;
  if (capped) diagnostics.push("header block truncated at the size cap");
  const lines = (capped ? headerText.slice(0, MAX_HEADER_BYTES) : headerText).split(/\r?\n/);

  const headers = new Map<string, string>();
  let name = "", value = "";
  const commit = () => {
    if (name === "") return;
    if (headers.size >= MAX_HEADERS) return;
    headers.set(name.toLowerCase(), decodeEncodedWords(value.trim()));
  };
  for (const line of lines) {
    if (/^[ \t]/.test(line) && name !== "") { value += " " + line.trim(); continue; }
    commit();
    const colon = line.indexOf(":");
    if (colon <= 0) { name = ""; value = ""; continue; }
    name = line.slice(0, colon).trim();
    value = line.slice(colon + 1);
  }
  commit();
  if (headers.size >= MAX_HEADERS) diagnostics.push("header count capped");
  return { headers, body, diagnostics };
}

function decodePartBody(body: string, encoding: string, charset: string): { text: string; bytes: Uint8Array } {
  const enc = encoding.trim().toLowerCase();
  const bytes = enc === "base64" ? decodeBase64(body)
    : enc === "quoted-printable" ? decodeQuotedPrintable(body)
    : new TextEncoder().encode(body);
  let text = "";
  try {
    text = new TextDecoder(charset.toLowerCase() || "utf-8").decode(bytes);
  } catch {
    text = new TextDecoder().decode(bytes);
  }
  return { text, bytes };
}

function walk(raw: string, depth: number, out: MimePart[], diagnostics: string[]): void {
  if (depth > MAX_MIME_DEPTH) {
    diagnostics.push("multipart nesting exceeded the depth cap");
    return;
  }
  const { headers, body, diagnostics: hd } = splitHeaders(raw);
  diagnostics.push(...hd);
  const ctype = headers.get("content-type") ?? "text/plain";
  const mimeType = ctype.split(";")[0].trim().toLowerCase();
  const boundary = paramOf(ctype, "boundary");

  if (mimeType.startsWith("multipart/") && boundary) {
    const marker = `--${boundary}`;
    const chunks = body.split(marker);
    // chunks[0] is the preamble; a chunk starting with "--" is the terminator.
    let sawTerminator = false;
    for (const chunk of chunks.slice(1)) {
      if (chunk.startsWith("--")) { sawTerminator = true; break; }
      walk(chunk.replace(/^\r?\n/, ""), depth + 1, out, diagnostics);
    }
    if (!sawTerminator) diagnostics.push("multipart body had no closing boundary");
    return;
  }

  const disp = headers.get("content-disposition") ?? "";
  const fileName = paramOf(disp, "filename") ?? paramOf(ctype, "name");
  const { text, bytes } = decodePartBody(
    body,
    headers.get("content-transfer-encoding") ?? "",
    paramOf(ctype, "charset") ?? "utf-8",
  );
  out.push({
    mimeType,
    fileName: fileName ? decodeEncodedWords(fileName) : null,
    text,
    bytes,
    isMessage: mimeType === "message/rfc822",
  });
}

export function parseMimeMessage(raw: string): MimeMessage {
  const { headers, diagnostics } = splitHeaders(raw);
  const parts: MimePart[] = [];
  walk(raw, 0, parts, diagnostics);
  return { headers, parts, diagnostics };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/mime-parse.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Mutation-prove the three security guards**

- Change `if (depth > MAX_MIME_DEPTH)` to `if (false)`. Expected: the nesting test goes RED (and the run must not hang). Restore.
- Change `if (headers.size >= MAX_HEADERS) return;` to a no-op. Expected: the header-flood test goes RED. Restore.
- Delete the `if (chunk.startsWith("--")) { sawTerminator = true; break; }` line. Expected: the unterminated-boundary test goes RED. Restore.

Record `N failed / M passed` per mutant; each sum must be 10. After each, confirm `git diff --stat` is empty.

- [ ] **Step 6: Commit**

```bash
git add src/app/mime-parse.ts src/app/mime-parse.test.ts
git commit -m "feat: add a bounded RFC 5322 MIME parser"
```

---

### Task 8: `ParsedMail`, `eml-extract.ts`, and the Markdown renderer

**Files:**
- Create: `src/app/mail-extract.ts` (the `ParsedMail` type, the renderer, and the router)
- Create: `src/app/eml-extract.ts`
- Test: `src/app/eml-extract.test.ts`, `src/app/mail-extract.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/eml-extract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseMimeMessage } from "./mime-parse";
import { emlToParsedMail } from "./eml-extract";

const msg = (lines: string[]) => lines.join("\r\n");

describe("emlToParsedMail", () => {
  it("lifts headers into the normalised shape", () => {
    const p = emlToParsedMail(parseMimeMessage(msg([
      "From: a@example.com", "To: b@example.com, c@example.com", "Cc: d@example.com",
      "Subject: Q3 plan", "Date: Wed, 03 Sep 2026 10:00:00 +0000", "", "hi", "",
    ])));
    expect(p.headers.from).toBe("a@example.com");
    expect(p.headers.to).toEqual(["b@example.com", "c@example.com"]);
    expect(p.headers.cc).toEqual(["d@example.com"]);
    expect(p.headers.subject).toBe("Q3 plan");
    expect(p.headers.date).toMatch(/^2026-09-03T/);
  });

  it("prefers the html body and marks its kind", () => {
    const p = emlToParsedMail(parseMimeMessage(msg([
      'Content-Type: multipart/alternative; boundary="B"', "",
      "--B", "Content-Type: text/plain", "", "plain version",
      "--B", "Content-Type: text/html", "", "<p>html version</p>",
      "--B--", "",
    ])));
    expect(p.body.kind).toBe("html");
    expect(p.body.content).toContain("html version");
  });

  it("falls back to the plain body when there is no html part", () => {
    const p = emlToParsedMail(parseMimeMessage(msg([
      "Content-Type: text/plain", "", "just plain", "",
    ])));
    expect(p.body.kind).toBe("text");
    expect(p.body.content).toContain("just plain");
  });

  it("collects attachments with bytes, name and mime type", () => {
    const p = emlToParsedMail(parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", "Content-Type: text/plain", "", "body",
      "--B", 'Content-Type: text/csv; name="rows.csv"',
      'Content-Disposition: attachment; filename="rows.csv"',
      "Content-Transfer-Encoding: base64", "", "YSxi",
      "--B--", "",
    ])));
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0].fileName).toBe("rows.csv");
    expect(p.attachments[0].mimeType).toBe("text/csv");
    expect(new TextDecoder().decode(p.attachments[0].bytes)).toBe("a,b");
  });

  it("leaves the date empty rather than inventing one when unparseable", () => {
    const p = emlToParsedMail(parseMimeMessage(msg(["Date: not a date", "", "b", ""])));
    expect(p.headers.date).toBe("");
  });
});
```

Create `src/app/mail-extract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderMailMarkdown, type ParsedMail } from "./mail-extract";

const base: ParsedMail = {
  headers: { from: "a@x.com", to: ["b@x.com"], cc: [], subject: "Subj", date: "2026-09-03T10:00:00.000Z" },
  body: { kind: "text", content: "Body text" },
  attachments: [],
  diagnostics: [],
};

describe("renderMailMarkdown", () => {
  it("puts the headers above the body", () => {
    const md = renderMailMarkdown(base, 100_000);
    expect(md).toContain("**From:** a@x.com");
    expect(md).toContain("**Subject:** Subj");
    expect(md.indexOf("**Subject:**")).toBeLessThan(md.indexOf("Body text"));
  });

  it("names each attachment so the model knows what it is about to see", () => {
    const md = renderMailMarkdown({ ...base, attachments: [
      { fileName: "a.xlsx", mimeType: "application/vnd.ms-excel", bytes: new Uint8Array(3) },
    ] }, 100_000);
    expect(md).toContain("a.xlsx");
  });

  // ★★★ DISCLOSURE. A silent truncation makes the model report confidently on
  //  data it never saw. Every cut says so.
  it("discloses a truncated body rather than cutting silently", () => {
    const md = renderMailMarkdown({ ...base, body: { kind: "text", content: "x".repeat(5000) } }, 500);
    expect(md).toContain("_(truncated");
    expect(md.length).toBeLessThan(1200);
  });

  it("carries parser diagnostics into the output", () => {
    const md = renderMailMarkdown({ ...base, diagnostics: ["multipart body had no closing boundary"] }, 100_000);
    expect(md).toContain("no closing boundary");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/app/eml-extract.test.ts src/app/mail-extract.test.ts
```
Expected: FAIL — cannot resolve the modules.

- [ ] **Step 3: Implement `mail-extract.ts`**

Create `src/app/mail-extract.ts`:

```ts
// src/app/mail-extract.ts — the normalised mail type, its Markdown renderer,
// and the .eml/.msg router.
//
// ★★★ THIS MODULE MUST NOT IMPORT attachment-ingest.ts. The recursion is
// INVERTED on purpose: this returns attachment BYTES, raw and unprocessed, and
// the orchestrator drives the tree walk. Calling back the other way creates an
// import cycle and makes every parser impure and untestable in isolation.

export type ParsedMail = {
  headers: {
    from: string;
    to: readonly string[];
    cc: readonly string[];
    subject: string;
    /** ISO 8601, or "" when unparseable — never a fabricated date. */
    date: string;
  };
  body: { kind: "html" | "text" | "rtf-degraded"; content: string };
  attachments: readonly { fileName: string; mimeType: string; bytes: Uint8Array }[];
  diagnostics: readonly string[];
};

/** Minimum body characters a mail keeps even under budget pressure, so a long
 *  thread can never starve its own attachments and vice versa. */
export const MAIL_BODY_FLOOR = 20_000;

export function renderMailMarkdown(mail: ParsedMail, bodyBudget: number): string {
  const h = mail.headers;
  const lines: string[] = [];
  if (h.subject) lines.push(`**Subject:** ${h.subject}`);
  if (h.from) lines.push(`**From:** ${h.from}`);
  if (h.to.length > 0) lines.push(`**To:** ${h.to.join(", ")}`);
  if (h.cc.length > 0) lines.push(`**Cc:** ${h.cc.join(", ")}`);
  if (h.date) lines.push(`**Date:** ${h.date}`);

  if (mail.attachments.length > 0) {
    lines.push("");
    lines.push(`**Attachments (${mail.attachments.length}):**`);
    for (const a of mail.attachments) lines.push(`- ${a.fileName} (${a.mimeType})`);
  }

  let body = mail.body.content;
  if (body.length > bodyBudget) {
    body = `${body.slice(0, bodyBudget)}\n\n_(truncated - mail body exceeded its share of the extraction budget)_`;
  }
  if (mail.body.kind === "rtf-degraded") {
    lines.push("");
    lines.push("_(formatting could not be recovered from this message; plain text follows)_");
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(body);
  for (const d of mail.diagnostics) lines.push(`\n_(${d})_`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Implement `eml-extract.ts`**

Create `src/app/eml-extract.ts`:

```ts
// src/app/eml-extract.ts — MimeMessage -> ParsedMail. Pure, value to value.

import { extractHtmlMarkdown } from "./html-extract";
import type { MimeMessage } from "./mime-parse";
import type { ParsedMail } from "./mail-extract";

function addressList(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

function isoDate(v: string | undefined): string {
  if (!v) return "";
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

export function emlToParsedMail(m: MimeMessage): ParsedMail {
  const html = m.parts.find((p) => p.mimeType === "text/html" && !p.fileName);
  const plain = m.parts.find((p) => p.mimeType === "text/plain" && !p.fileName);
  const body = html
    ? { kind: "html" as const, content: extractHtmlMarkdown(html.text) }
    : { kind: "text" as const, content: plain?.text ?? "" };

  const attachments = m.parts
    .filter((p) => p.fileName !== null || p.isMessage)
    .map((p) => ({
      fileName: p.fileName ?? "attached-message.eml",
      mimeType: p.isMessage ? "message/rfc822" : p.mimeType,
      bytes: p.bytes,
    }));

  return {
    headers: {
      from: m.headers.get("from") ?? "",
      to: addressList(m.headers.get("to")),
      cc: addressList(m.headers.get("cc")),
      subject: m.headers.get("subject") ?? "",
      date: isoDate(m.headers.get("date")),
    },
    body,
    attachments,
    diagnostics: m.diagnostics,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/app/eml-extract.test.ts src/app/mail-extract.test.ts
```
Expected: PASS, 9 tests total.

- [ ] **Step 6: Commit**

```bash
git add src/app/mail-extract.ts src/app/eml-extract.ts src/app/eml-extract.test.ts src/app/mail-extract.test.ts
git commit -m "feat: normalise mail into one ParsedMail type with a shared renderer"
```

---

### Task 9: Classify `.eml` and `.mhtml`

**Files:**
- Modify: `src/app/chat-attachments.ts`
- Test: `src/app/chat-attachments.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/chat-attachments.test.ts`:

```ts
describe("mail classification", () => {
  it("classifies eml, mhtml and mht as mail", () => {
    expect(classifyAttachment("message/rfc822", "a.eml")).toBe("mail");
    expect(classifyAttachment("application/octet-stream", "a.eml")).toBe("mail");
    expect(classifyAttachment("application/octet-stream", "page.mhtml")).toBe("mail");
    expect(classifyAttachment("multipart/related", "page.mht")).toBe("mail");
  });

  it("offers the mail extensions in the shared accept list", () => {
    const tokens = ATTACHMENT_ACCEPT.split(",");
    for (const ext of [".eml", ".mhtml", ".mht"]) expect(tokens).toContain(ext);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/chat-attachments.test.ts`
Expected: FAIL — received `null`.

- [ ] **Step 3: Implement**

In `src/app/chat-attachments.ts` add the set and export it, then include it in `ATTACHMENT_ACCEPT`:

```ts
export const MAIL_EXTENSIONS = new Set([".eml", ".mhtml", ".mht"]);
```

Add `...MAIL_EXTENSIONS` to the `ATTACHMENT_ACCEPT` array and `"message/rfc822"` to `ACCEPT_MIMES`.

In `classifyAttachment`, add a MIME branch above the text branch and an extension branch beside the others:

```ts
  if (mime === "message/rfc822" || mime === "multipart/related") return "mail";
```
```ts
  if (ext !== "" && MAIL_EXTENSIONS.has(ext)) return "mail";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/chat-attachments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-attachments.ts src/app/chat-attachments.test.ts
git commit -m "feat: classify eml, mhtml and mht as mail"
```

---

### Task 10: Recursion and the shared budget

**Files:**
- Modify: `src/app/attachment-ingest.ts`
- Modify: `src/app/mail-extract.ts` (add the router `parseMail`)
- Test: `src/app/attachment-ingest.test.ts`

This is the risk core of the whole track, and it needs no parser and no fixture — the budget is arithmetic over a tree.

- [ ] **Step 1: Write the failing test**

Append to `src/app/attachment-ingest.test.ts`:

```ts
import { MAX_INGEST_DEPTH, MAX_INGEST_NODES, MAX_TREE_EXTRACT_CHARS } from "./attachment-ingest";

const CRLF = "\r\n";
const mail = (lines: string[]) => new TextEncoder().encode(lines.join(CRLF));
const b64 = (s: string) => btoa(s);

/** An .eml carrying N text attachments of the given size. */
function mailWith(atts: { name: string; body: string }[], bodyText = "mail body"): Uint8Array {
  const parts = atts.flatMap((a) => [
    "--B", `Content-Type: text/plain; name="${a.name}"`,
    `Content-Disposition: attachment; filename="${a.name}"`,
    "Content-Transfer-Encoding: base64", "", b64(a.body),
  ]);
  return mail([
    'Content-Type: multipart/mixed; boundary="B"', "Subject: Test", "",
    "--B", "Content-Type: text/plain", "", bodyText, ...parts, "--B--", "",
  ]);
}

describe("mail recursion", () => {
  it("ingests a mail and its attachments as a tree", async () => {
    const r = await ingestBytes(mailWith([{ name: "a.txt", body: "alpha" }]), "message/rfc822", "m.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.kind).toBe("mail");
    expect(r.node.children).toHaveLength(1);
    expect(r.node.children[0].fileName).toBe("a.txt");
    const src = r.node.children[0].block.source as { data: string };
    expect(src.data).toBe("alpha");
  });

  // ★★★ BREADTH-FIRST. Depth-first lets the first attached mail's whole subtree
  //  eat the budget before a sibling attachment is even seen. This asserts every
  //  DIRECT attachment is reached before any nested one.
  it("reaches every direct attachment before any nested one", async () => {
    const inner = mailWith([{ name: "deep.txt", body: "deep" }], "inner body");
    const outer = mail([
      'Content-Type: multipart/mixed; boundary="B"', "Subject: Outer", "",
      "--B", "Content-Type: text/plain", "", "outer body",
      "--B", 'Content-Type: message/rfc822; name="inner.eml"',
      'Content-Disposition: attachment; filename="inner.eml"', "", new TextDecoder().decode(inner),
      "--B", 'Content-Type: text/plain; name="sibling.txt"',
      'Content-Disposition: attachment; filename="sibling.txt"', "", "sibling",
      "--B--", "",
    ]);
    const r = await ingestBytes(outer, "message/rfc822", "outer.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.children.map((c) => c.fileName)).toEqual(["inner.eml", "sibling.txt"]);
  });

  // ★★ SECURITY + DISCLOSURE.
  it("stops at the depth cap and discloses it", async () => {
    let cur = mailWith([{ name: "leaf.txt", body: "leaf" }]);
    for (let i = 0; i < MAX_INGEST_DEPTH + 2; i++) {
      cur = mail([
        'Content-Type: multipart/mixed; boundary="B"', `Subject: L${i}`, "",
        "--B", "Content-Type: text/plain", "", "body",
        "--B", 'Content-Type: message/rfc822; name="n.eml"',
        'Content-Disposition: attachment; filename="n.eml"', "", new TextDecoder().decode(cur),
        "--B--", "",
      ]);
    }
    const r = await ingestBytes(cur, "message/rfc822", "deep.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const all = JSON.stringify(r.node);
    expect(all).toContain("nesting depth limit");
  });

  it("stops at the node cap and discloses it", async () => {
    const atts = Array.from({ length: MAX_INGEST_NODES + 10 }, (_, i) => ({ name: `f${i}.txt`, body: "x" }));
    const r = await ingestBytes(mailWith(atts), "message/rfc822", "many.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.children.length).toBeLessThanOrEqual(MAX_INGEST_NODES);
    expect(JSON.stringify(r.node)).toContain("omitted");
  });

  it("shares one output budget across the whole tree", async () => {
    const big = "y".repeat(300_000);
    const r = await ingestBytes(
      mailWith([{ name: "a.txt", body: big }, { name: "b.txt", body: big }, { name: "c.txt", body: big }]),
      "message/rfc822", "big.eml",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const total = JSON.stringify(r.node).length;
    expect(total).toBeLessThan(MAX_TREE_EXTRACT_CHARS * 1.2);
  });

  it("keeps the body floor even when attachments are large", async () => {
    const big = "y".repeat(300_000);
    const r = await ingestBytes(
      mailWith([{ name: "a.txt", body: big }], "IMPORTANT BODY MARKER"),
      "message/rfc822", "b.eml",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const src = r.node.block.source as { data: string };
    expect(src.data).toContain("IMPORTANT BODY MARKER");
  });

  it("keeps the mail when one attachment is corrupt", async () => {
    const r = await ingestBytes(
      mailWith([{ name: "ok.txt", body: "fine" }, { name: "bad.thing", body: "??" }]),
      "message/rfc822", "m.eml",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.children.some((c) => c.fileName === "ok.txt")).toBe(true);
    expect(JSON.stringify(r.node)).toContain("bad.thing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/attachment-ingest.test.ts`
Expected: FAIL — `MAX_INGEST_DEPTH` is not exported.

- [ ] **Step 3: Add the router to `mail-extract.ts`**

Append to `src/app/mail-extract.ts`:

```ts
import { parseMimeMessage } from "./mime-parse";
import { emlToParsedMail } from "./eml-extract";

/** Detect a `.msg` compound file by its MS-CFB signature. Task 14 adds the
 *  msg branch; until then such a file reports an unsupported-format
 *  diagnostic rather than being silently parsed as MIME. */
const CFBF_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function looksLikeCfbf(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && CFBF_SIGNATURE.every((v, i) => bytes[i] === v);
}

export function parseMail(bytes: Uint8Array): ParsedMail {
  if (looksLikeCfbf(bytes)) {
    return {
      headers: { from: "", to: [], cc: [], subject: "", date: "" },
      body: { kind: "text", content: "" },
      attachments: [],
      diagnostics: ["Outlook .msg support is not enabled in this build"],
    };
  }
  return emlToParsedMail(parseMimeMessage(new TextDecoder().decode(bytes)));
}
```

- [ ] **Step 4: Implement the walk in `attachment-ingest.ts`**

Add the constants and replace `ingestBytes` with a budget-aware version:

```ts
import { parseMail, renderMailMarkdown, MAIL_BODY_FLOOR } from "./mail-extract";

/** No single node may monopolise the tree. */
export const MAX_NODE_EXTRACT_CHARS = 200_000;
/** Total model-facing output across the whole tree (~100k tokens). */
export const MAX_TREE_EXTRACT_CHARS = 400_000;
/** mail -> attached mail -> attached mail. */
export const MAX_INGEST_DEPTH = 3;
/** 200 attachments is an attack or a mistake. */
export const MAX_INGEST_NODES = 50;
/** Cumulative decoded input across the tree. */
export const MAX_DECODED_BYTES = 64 * 1024 * 1024;

type Budget = {
  charsRemaining: number;
  bytesRemaining: number;
  nodesRemaining: number;
};

function newBudget(): Budget {
  return {
    charsRemaining: MAX_TREE_EXTRACT_CHARS,
    bytesRemaining: MAX_DECODED_BYTES,
    nodesRemaining: MAX_INGEST_NODES,
  };
}

function cap(text: string, limit: number, budget: Budget): string {
  const room = Math.min(limit, MAX_NODE_EXTRACT_CHARS, budget.charsRemaining);
  if (text.length <= room) { budget.charsRemaining -= text.length; return text; }
  budget.charsRemaining -= room;
  return `${text.slice(0, room)}\n\n_(truncated - exceeded the extraction budget)_`;
}

async function ingestNode(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
  depth: number,
  budget: Budget,
): Promise<IngestResult> {
  const sizeErr = checkAttachmentSize(bytes.byteLength);
  if (sizeErr) return { ok: false, error: sizeErr };
  if (bytes.byteLength > budget.bytesRemaining) return { ok: false, error: "too-large" };
  budget.bytesRemaining -= bytes.byteLength;

  const kind = classifyAttachment(mimeType, fileName);
  if (!kind) return { ok: false, error: "unsupported-type" };

  if (kind !== "mail") {
    try {
      const raw = await payloadFor(kind, bytes, mimeType, fileName);
      // Base64 payloads are opaque bytes for the model, not extracted text, so
      // they are charged against the byte budget above and not the char budget.
      const data = kind === "pdf" || kind === "image" ? raw : cap(raw, MAX_NODE_EXTRACT_CHARS, budget);
      return {
        ok: true,
        node: { fileName, kind, block: buildAttachmentBlock(kind, mimeType, data), children: [] },
      };
    } catch {
      return { ok: false, error: "read-failed" };
    }
  }

  // --- mail: render the body, then walk the attachments BREADTH-FIRST ---
  const mail = parseMail(bytes);
  const notes: string[] = [...mail.diagnostics];

  if (depth >= MAX_INGEST_DEPTH) {
    notes.push(`attachment "${fileName}" skipped - nesting depth limit`);
    const md = renderMailMarkdown({ ...mail, attachments: [], diagnostics: notes }, MAIL_BODY_FLOOR);
    return {
      ok: true,
      node: { fileName, kind, block: buildAttachmentBlock(kind, mimeType, cap(md, MAX_NODE_EXTRACT_CHARS, budget)), children: [] },
    };
  }

  const admitted = mail.attachments.slice(0, Math.max(0, budget.nodesRemaining));
  if (admitted.length < mail.attachments.length) {
    notes.push(`${mail.attachments.length - admitted.length} of ${mail.attachments.length} attachments omitted - node limit`);
  }
  budget.nodesRemaining -= admitted.length;

  // The body reserves its floor first, so a long thread can never starve its
  // own attachments and a big attachment can never erase the thread.
  const bodyShare = Math.min(MAIL_BODY_FLOOR, budget.charsRemaining);
  const md = renderMailMarkdown({ ...mail, diagnostics: notes }, bodyShare);
  const block = buildAttachmentBlock(kind, mimeType, cap(md, MAX_NODE_EXTRACT_CHARS, budget));

  const children: IngestNode[] = [];
  let left = admitted.length;
  for (const a of admitted) {
    // Equal shares of what remains, with unused share flowing to later siblings.
    const share = left > 0 ? Math.floor(budget.charsRemaining / left) : 0;
    left -= 1;
    const child = await ingestNode(a.bytes, a.mimeType, a.fileName, depth + 1, {
      ...budget,
      charsRemaining: Math.min(share, budget.charsRemaining),
    });
    if (child.ok) {
      children.push(child.node);
      budget.charsRemaining -= JSON.stringify(child.node.block).length;
    } else {
      notes.push(`attachment "${a.fileName}" skipped - ${child.error}`);
    }
  }
  // Re-render so late diagnostics (a skipped child) reach the model.
  const finalMd = renderMailMarkdown({ ...mail, diagnostics: notes }, bodyShare);
  return {
    ok: true,
    node: { fileName, kind, block: buildAttachmentBlock(kind, mimeType, finalMd), children },
  };
}

export async function ingestBytes(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<IngestResult> {
  return ingestNode(bytes, mimeType, fileName, 0, newBudget());
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/attachment-ingest.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Mutation-prove the four budget guards**

- Change `if (depth >= MAX_INGEST_DEPTH)` to `if (false)`. Expected: the depth test goes RED and the run must not hang. Restore.
- Change `.slice(0, Math.max(0, budget.nodesRemaining))` to `.slice()`. Expected: the node-cap test goes RED. Restore.
- Change `bodyShare` to `0`. Expected: the body-floor test goes RED. Restore.
- Change the loop to recurse depth-first before collecting siblings. Expected: the breadth-first test goes RED. Restore.

Record `N failed / M passed` per mutant; each sum must be 13.

- [ ] **Step 7: Commit**

```bash
git add src/app/attachment-ingest.ts src/app/mail-extract.ts src/app/attachment-ingest.test.ts
git commit -m "feat: walk mail attachments breadth-first under one shared budget"
```

---

### Task 11: The per-attachment summary line

**Files:**
- Modify: `src/app/chat-panel.tsx`
- Test: `src/app/chat-panel.test.tsx`

Required, not optional: it is the user's only window onto a tree they cannot otherwise inspect. Per `no-handroll-use-primitives`, build it from shared primitives.

- [ ] **Step 1: Write the failing test**

Append to `src/app/chat-panel.test.tsx`, inside its top-level describe:

```tsx
  it("summarises a mail attachment's children so the user can see the tree", async () => {
    renderPanel();
    const eml = new File(
      [[
        'Content-Type: multipart/mixed; boundary="B"', "Subject: S", "",
        "--B", "Content-Type: text/plain", "", "body",
        "--B", 'Content-Type: text/plain; name="a.txt"',
        'Content-Disposition: attachment; filename="a.txt"', "", "alpha",
        "--B--", "",
      ].join("\r\n")],
      "m.eml",
      { type: "message/rfc822" },
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, eml);
    expect(await screen.findByText(/m\.eml/)).toBeInTheDocument();
    expect(await screen.findByText(/1 attachment/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/chat-panel.test.tsx`
Expected: FAIL — no element matching `/1 attachment/i`.

- [ ] **Step 3: Implement**

Extend `StagedAttachment` in `src/app/chat-panel.tsx` with a summary:

```tsx
type StagedAttachment = {
  id: string;
  name: string;
  block: AttachmentBlock;
  /** Non-error disclosure: what the tree under this file contained. */
  summary: string | null;
};
```

Build it when staging:

```tsx
      const kids = result.node.children.length;
      const skipped = countSkipped(result.node);
      const summary =
        kids === 0 ? null
        : skipped > 0 ? t(lang, "chatAttachmentSummarySkipped", file.name, String(kids), String(skipped))
        : kids === 1 ? t(lang, "chatAttachmentSummaryOne", file.name)
        : t(lang, "chatAttachmentSummaryMany", file.name, String(kids));
      staged.push({ id: `att-${(attachSeqRef.current += 1)}`, name: file.name, block: result.node.block, summary });
```

Add the helper beside `attachmentErrorText`:

```tsx
  /** Count the "skipped" disclosures the ingest walk wrote into the rendered
   *  Markdown. The orchestrator discloses to the MODEL; this surfaces the same
   *  fact to the USER without calling a partially-read mail a failure. */
  function countSkipped(node: IngestNode): number {
    const src = node.block.source as { data?: string };
    return (src.data?.match(/skipped -/g) ?? []).length;
  }
```

Render it under the existing attachment chip, using the same muted text style the panel already uses for secondary lines:

```tsx
          {att.summary && (
            <span className="block text-xs text-muted-foreground">{att.summary}</span>
          )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/chat-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-panel.tsx src/app/chat-panel.test.tsx
git commit -m "feat: show what a mail attachment actually contained"
```

**Phase 2 is shippable here.**

---

## Phase 3 — `.msg`

### Task 12: `cfbf.ts` — the compound file reader

**Files:**
- Create: `src/app/cfbf.ts`
- Test: `src/app/cfbf.test.ts`
- Create: `src/app/__fixtures__/cfbf-writer.ts` (test-only synthetic writer)

★★★ **Measured against two real files, so build to these facts, not to the spec's original guesses:** DIFAT chain walking is mandatory (a 17.8 MB mail needed two chained DIFAT sectors, and a header-only reader returns an EMPTY DIRECTORY rather than an error); and properties must be resolved by **storage path**, because duplicate stream names across storages are normal and a flattened reader misattributes them.

- [ ] **Step 1: Write the synthetic writer**

Create `src/app/__fixtures__/cfbf-writer.ts`. It must be able to emit a **malformed** file on request, which is the whole point — the guard cases cannot be found in the wild.

```ts
// Test-only minimal MS-CFB writer. Emits 512-byte-sector compound files, and
// deliberately malformed ones for the guard tests. Layout is [FAT][directory]
// [streams]; every stream is written above the 4096 mini-stream cutoff, so the
// mini path is exercised only by the real inlined file in Task 16.
//
// VERIFIED: this exact layout round-trips through a reference reader — a simple
// stream yields 1 reachable entry, two same-named streams in two storages yield
// 4 and resolve to distinct paths, and each defect flag reproduces its hostile
// condition. illegalSectorShift crashes an UNGUARDED reader with
// ERR_BUFFER_OUT_OF_BOUNDS, which is why cfbf.ts rejects the shift outright.

const SEC = 512;
const FREE = 0xffffffff;
const EOC = 0xfffffffe;
const FATSECT = 0xfffffffd;
const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export type CfbfEntryInput = { name: string; data?: Uint8Array; children?: CfbfEntryInput[] };
export type CfbfDefects = {
  cyclicFat?: boolean;
  cyclicDirTree?: boolean;
  hugeStreamSize?: boolean;
  illegalSectorShift?: boolean;
  chainPastEnd?: boolean;
};

type Entry = {
  name: string; type: number; data: Uint8Array | null;
  left: number; right: number; child: number; start: number; size: number;
};

export function buildCfbf(root: CfbfEntryInput[], defects: CfbfDefects = {}): Uint8Array {
  // --- 1. flatten into directory entries; index 0 is the Root Entry ---
  const E: Entry[] = [{
    name: "Root Entry", type: 5, data: null,
    left: FREE, right: FREE, child: FREE, start: EOC, size: 0,
  }];
  const addAll = (items: CfbfEntryInput[] | undefined): number => {
    if (!items || items.length === 0) return FREE;
    const idxs: number[] = [];
    for (const it of items) {
      idxs.push(E.length);
      E.push({
        name: it.name, type: it.data ? 2 : 1, data: it.data ?? null,
        left: FREE, right: FREE, child: FREE, start: EOC, size: it.data ? it.data.length : 0,
      });
    }
    // Recurse only after every sibling is pushed, so the captured indices stay valid.
    items.forEach((it, i) => { if (it.children) E[idxs[i]].child = addAll(it.children); });
    for (let i = 0; i < idxs.length - 1; i++) E[idxs[i]].right = idxs[i + 1];
    return idxs[0];
  };
  E[0].child = addAll(root);
  if (defects.cyclicDirTree && E.length > 1) E[E.length - 1].child = 1;

  // --- 2. allocate sectors: [FAT][directory][streams] ---
  const nDir = Math.ceil(E.length / 4);
  const streamSecs = E.map((e) => (e.data ? Math.ceil(e.data.length / SEC) : 0));
  const totalStream = streamSecs.reduce((a, b) => a + b, 0);
  let nFat = 1;
  for (let i = 0; i < 8; i++) {
    const need = Math.max(1, Math.ceil((nFat + nDir + totalStream) / (SEC / 4)));
    if (need === nFat) break;
    nFat = need;
  }
  const totalSectors = nFat + nDir + totalStream;
  const fat = new Array<number>(totalSectors).fill(FREE);
  for (let i = 0; i < nFat; i++) fat[i] = FATSECT;

  const dirStart = nFat;
  for (let i = 0; i < nDir; i++) fat[dirStart + i] = i === nDir - 1 ? EOC : dirStart + i + 1;

  let cursor = nFat + nDir;
  E.forEach((e, i) => {
    if (!e.data) return;
    e.start = cursor;
    for (let k = 0; k < streamSecs[i]; k++) {
      fat[cursor + k] = k === streamSecs[i] - 1 ? EOC : cursor + k + 1;
    }
    cursor += streamSecs[i];
  });

  const firstStream = E.find((e) => e.data);
  if (defects.cyclicFat && firstStream) fat[firstStream.start] = firstStream.start;
  if (defects.chainPastEnd && firstStream) fat[firstStream.start] = totalSectors + 500;

  // --- 3. serialise ---
  const buf = new Uint8Array((totalSectors + 1) * SEC);
  const dv = new DataView(buf.buffer);
  buf.set(SIG, 0);
  dv.setUint16(0x18, 0x003e, true);
  dv.setUint16(0x1a, 3, true);
  dv.setUint16(0x1c, 0xfffe, true);
  dv.setUint16(0x1e, defects.illegalSectorShift ? 7 : 9, true);
  dv.setUint16(0x20, 6, true);
  dv.setUint32(0x2c, nFat, true);
  dv.setUint32(0x30, dirStart, true);
  dv.setUint32(0x38, 4096, true);
  dv.setUint32(0x3c, EOC, true);
  dv.setUint32(0x40, 0, true);
  dv.setUint32(0x44, EOC, true);
  dv.setUint32(0x48, 0, true);
  for (let i = 0; i < 109; i++) dv.setUint32(0x4c + i * 4, i < nFat ? i : FREE, true);

  const off = (sector: number) => (sector + 1) * SEC;
  for (let i = 0; i < nFat; i++) {
    for (let j = 0; j < SEC / 4; j++) {
      const idx = i * (SEC / 4) + j;
      dv.setUint32(off(i) + j * 4, idx < fat.length ? fat[idx] : FREE, true);
    }
  }

  E.forEach((e, i) => {
    const p = off(dirStart + Math.floor(i / 4)) + (i % 4) * 128;
    const nm = Buffer.from(`${e.name}\0`, "utf16le");
    buf.set(nm.subarray(0, Math.min(64, nm.length)), p);
    dv.setUint16(p + 64, Math.min(64, nm.length), true);
    buf[p + 66] = e.type;
    buf[p + 67] = 1;
    dv.setUint32(p + 68, e.left, true);
    dv.setUint32(p + 72, e.right, true);
    dv.setUint32(p + 76, e.child, true);
    dv.setUint32(p + 116, e.start, true);
    dv.setUint32(p + 120, defects.hugeStreamSize && e.data ? 0xffffff00 : e.size, true);
    dv.setUint32(p + 124, 0, true);
  });

  E.forEach((e) => { if (e.data) buf.set(e.data, off(e.start)); });
  return buf;
}
```

This writer is verified: it round-trips through a reference reader and each defect flag
reproduces its hostile condition. Copy it as-is.

- [ ] **Step 2: Write the failing test**

Create `src/app/cfbf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readCfbfStreams, readCfbfTree } from "./cfbf";
import { buildCfbf } from "./__fixtures__/cfbf-writer";

const enc = (s: string) => new TextEncoder().encode(s.padEnd(5000, " "));

describe("readCfbfStreams", () => {
  it("round-trips named streams", () => {
    const streams = readCfbfStreams(buildCfbf([{ name: "Alpha", data: enc("one") }]));
    expect(streams.has("Alpha")).toBe(true);
    expect(new TextDecoder().decode(streams.get("Alpha")!).trim()).toBe("one");
  });

  // ★★★ THE MEASURED DEFECT. Duplicate names across storages are normal in a
  //  real .msg — a probe that flattened the tree attributed a
  //  __nameid_version1.0 stream to the message body and reported a body that
  //  did not exist. Paths, never bare names.
  it("distinguishes same-named streams in different storages", () => {
    const tree = readCfbfTree(buildCfbf([
      { name: "S1", children: [{ name: "Dup", data: enc("in-s1") }] },
      { name: "S2", children: [{ name: "Dup", data: enc("in-s2") }] },
    ]));
    expect(tree.get("S1/Dup")).toBeDefined();
    expect(tree.get("S2/Dup")).toBeDefined();
    expect(new TextDecoder().decode(tree.get("S1/Dup")!).trim()).toBe("in-s1");
  });
});

describe("cfbf guards", () => {
  it("aborts a cyclic FAT chain instead of hanging", () => {
    expect(() => readCfbfStreams(buildCfbf([{ name: "A", data: enc("x") }], { cyclicFat: true }))).not.toThrow();
  });

  it("aborts a cyclic directory tree", () => {
    expect(() => readCfbfTree(buildCfbf([{ name: "A", data: enc("x") }], { cyclicDirTree: true }))).not.toThrow();
  });

  it("clamps an absurd declared stream size rather than allocating it", () => {
    const streams = readCfbfStreams(buildCfbf([{ name: "A", data: enc("x") }], { hugeStreamSize: true }));
    const a = streams.get("A");
    expect(a === undefined || a.length < 1_000_000).toBe(true);
  });

  it("rejects an illegal sector shift", () => {
    expect(readCfbfStreams(buildCfbf([{ name: "A", data: enc("x") }], { illegalSectorShift: true })).size).toBe(0);
  });

  it("stops a chain that runs past the end of the file", () => {
    expect(() => readCfbfStreams(buildCfbf([{ name: "A", data: enc("x") }], { chainPastEnd: true }))).not.toThrow();
  });

  it("returns an empty map for a non-CFBF file rather than guessing", () => {
    expect(readCfbfStreams(new TextEncoder().encode("not a compound file")).size).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/cfbf.test.ts`
Expected: FAIL — cannot resolve `./cfbf`.

- [ ] **Step 4: Implement**

Create `src/app/cfbf.ts`. A working reference implementation with the correct DIFAT and tree logic is in the session scratchpad at `cfbf-tree.mjs`; port it and **add every guard below**, which the scratchpad version does not have.

```ts
// src/app/cfbf.ts — MS-CFB (Compound File Binary) reader.
//
// ★★★ DIFAT CHAIN WALKING IS MANDATORY, NOT AN OPTIMISATION. The header holds
// only the first 109 FAT-sector pointers, covering ~7.1 MB at a 512-byte sector.
// Beyond that the DIFAT continues in chained sectors. A reader that stops at the
// header returns an EMPTY DIRECTORY rather than an error — measured on a real
// 17.8 MB Outlook mail, which needed two chained DIFAT sectors.
//
// ★★★ CALLERS MUST ADDRESS BY PATH, NOT BY NAME. Duplicate stream names across
// storages are normal in .msg. Flattening the tree misattributes a sub-storage
// property to the message — measured, and it produced a body that did not exist.
//
// Hostile input: this is a filesystem format. Every chain walk carries a
// visited-set, every declared size is clamped before allocation, and the reader
// returns partial results rather than throwing.

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const MAXREGSECT = 0xfffffffa;
const FREESECT = 0xffffffff;
/** Hard ceiling on any one stream, whatever the directory entry claims. */
export const MAX_CFBF_STREAM_BYTES = 64 * 1024 * 1024;

export type CfbfEntry = {
  path: string;
  name: string;
  type: "storage" | "stream" | "root";
  size: number;
};

type Ctx = {
  b: Uint8Array;
  dv: DataView;
  sec: number;
  mini: number;
  cutoff: number;
  fat: number[];
  miniFat: number[];
  miniSectors: number[];
  entries: RawEntry[];
};

type RawEntry = {
  name: string; type: number; left: number; right: number; child: number;
  start: number; size: number;
};

function offsetOf(ctx: Ctx, sector: number): number { return (sector + 1) * ctx.sec; }

/** Walk a sector chain with a visited-set and a bound. Returns what it could
 *  reach; a cycle or an out-of-range link ends the walk instead of hanging. */
function chain(ctx: Ctx, start: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  let s = start;
  while (s <= MAXREGSECT) {
    if (seen.has(s)) break;                       // cyclic FAT
    if (s >= ctx.fat.length) break;               // chain past the end
    if (offsetOf(ctx, s) + ctx.sec > ctx.b.length) break;
    seen.add(s);
    out.push(s);
    s = ctx.fat[s];
  }
  return out;
}

function buildContext(bytes: Uint8Array): Ctx | null {
  if (bytes.length < 512) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => dv.getUint16(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);

  const shift = u16(0x1e);
  const miniShift = u16(0x20);
  // ★ Only 9 and 12 are legal. Reject rather than shifting by an
  //  attacker-supplied amount, which would produce an absurd sector size.
  if (shift !== 9 && shift !== 12) return null;
  if (miniShift !== 6) return null;

  const sec = 1 << shift;
  const mini = 1 << miniShift;
  const nFat = u32(0x2c);
  const dirStart = u32(0x30);
  const cutoff = u32(0x38);
  const miniFatStart = u32(0x3c);
  const nMiniFat = u32(0x40);
  const difatStart = u32(0x44);
  const nDifat = u32(0x48);

  const ctx: Ctx = { b: bytes, dv, sec, mini, cutoff, fat: [], miniFat: [], miniSectors: [], entries: [] };

  // --- DIFAT: 109 in the header, then the chain ---
  const difat: number[] = [];
  for (let i = 0; i < 109; i++) { const v = u32(0x4c + i * 4); if (v <= MAXREGSECT) difat.push(v); }
  {
    const per = sec / 4 - 1;
    const seen = new Set<number>();
    let ds = difatStart;
    let guard = 0;
    while (ds <= MAXREGSECT && guard++ <= nDifat + 8) {
      if (seen.has(ds)) break;                                  // cyclic DIFAT
      if ((ds + 1) * sec + sec > bytes.length) break;
      seen.add(ds);
      const base = (ds + 1) * sec;
      for (let i = 0; i < per; i++) { const v = u32(base + i * 4); if (v <= MAXREGSECT) difat.push(v); }
      ds = u32(base + per * 4);
    }
  }
  for (const fs of difat.slice(0, nFat)) {
    if ((fs + 1) * sec + sec > bytes.length) continue;
    for (let i = 0; i < sec / 4; i++) ctx.fat.push(u32((fs + 1) * sec + i * 4));
  }
  if (ctx.fat.length === 0) return null;

  for (const s of chain(ctx, miniFatStart).slice(0, Math.max(nMiniFat, 0) || undefined)) {
    for (let i = 0; i < sec / 4; i++) ctx.miniFat.push(u32(offsetOf(ctx, s) + i * 4));
  }

  // --- directory entries ---
  for (const s of chain(ctx, dirStart)) {
    for (let i = 0; i < sec / 128; i++) {
      const p = offsetOf(ctx, s) + i * 128;
      if (p + 128 > bytes.length) break;
      const nameLen = u16(p + 64);
      const type = bytes[p + 66];
      const name = nameLen > 2 && nameLen <= 64
        ? new TextDecoder("utf-16le").decode(bytes.subarray(p, p + nameLen - 2))
        : "";
      ctx.entries.push({
        name, type,
        left: u32(p + 68), right: u32(p + 72), child: u32(p + 76),
        start: u32(p + 116), size: u32(p + 120),
      });
    }
  }
  if (ctx.entries.length === 0) return null;
  ctx.miniSectors = chain(ctx, ctx.entries[0].start);
  return ctx;
}

function readEntryBytes(ctx: Ctx, e: RawEntry): Uint8Array {
  // ★ Clamp BEFORE allocating. The size field is attacker-controlled; a real
  //  entry can claim 4 GB. Bound it by the file and by the hard ceiling.
  const size = Math.min(e.size, ctx.b.length, MAX_CFBF_STREAM_BYTES);
  if (size <= 0) return new Uint8Array(0);
  const out = new Uint8Array(size);
  let written = 0;

  if (e.size < ctx.cutoff) {
    const seen = new Set<number>();
    let m = e.start;
    while (m <= MAXREGSECT && written < size) {
      if (seen.has(m)) break;
      seen.add(m);
      const secIdx = Math.floor((m * ctx.mini) / ctx.sec);
      const within = (m * ctx.mini) % ctx.sec;
      const phys = ctx.miniSectors[secIdx];
      if (phys === undefined) break;
      const from = offsetOf(ctx, phys) + within;
      const n = Math.min(ctx.mini, size - written);
      if (from + n > ctx.b.length) break;
      out.set(ctx.b.subarray(from, from + n), written);
      written += n;
      m = ctx.miniFat[m] ?? FREESECT;
    }
    return out.subarray(0, written);
  }

  for (const s of chain(ctx, e.start)) {
    const n = Math.min(ctx.sec, size - written);
    if (n <= 0) break;
    const from = offsetOf(ctx, s);
    if (from + n > ctx.b.length) break;
    out.set(ctx.b.subarray(from, from + n), written);
    written += n;
  }
  return out.subarray(0, written);
}

/** Walk the red-black directory tree, producing PATH -> bytes. */
export function readCfbfTree(bytes: Uint8Array): Map<string, Uint8Array> {
  const ctx = buildContext(bytes);
  const out = new Map<string, Uint8Array>();
  if (!ctx) return out;
  const visited = new Set<number>();
  const walk = (idx: number, path: string): void => {
    if (idx > MAXREGSECT || idx >= ctx.entries.length) return;
    if (visited.has(idx)) return;                 // cyclic directory tree
    visited.add(idx);
    const e = ctx.entries[idx];
    walk(e.left, path);
    walk(e.right, path);
    const full = path ? `${path}/${e.name}` : e.name;
    if (e.type === 2) out.set(full, readEntryBytes(ctx, e));
    if (e.type === 1 || e.type === 5) walk(e.child, full);
  };
  walk(ctx.entries[0].child, "");
  return out;
}

/** Flat view, for callers that genuinely only want top-level streams.
 *  ★ Prefer readCfbfTree — see the header note about duplicate names. */
export function readCfbfStreams(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [path, data] of readCfbfTree(bytes)) {
    if (!path.includes("/")) out.set(path, data);
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/cfbf.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Mutation-prove every guard**

- Remove `if (seen.has(s)) break;` from `chain`. Expected: the cyclic-FAT test hangs or fails. Restore.
- Remove `if (visited.has(idx)) return;`. Expected: the cyclic-directory test fails. Restore.
- Change the clamp to `const size = e.size;`. Expected: the huge-size test fails. Restore.
- Change the shift check to `if (false)`. Expected: the illegal-shift test fails. Restore.
- Delete the DIFAT chain block (keep only the header's 109). Expected: no unit test catches it — **this is the gap the real fixture in Task 16 closes.** Record that explicitly and restore.

- [ ] **Step 7: Commit**

```bash
git add src/app/cfbf.ts src/app/cfbf.test.ts src/app/__fixtures__/cfbf-writer.ts
git commit -m "feat: add a guarded MS-CFB compound file reader"
```

---

### Task 13: `lzfu.ts` — RTF decompression

**Files:**
- Create: `src/app/lzfu.ts`
- Test: `src/app/lzfu.test.ts`

Measured on two real files: `PR_HTML` is absent from both root messages and the only formatted body is `PR_RTF_COMPRESSED`, magic `LZFu`, declared uncompressed sizes 12 204 and 102 139. So this is not an optional fallback.

★ **Licence:** derive from **MS-OXRTFCP** directly, including its fixed initial dictionary, rather than porting `@kenjiuno/decompressrtf`. That keeps the tree free of third-party code and sidesteps the EUPL question entirely. If you port instead, the file needs a BSD-2-Clause notice and a `NOTICE` entry — get sign-off first.

- [ ] **Step 1: Write the failing test**

Create `src/app/lzfu.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decompressRtf, rtfToPlainText, LZFU_INIT_DICT } from "./lzfu";

/** Build an UNCOMPRESSED ("MELA") container, which the format allows and which
 *  needs no compressor to construct. */
function melaContainer(rtf: string): Uint8Array {
  const body = new TextEncoder().encode(rtf);
  const out = new Uint8Array(16 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 12 + body.length, true);   // compSize
  dv.setUint32(4, body.length, true);        // rawSize
  out.set(new TextEncoder().encode("MELA"), 8);
  dv.setUint32(12, 0, true);                 // crc
  out.set(body, 16);
  return out;
}

describe("decompressRtf", () => {
  it("passes an uncompressed MELA container straight through", () => {
    const rtf = "{\\rtf1 hello}";
    expect(new TextDecoder().decode(decompressRtf(melaContainer(rtf)))).toContain("hello");
  });

  // The dictionary is byte-exact and load-bearing: one wrong byte silently
  // corrupts every decompressed body rather than failing loudly. Its real
  // validation is decompressing an ACTUAL LZFu stream, which Task 16 does with
  // the real .msg fixture. Here we only pin that it was transcribed at all.
  it("carries a transcribed initial dictionary", () => {
    expect(LZFU_INIT_DICT.startsWith("{")).toBe(true);
    expect(LZFU_INIT_DICT.length).toBeGreaterThan(180);
    expect(LZFU_INIT_DICT.length).toBeLessThanOrEqual(4096);
  });

  it("returns empty for an unknown magic rather than guessing", () => {
    const bad = melaContainer("x");
    bad.set(new TextEncoder().encode("XXXX"), 8);
    expect(decompressRtf(bad).length).toBe(0);
  });

  // ★★ SECURITY, MEASURED. The declared uncompressed size is attacker
  //  controlled — real values are 12204 and 102139 — so it must be clamped
  //  before allocation.
  it("clamps an absurd declared uncompressed size", () => {
    const c = melaContainer("hi");
    new DataView(c.buffer).setUint32(4, 0xfffffff0, true);
    expect(decompressRtf(c).length).toBeLessThan(64 * 1024 * 1024);
  });

  it("does not throw on a truncated container", () => {
    expect(() => decompressRtf(melaContainer("hello").subarray(0, 10))).not.toThrow();
  });
});

describe("rtfToPlainText", () => {
  it("strips control words and keeps the text", () => {
    expect(rtfToPlainText("{\\rtf1\\ansi\\deff0 Hello \\b world\\b0 .}")).toContain("Hello world");
  });

  it("drops a font table group entirely", () => {
    const out = rtfToPlainText("{\\rtf1{\\fonttbl{\\f0 Arial;}}Visible}");
    expect(out).toContain("Visible");
    expect(out).not.toContain("Arial");
  });

  it("turns \\par into a line break", () => {
    expect(rtfToPlainText("{\\rtf1 one\\par two}")).toMatch(/one\s*\n\s*two/);
  });

  it("decodes a hex escape", () => {
    expect(rtfToPlainText("{\\rtf1 caf\\'e9}")).toContain("café");
  });

  it("de-encapsulates HTML rather than emitting rtf markup", () => {
    const out = rtfToPlainText("{\\rtf1\\fromhtml1 {\\*\\htmltag <p>}Hi{\\*\\htmltag </p>}}");
    expect(out).toContain("Hi");
    expect(out).not.toContain("htmltag");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/lzfu.test.ts`
Expected: FAIL — cannot resolve `./lzfu`.

- [ ] **Step 3: Implement**

Create `src/app/lzfu.ts`:

```ts
// src/app/lzfu.ts — MS-OXRTFCP decompression plus RTF -> plain text.
//
// ★★★ NOT OPTIONAL, and this was measured rather than assumed. Two real
// Outlook messages carried NO PR_HTML at all; the only formatted body in each
// was PR_RTF_COMPRESSED with the "LZFu" magic. Without this module a .msg body
// can only ever be the plain-text stream, which loses TABLES — exactly what a
// resourcing or budget mail carries.
//
// Derived from the published MS-OXRTFCP specification, including the fixed
// initial dictionary below, so no third-party code enters the tree.

/** ★★★ TRANSCRIBE THIS FROM MS-OXRTFCP, DO NOT COPY IT FROM MEMORY OR FROM A
 *  BLOG POST. It is the specification's fixed initial dictionary, it is
 *  byte-exact, and one wrong byte does not fail loudly — it silently corrupts
 *  every decompressed body. The plan's author reconstructed it from memory
 *  while drafting and landed one byte short, which is precisely why this is an
 *  instruction rather than a value.
 *
 *  Source: MS-OXRTFCP, "Compressed RTF Format", the initial dictionary contents.
 *  It begins `{` followed by the standard RTF preamble control words and ends
 *  with the tab/tx run.
 *
 *  ★ VERIFY IT BY DECOMPRESSING A REAL STREAM, never by its length: Task 16's
 *  real `.msg` fixture carries an LZFu-compressed body, and a wrong dictionary
 *  turns its output into garbage that the fixture's body-marker assertion
 *  catches. That test is the dictionary's only real proof. */
export const LZFU_INIT_DICT = "<transcribe from MS-OXRTFCP>";

const DICT_SIZE = 4096;
const MAX_RAW_BYTES = 64 * 1024 * 1024;

/** Decompress a PR_RTF_COMPRESSED stream. Returns empty on anything malformed —
 *  a corrupt body must never lose the message. */
export function decompressRtf(input: Uint8Array): Uint8Array {
  if (input.length < 16) return new Uint8Array(0);
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const compSize = dv.getUint32(0, true);
  const rawSizeDeclared = dv.getUint32(4, true);
  const magic = new TextDecoder("latin1").decode(input.subarray(8, 12));

  // ★★ Clamp before allocating. Measured real values are 12204 and 102139;
  //  the field is attacker-controlled and can claim 4 GB.
  const rawSize = Math.min(rawSizeDeclared, MAX_RAW_BYTES);

  if (magic === "MELA") return input.subarray(16, Math.min(input.length, 16 + rawSize));
  if (magic !== "LZFu") return new Uint8Array(0);

  const end = Math.min(input.length, 4 + compSize);
  const dict = new Uint8Array(DICT_SIZE);
  const init = new TextEncoder().encode(LZFU_INIT_DICT);
  dict.set(init.subarray(0, Math.min(init.length, DICT_SIZE)));
  let writeAt = init.length % DICT_SIZE;

  const out = new Uint8Array(rawSize);
  let produced = 0;
  let pos = 16;

  while (pos < end && produced < rawSize) {
    const control = input[pos++];
    for (let bit = 0; bit < 8 && pos < end && produced < rawSize; bit++) {
      if ((control & (1 << bit)) === 0) {
        const byte = input[pos++];
        out[produced++] = byte;
        dict[writeAt] = byte;
        writeAt = (writeAt + 1) % DICT_SIZE;
        continue;
      }
      if (pos + 1 >= end) return out.subarray(0, produced);
      const token = (input[pos] << 8) | input[pos + 1];
      pos += 2;
      const offset = (token >> 4) & 0xfff;
      const length = (token & 0x0f) + 2;
      if (offset === writeAt) return out.subarray(0, produced);   // end marker
      for (let i = 0; i < length && produced < rawSize; i++) {
        // ★ Bounds-checked back-reference into the 4096-byte ring buffer.
        const byte = dict[(offset + i) % DICT_SIZE];
        out[produced++] = byte;
        dict[writeAt] = byte;
        writeAt = (writeAt + 1) % DICT_SIZE;
      }
    }
  }
  return out.subarray(0, produced);
}

/** RTF -> plain text, including \fromhtml1 de-encapsulation.
 *  ★★ Not a full RTF renderer and must not become one: the goal is readable
 *  text for a model, so groups that carry no reader-visible content are dropped
 *  wholesale rather than interpreted. */
export function rtfToPlainText(rtf: string): string {
  let s = rtf;
  // Destination groups whose content is metadata, never body text.
  for (const dest of ["fonttbl", "colortbl", "stylesheet", "info", "generator", "pntext", "htmltag"]) {
    s = s.replace(new RegExp(`\\{\\\\\\*?\\\\${dest}[^{}]*(\\{[^{}]*\\})*[^{}]*\\}`, "gi"), "");
  }
  s = s.replace(/\\par[d]?\b/g, "\n");
  s = s.replace(/\\tab\b/g, "\t");
  s = s.replace(/\\line\b/g, "\n");
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_m, h: string) =>
    new TextDecoder("windows-1252").decode(new Uint8Array([Number.parseInt(h, 16)])));
  s = s.replace(/\\u(-?\d+)\s?\??/g, (_m, n: string) => {
    const code = Number.parseInt(n, 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
  s = s.replace(/\\[a-zA-Z]+-?\d*\s?/g, "");     // remaining control words
  s = s.replace(/[{}]/g, "");
  s = s.replace(/\\\\/g, "\\");
  s = s.replace(/[ \t]+/g, " ");
  s = s.split("\n").map((l) => l.trim()).join("\n");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/lzfu.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Mutation-prove the clamp**

Change `const rawSize = Math.min(rawSizeDeclared, MAX_RAW_BYTES);` to `const rawSize = rawSizeDeclared;`. Expected: the clamp test goes RED (or the run allocates 4 GB and dies, which is the same finding). Restore.

- [ ] **Step 6: Commit**

```bash
git add src/app/lzfu.ts src/app/lzfu.test.ts
git commit -m "feat: decompress and de-encapsulate RTF message bodies"
```

---

### Task 14: `msg-extract.ts`

**Files:**
- Create: `src/app/msg-extract.ts`
- Test: `src/app/msg-extract.test.ts`

Takes a `Map<string, Uint8Array>` — the same shape `docx-extract` takes — so it needs **no `.msg` file** to test.

- [ ] **Step 1: Write the failing test**

Create `src/app/msg-extract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { msgToParsedMail } from "./msg-extract";

const uni = (s: string) => new TextEncoder().encode(s).length === s.length
  ? new Uint8Array(Buffer.from(s, "utf16le"))
  : new Uint8Array(Buffer.from(s, "utf16le"));

function streams(entries: Record<string, Uint8Array>): Map<string, Uint8Array> {
  return new Map(Object.entries(entries));
}

describe("msgToParsedMail", () => {
  it("reads subject, sender and the plain body from the root storage", () => {
    const p = msgToParsedMail(streams({
      "__substg1.0_0037001F": uni("Q3 plan"),
      "__substg1.0_0C1A001F": uni("Alice Example"),
      "__substg1.0_1000001F": uni("Body text here"),
    }));
    expect(p.headers.subject).toBe("Q3 plan");
    expect(p.headers.from).toBe("Alice Example");
    expect(p.body.content).toContain("Body text here");
    expect(p.body.kind).toBe("text");
  });

  // ★★★ THE MEASURED DEFECT, PINNED. A flattened reader attributed a
  //  __nameid_version1.0 stream to the message and reported a body that did not
  //  exist. Properties resolve by ROOT PATH ONLY.
  it("ignores same-named streams inside other storages", () => {
    const p = msgToParsedMail(streams({
      "__substg1.0_0037001F": uni("Real subject"),
      "__nameid_version1.0/__substg1.0_0037001F": uni("Decoy subject"),
      "__attach_version1.0_#00000000/__substg1.0_0037001F": uni("Attachment subject"),
    }));
    expect(p.headers.subject).toBe("Real subject");
  });

  it("collects attachments from their own storages", () => {
    const p = msgToParsedMail(streams({
      "__substg1.0_1000001F": uni("body"),
      "__attach_version1.0_#00000000/__substg1.0_3707001F": uni("plan.xlsx"),
      "__attach_version1.0_#00000000/__substg1.0_370E001F": uni("application/vnd.ms-excel"),
      "__attach_version1.0_#00000000/__substg1.0_37010102": new Uint8Array([1, 2, 3]),
    }));
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0].fileName).toBe("plan.xlsx");
    expect(p.attachments[0].mimeType).toBe("application/vnd.ms-excel");
    expect(Array.from(p.attachments[0].bytes)).toEqual([1, 2, 3]);
  });

  it("falls back to the short filename when the long one is absent", () => {
    const p = msgToParsedMail(streams({
      "__attach_version1.0_#00000000/__substg1.0_3704001F": uni("SHORT~1.XLS"),
      "__attach_version1.0_#00000000/__substg1.0_37010102": new Uint8Array([9]),
    }));
    expect(p.attachments[0].fileName).toBe("SHORT~1.XLS");
  });

  it("reports the degraded kind when only an RTF body exists", () => {
    // A MELA container is uncompressed, so no compressor is needed here.
    const rtf = "{\\rtf1 Formatted body}";
    const body = new TextEncoder().encode(rtf);
    const c = new Uint8Array(16 + body.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, 12 + body.length, true);
    dv.setUint32(4, body.length, true);
    c.set(new TextEncoder().encode("MELA"), 8);
    c.set(body, 16);
    const p = msgToParsedMail(streams({ "__substg1.0_10090102": c }));
    expect(p.body.content).toContain("Formatted body");
    expect(p.body.kind).toBe("rtf-degraded");
  });

  it("returns an empty mail rather than throwing on an empty stream map", () => {
    const p = msgToParsedMail(new Map());
    expect(p.headers.subject).toBe("");
    expect(p.attachments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/msg-extract.test.ts`
Expected: FAIL — cannot resolve `./msg-extract`.

- [ ] **Step 3: Implement**

Create `src/app/msg-extract.ts`:

```ts
// src/app/msg-extract.ts — CFBF stream tree -> ParsedMail.
//
// ★★★ RESOLVE PROPERTIES BY STORAGE PATH, NEVER BY STREAM NAME ALONE. Duplicate
// names across storages are normal: a real message carries
// __substg1.0_10090102 on the root AND inside __nameid_version1.0, and a real
// message with attachments carries a subject stream per attachment. A flattened
// lookup reported a message body that did not exist. Root properties are the
// entries with NO "/" in their path.
//
// Property tags come from MS-OXPROPS. Tags are facts from a specification, not
// creative expression.

import { decompressRtf, rtfToPlainText } from "./lzfu";
import type { ParsedMail } from "./mail-extract";

const TAG = {
  SUBJECT: "0037001F",
  SENDER_NAME: "0C1A001F",
  SENDER_EMAIL: "0C1F001F",
  DISPLAY_TO: "0E04001F",
  DISPLAY_CC: "0E03001F",
  BODY_PLAIN: "1000001F",
  BODY_HTML: "10130102",
  BODY_RTF: "10090102",
  DELIVERY_TIME: "0E060040",
  ATTACH_LONG_FILENAME: "3707001F",
  ATTACH_FILENAME: "3704001F",
  ATTACH_MIME_TAG: "370E001F",
  ATTACH_DATA: "37010102",
} as const;

const decodeUnicode = (b: Uint8Array | undefined): string =>
  b ? new TextDecoder("utf-16le").decode(b).replace(/\0+$/, "") : "";

/** Root-level property: no "/" in the path. */
function rootProp(streams: Map<string, Uint8Array>, tag: string): Uint8Array | undefined {
  return streams.get(`__substg1.0_${tag}`);
}

function storageProp(
  streams: Map<string, Uint8Array>,
  storage: string,
  tag: string,
): Uint8Array | undefined {
  return streams.get(`${storage}/__substg1.0_${tag}`);
}

function attachmentStorages(streams: Map<string, Uint8Array>): string[] {
  const found = new Set<string>();
  for (const path of streams.keys()) {
    const slash = path.indexOf("/");
    if (slash < 0) continue;
    const head = path.slice(0, slash);
    if (head.startsWith("__attach_version1.0")) found.add(head);
  }
  return [...found].sort();
}

function addressList(v: string): string[] {
  return v.split(/[;,]/).map((s) => s.trim()).filter((s) => s.length > 0);
}

export function msgToParsedMail(streams: Map<string, Uint8Array>): ParsedMail {
  const diagnostics: string[] = [];

  const plain = decodeUnicode(rootProp(streams, TAG.BODY_PLAIN));
  const htmlBytes = rootProp(streams, TAG.BODY_HTML);
  const rtfBytes = rootProp(streams, TAG.BODY_RTF);

  let body: ParsedMail["body"];
  if (htmlBytes && htmlBytes.length > 32) {
    body = { kind: "html", content: new TextDecoder("utf-8").decode(htmlBytes) };
  } else if (rtfBytes && rtfBytes.length > 0) {
    const raw = decompressRtf(rtfBytes);
    const text = rtfToPlainText(new TextDecoder("latin1").decode(raw));
    if (text.length > 0) {
      body = { kind: "rtf-degraded", content: text };
    } else {
      diagnostics.push("the message body could not be decompressed; plain text follows");
      body = { kind: "text", content: plain };
    }
  } else {
    body = { kind: "text", content: plain };
  }

  const attachments = attachmentStorages(streams).flatMap((storage) => {
    const bytes = storageProp(streams, storage, TAG.ATTACH_DATA);
    if (!bytes) {
      diagnostics.push(`an attachment in ${storage} carried no data and was skipped`);
      return [];
    }
    const fileName =
      decodeUnicode(storageProp(streams, storage, TAG.ATTACH_LONG_FILENAME)) ||
      decodeUnicode(storageProp(streams, storage, TAG.ATTACH_FILENAME)) ||
      "attachment";
    const mimeType =
      decodeUnicode(storageProp(streams, storage, TAG.ATTACH_MIME_TAG)) ||
      "application/octet-stream";
    return [{ fileName, mimeType, bytes }];
  });

  return {
    headers: {
      from: decodeUnicode(rootProp(streams, TAG.SENDER_NAME)) ||
            decodeUnicode(rootProp(streams, TAG.SENDER_EMAIL)),
      to: addressList(decodeUnicode(rootProp(streams, TAG.DISPLAY_TO))),
      cc: addressList(decodeUnicode(rootProp(streams, TAG.DISPLAY_CC))),
      subject: decodeUnicode(rootProp(streams, TAG.SUBJECT)),
      date: "",
    },
    body,
    attachments,
    diagnostics,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/msg-extract.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Mutation-prove the path resolution**

Change `rootProp` to search by name suffix instead of exact path:

```ts
function rootProp(streams: Map<string, Uint8Array>, tag: string): Uint8Array | undefined {
  for (const [k, v] of streams) if (k.endsWith(`__substg1.0_${tag}`)) return v;
  return undefined;
}
```

Expected: the "ignores same-named streams inside other storages" test goes RED. **This mutant is the exact defect measured in the design phase** — restore it and record the result.

- [ ] **Step 6: Commit**

```bash
git add src/app/msg-extract.ts src/app/msg-extract.test.ts
git commit -m "feat: read .msg properties by storage path"
```

---

### Task 15: Wire `.msg` into the router and the classifier

**Files:**
- Modify: `src/app/mail-extract.ts`
- Modify: `src/app/chat-attachments.ts`
- Test: `src/app/chat-attachments.test.ts`, `src/app/mail-extract.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/chat-attachments.test.ts`:

```ts
  it("classifies msg as mail and offers it in the picker", () => {
    expect(classifyAttachment("application/vnd.ms-outlook", "a.msg")).toBe("mail");
    expect(classifyAttachment("application/octet-stream", "a.msg")).toBe("mail");
    expect(ATTACHMENT_ACCEPT.split(",")).toContain(".msg");
  });
```

Append to `src/app/mail-extract.test.ts`:

```ts
import { parseMail, looksLikeCfbf } from "./mail-extract";

it("routes a compound file to the msg parser rather than the MIME parser", () => {
  const header = new Uint8Array(512);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  expect(looksLikeCfbf(header)).toBe(true);
  const mail = parseMail(header);          // malformed body, but must not throw
  expect(mail.attachments).toEqual([]);
  expect(mail.body.content).toBe("");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/app/chat-attachments.test.ts src/app/mail-extract.test.ts
```
Expected: FAIL on the `.msg` classification.

- [ ] **Step 3: Implement**

In `src/app/chat-attachments.ts`, add `".msg"` to `MAIL_EXTENSIONS` and `"application/vnd.ms-outlook"` to both the mail MIME branch and `ACCEPT_MIMES`:

```ts
export const MAIL_EXTENSIONS = new Set([".eml", ".mhtml", ".mht", ".msg"]);
```
```ts
  if (mime === "message/rfc822" || mime === "multipart/related" ||
      mime === "application/vnd.ms-outlook") return "mail";
```

In `src/app/mail-extract.ts`, replace the placeholder branch in `parseMail`:

```ts
import { readCfbfTree } from "./cfbf";
import { msgToParsedMail } from "./msg-extract";

export function parseMail(bytes: Uint8Array): ParsedMail {
  if (looksLikeCfbf(bytes)) return msgToParsedMail(readCfbfTree(bytes));
  return emlToParsedMail(parseMimeMessage(new TextDecoder().decode(bytes)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/app/chat-attachments.test.ts src/app/mail-extract.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-attachments.ts src/app/mail-extract.ts src/app/chat-attachments.test.ts src/app/mail-extract.test.ts
git commit -m "feat: route .msg through the compound file reader"
```

---

### Task 16: The real-format fixture

**Files:**
- Create: `src/app/__fixtures__/minimal-outlook.msg.base64.ts`
- Test: `src/app/msg-integration.test.ts`

★★★ **Without this, `cfbf.ts` is only proven self-consistent.** Every other `.msg` test builds its input with our own writer, so reader and writer can share the same misreading of the specification and agree forever. That is the `derived-assertion-is-tautological` shape, and `unzip.test.ts` already guards against it by base64-inlining one real zip.

★★★ **Do not use a real business email.** The two files measured during design carry real names, a real customer and a real deck. Produce a throwaway instead.

- [ ] **Step 1: Produce a sanitised real `.msg`**

From Outlook, send yourself a message with:
- subject `Ingest fixture`
- a body containing the literal marker `FIXTURE-BODY-MARKER`, **with some formatting** — bold a word and add a two-row table
- one small attachment: a `.txt` file containing `fixture attachment payload`

Save it as `.msg` from Outlook (File → Save As), so it is genuinely Outlook-produced — that is the property that matters. Keep it under 100 KB.

★ **The formatting is not decoration.** This fixture is the LZFu dictionary's only proof, and
that only works if Outlook actually writes a COMPRESSED body. Verify before inlining:

```bash
node -e '
const b = require("fs").readFileSync(process.argv[1]);
const i = b.indexOf(Buffer.from("LZFu"));
const j = b.indexOf(Buffer.from("MELA"));
console.log("LZFu at:", i, "| MELA at:", j);
console.log(i >= 0 ? "OK - compressed body present" : "NOT USABLE - re-save with more formatting");
' /path/to/your/saved.msg
```

A plain unformatted message can be stored uncompressed (`MELA`), which leaves the dictionary
unproven while every test still passes — the vacuous-green shape. If you see `MELA` and no
`LZFu`, add formatting and re-save.

- [ ] **Step 2: Inline it**

```bash
node -e '
const fs = require("fs");
const b = fs.readFileSync(process.argv[1]);
const b64 = b.toString("base64").replace(/(.{100})/g, "$1\\n");
fs.writeFileSync("src/app/__fixtures__/minimal-outlook.msg.base64.ts",
  "// A throwaway Outlook-produced .msg, base64-inlined.\r\n" +
  "//\r\n" +
  "// WHY A REAL FILE: every other cfbf/msg test builds its input with our own\r\n" +
  "// writer, so reader and writer could share the same misreading of MS-CFB and\r\n" +
  "// agree forever. This fixture is the only thing proving we read what Outlook\r\n" +
  "// actually emits. unzip.test.ts inlines a real zip for the same reason.\r\n" +
  "//\r\n" +
  "// It is deliberately synthetic: sent to self, no real correspondents, no\r\n" +
  "// business content.\r\n" +
  "export const MINIMAL_OUTLOOK_MSG_BASE64 = `\\n" + b64 + "\\n`;\r\n", "utf8");
console.log("bytes:", b.length);
' "/path/to/your/saved.msg"
```

- [ ] **Step 3: Write the integration test**

Create `src/app/msg-integration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MINIMAL_OUTLOOK_MSG_BASE64 } from "./__fixtures__/minimal-outlook.msg.base64";
import { readCfbfTree } from "./cfbf";
import { msgToParsedMail } from "./msg-extract";
import { ingestBytes } from "./attachment-ingest";

function fixtureBytes(): Uint8Array {
  const bin = atob(MINIMAL_OUTLOOK_MSG_BASE64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe("a real Outlook .msg", () => {
  // ★★★ THE ANTI-TAUTOLOGY TEST. Everything else round-trips our own writer.
  it("reads streams Outlook actually wrote", () => {
    const tree = readCfbfTree(fixtureBytes());
    expect(tree.size).toBeGreaterThan(10);
    expect([...tree.keys()].some((k) => k.startsWith("__substg1.0_"))).toBe(true);
  });

  // ★★★ THIS IS ALSO THE LZFU DICTIONARY'S ONLY REAL PROOF. Outlook writes the
  //  formatted body as an LZFu-compressed RTF stream, so if lzfu.ts's
  //  transcribed initial dictionary is off by even one byte, decompression
  //  produces garbage and this marker is absent. A length assertion on the
  //  dictionary proves nothing; this does.
  it("extracts the subject and body, proving the LZFu dictionary is correct", () => {
    const mail = msgToParsedMail(readCfbfTree(fixtureBytes()));
    expect(mail.headers.subject).toContain("Ingest fixture");
    expect(mail.body.content).toContain("FIXTURE-BODY-MARKER");
  });

  it("finds the attachment and recurses into it", async () => {
    const r = await ingestBytes(fixtureBytes(), "application/vnd.ms-outlook", "fixture.msg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.kind).toBe("mail");
    expect(r.node.children.length).toBeGreaterThanOrEqual(1);
    const child = r.node.children[0].block.source as { data: string };
    expect(child.data).toContain("fixture attachment payload");
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/msg-integration.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Prove the DIFAT guard the synthetic tests could not**

Delete the DIFAT chain block from `cfbf.ts`, keeping only the header's 109 entries. Re-run this file.

If the fixture is small enough that the header alone suffices, **this mutant survives** — which is the honest result, and it means the fixture does not cover DIFAT chaining. Record that explicitly in the test file as a comment, and either accept the gap or add a second, larger fixture (over ~8 MB) whose only job is to force a chained DIFAT. Do not delete the guard because a small fixture failed to exercise it — a surviving mutant is a question, not a licence.

Restore the block.

- [ ] **Step 6: Commit**

```bash
git add src/app/__fixtures__/minimal-outlook.msg.base64.ts src/app/msg-integration.test.ts
git commit -m "test: pin the msg reader against a real Outlook-produced file"
```

---

### Task 17: Full gate run and the attachment size cap

**Files:**
- Modify: `src/app/chat-attachments.ts`
- Test: `src/app/chat-attachments.test.ts`

Measured: one ordinary business email with a slide deck reached **17.8 MB** against the 20 MB cap. The cap measures the envelope, so mail needs headroom.

- [ ] **Step 1: Write the failing test**

```ts
  // ★★ MEASURED. A real workshop mail with one .pptx attached was 17.8 MB —
  //  89% of the old 20 MB cap. Mail envelopes carry their attachments inline,
  //  so the envelope must be allowed to be larger than any one attachment.
  it("allows a mail envelope larger than the flat-file cap", () => {
    expect(checkAttachmentSize(30 * 1024 * 1024, "mail")).toBeNull();
    expect(checkAttachmentSize(30 * 1024 * 1024, "text")).toBe("too-large");
    expect(checkAttachmentSize(70 * 1024 * 1024, "mail")).toBe("too-large");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/chat-attachments.test.ts`
Expected: FAIL — `checkAttachmentSize` takes one argument.

- [ ] **Step 3: Implement**

```ts
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** ★★ Mail envelopes carry their attachments inline. Measured: an ordinary
 *  workshop mail with one slide deck was 17.8 MB, 89% of the flat-file cap.
 *  The tree's own MAX_DECODED_BYTES still bounds what gets extracted. */
export const MAX_MAIL_BYTES = 64 * 1024 * 1024;

export function checkAttachmentSize(
  byteLength: number,
  kind?: AttachmentKind,
): AttachmentError | null {
  const limit = kind === "mail" ? MAX_MAIL_BYTES : MAX_ATTACHMENT_BYTES;
  return byteLength > limit ? "too-large" : null;
}
```

In `attachment-ingest.ts`, classify before checking size so the right limit applies:

```ts
  const kind = classifyAttachment(mimeType, fileName);
  if (!kind) return { ok: false, error: "unsupported-type" };
  const sizeErr = checkAttachmentSize(bytes.byteLength, kind);
  if (sizeErr) return { ok: false, error: sizeErr };
  if (bytes.byteLength > budget.bytesRemaining) return { ok: false, error: "too-large" };
  budget.bytesRemaining -= bytes.byteLength;
```

Update `ingestFile` the same way — classify from `file.type`/`file.name` before the size check.

Update the EN and DE `chatAttachmentTooLarge` strings, which hardcode "max 20 MB", to drop the number:

- EN: `chatAttachmentTooLarge: "{0} is too large"`
- DE: `chatAttachmentTooLarge: "{0} ist zu groß"` (node UTF-8 write, `\r\n` anchors)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/chat-attachments.test.ts src/app/attachment-ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Run every gate**

```bash
SP=<your scratchpad>
npx tsc --noEmit; echo "TSC_EXIT=$?"            # 0; note 2 means diagnostics
npx eslint --max-warnings=0 src; echo "LINT_EXIT=$?"
npm run test:run > "$SP/suite.log" 2>&1; echo "SUITE_EXIT=$?"; grep -E "Test Files|Tests " "$SP/suite.log"
npm run test:coverage > "$SP/cov.log" 2>&1; echo "COV_EXIT=$?"; grep -E "All files|ERROR" "$SP/cov.log"
npm run test:shuffle > "$SP/shuf.log" 2>&1; echo "SHUF_EXIT=$?"
npm run size:check; echo "SIZE_EXIT=$?"
npm run dup:check; echo "DUP_EXIT=$?"
npm run docs:symbols:check; echo "SYM_EXIT=$?"
```

All must be 0. **Never read any of these through a pipe** — redirect, `echo "EXIT=$?"` unpiped, then grep the file. If coverage fails on branch percentage, the malformed-input tests are missing, not the floor.

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-attachments.ts src/app/attachment-ingest.ts src/app/chat-attachments.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "fix: give mail envelopes their own size cap"
```

---

## After the plan

**Owed before release, both recorded in the spec:**

1. **The licence question**, only if you ported `@kenjiuno/decompressrtf` instead of deriving `lzfu.ts` from MS-OXRTFCP. Deriving avoids it entirely and is the recommended route.
2. **Eye-verify in a real browser.** jsdom has no `File` streaming and no layout. Drop a real `.msg` and a real `.eml` into the assistant on `PORT=3100 npm run dev` — never port 3000, which may hold a live-data tab — and confirm the summary line renders and the model receives the attachment text.

**Documentation to update in the release commit:**

- `AGENTS.md` — the attachment pipeline now has one entry point. Add `ATTACHMENT_ACCEPT` and `attachment-ingest.ts` to the architecture pointers, with the rule that no consumer may hand-write an accept string.
- `docs/open-followups.md` — file an entry for anything left open, and cross-reference 320 (silent-omission disclosure), which this track's disclosure markers follow.
- `CHANGELOG.md` — user-visible: Outlook mail and web pages can now be attached, and mail attachments are read too.
