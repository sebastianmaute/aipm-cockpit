# Communication Templates SP2 — Rich-Text Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SP1 plain `<textarea>` for a communication-template body with a lazy-loaded Tiptap v3 rich-text editor (core toolbar + merge-field chips), sanitizing authored HTML with DOMPurify before it is stored.

**Architecture:** A new pure `sanitize-html.ts` (DOMPurify allow-list) + a `"use client"` `rich-text-editor.tsx` (Tiptap `useEditor`, i18n-free — labels via props). The Turso-gated settings pane swaps its textarea for the editor via `next/dynamic(..., { ssr: false })`, so Tiptap + DOMPurify load only when the pane mounts. The body model, Turso store, hook, and both send flows are untouched.

**Tech Stack:** TypeScript, React 19 (Next.js fork), Tiptap v3 (`@tiptap/react` + `@tiptap/starter-kit` — StarterKit v3 already bundles Bold/Italic/Underline/Link/Heading/BulletList/OrderedList/ListItem/History), DOMPurify, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-06-15-comm-templates-sp2-design.md`

---

## Grounding facts (verified)

- **Tiptap v3 StarterKit includes Underline and Link by default** (both "New in v3") — no separate `@tiptap/extension-underline` / `@tiptap/extension-link` needed. Source: Tiptap docs via Context7.
- Next.js + React 19: `useEditor({ ..., immediatelyRender: false })` avoids SSR hydration errors. Import `useEditor, EditorContent` from `@tiptap/react`, `StarterKit` from `@tiptap/starter-kit`.
- `isSafeHttpUrl(url: string): boolean` is exported from `src/app/document-link.ts:42` (http/https guard from the SharePoint work).
- SP1 section (`src/app/settings-sections/comm-templates-section.tsx`): renders a category select, a name+Create row, a template list (select/Set-default/Delete), and — when a template is selected — a rename input, a merge-field chip row, and the **body `<textarea>`** (aria-label `commTplBody`, persisted on blur via `persistBody → onSaveBody`). The chip row + textarea are what SP2 replaces with the editor; the chips MOVE INTO the editor (they need the editor cursor).
- SP1 section keeps `bodyDraft` state and `persistBody()` (`if (selected && bodyDraft !== selected.body) onSaveBody(selected.id, bodyDraft)`). Keep both.
- i18n: `enUS` object in `i18n.ts`; parallel `de` object in `i18n.de.ts`; tsc enforces identical key sets; `i18n-encoding` test bans ASCII umlaut substitutes. DE edits via a **node CRLF write** (file uses `\r\n`; Edit corrupts umlauts).
- `t(lang, key)` from `./i18n` / `../i18n`; `TranslationKey = keyof typeof enUS`.

## Conventions for every task
- Tests: `npx vitest run src/app/<file>`; typecheck `npx tsc --noEmit`; lint `npm run lint` (CI `--max-warnings=0` — an unused import/var FAILS it; re-check after refactors).
- New i18n strings → EN + DE identical keys; DE via node write; verify `i18n-encoding`.
- a11y: every toolbar/chip control needs an accessible name; the editor surface needs an `aria-label` (axe gate).
- Palette: only sanctioned AIPM tokens (`border-line`, `bg-surface`, `bg-surface-muted`, `text-foreground`, `text-muted-foreground`, `bg-AIPM-dark-blue`, `text-white`, `text-AIPM-purple`, `focus:ring-AIPM-green`). No shadows/gradients/off-palette.
- Commit after each task. No `Co-Authored-By`. No push.

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | **modify** — add `@tiptap/react`, `@tiptap/starter-kit`, `dompurify`; dev `@types/dompurify` |
| `sanitize-html.ts` | **new** pure `sanitizeTemplateHtml(html)` (DOMPurify allow-list) |
| `rich-text-editor.tsx` | **new** `"use client"` Tiptap editor + toolbar + merge chips; i18n-free (labels via props) |
| `settings-sections/comm-templates-section.tsx` | **modify** — swap textarea+chips for the lazy editor |
| `i18n.ts` / `i18n.de.ts` | **modify** — toolbar label keys + the release highlight |
| `version.ts` / `CHANGELOG.md` | **modify** — release 0.89.0 "Bujold" |

---

### Task 1: Dependencies + DOMPurify sanitizer (`sanitize-html.ts`)

**Files:** Modify `package.json` (via npm). Create `src/app/sanitize-html.ts`, `src/app/sanitize-html.test.ts`.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install @tiptap/react @tiptap/starter-kit dompurify
npm install -D @types/dompurify
```
Expected: `package.json` gains the three deps + the dev type package; `npm install` exits 0. (If `@types/dompurify` reports it is now bundled with `dompurify` and installs an empty stub, that is fine.)

- [ ] **Step 2: Write the failing test** — create `src/app/sanitize-html.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeTemplateHtml } from "./sanitize-html";

describe("sanitizeTemplateHtml", () => {
  it("drops <script> and event handlers", () => {
    expect(sanitizeTemplateHtml("<script>alert(1)</script>")).toBe("");
    expect(sanitizeTemplateHtml('<p onclick="x()">hi</p>')).not.toContain("onclick");
    expect(sanitizeTemplateHtml('<p onclick="x()">hi</p>')).toContain("hi");
  });
  it("drops a javascript: href but keeps the link text", () => {
    const out = sanitizeTemplateHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript");
    expect(out).toContain("x");
  });
  it("keeps allowed formatting marks and blocks", () => {
    const out = sanitizeTemplateHtml("<p><strong>b</strong> <em>i</em> <u>u</u></p><h1>H</h1><ul><li>one</li></ul>");
    expect(out).toContain("<strong>");
    expect(out).toContain("<em>");
    expect(out).toContain("<u>");
    expect(out).toContain("<h1>");
    expect(out).toContain("<li>");
  });
  it("keeps a safe http link with rel/target", () => {
    const out = sanitizeTemplateHtml('<a href="https://ok.example" target="_blank" rel="noopener noreferrer">x</a>');
    expect(out).toContain('href="https://ok.example"');
    expect(out).toContain('target="_blank"');
  });
  it("leaves merge-field tokens untouched", () => {
    expect(sanitizeTemplateHtml("<p>Hi {{taskName}}</p>")).toContain("{{taskName}}");
  });
  it("drops <style>", () => {
    expect(sanitizeTemplateHtml("<style>p{}</style><p>x</p>")).not.toContain("<style>");
  });
});
```

- [ ] **Step 3: Run, verify failure** — `npx vitest run src/app/sanitize-html.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement** — create `src/app/sanitize-html.ts`:

```ts
// src/app/sanitize-html.ts — DOMPurify allow-list for communication-template HTML.
// The allow-list mirrors the Tiptap editor's schema (the only producer of this
// HTML), so sanitizing the editor output is a defense-in-depth storage boundary.
// Merge-field tokens ({{field}}) are plain text and pass through untouched.
import DOMPurify from "dompurify";

const ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "h1", "h2", "ul", "ol", "li", "a"];
const ALLOWED_ATTR = ["href", "target", "rel"];

export function sanitizeTemplateHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  });
}
```

- [ ] **Step 5: Run, verify pass** — `npx vitest run src/app/sanitize-html.test.ts && npx tsc --noEmit && npm run lint` → PASS / clean. (If `dompurify`'s types need it, the default import works with `esModuleInterop`, which this repo uses; if tsc complains, use `import DOMPurify from "dompurify";` — already shown.)

- [ ] **Step 6: Commit**
```bash
git add package.json package-lock.json src/app/sanitize-html.ts src/app/sanitize-html.test.ts
git commit -m "feat: DOMPurify template-HTML sanitizer + Tiptap deps"
```

---

### Task 2: Tiptap rich-text editor (`rich-text-editor.tsx`)

**Files:** Create `src/app/rich-text-editor.tsx`, `src/app/rich-text-editor.test.tsx`.

The component is i18n-free: all visible/aria labels arrive via a `labels` prop + `fieldLabel`. It sanitizes `getHTML()` before bubbling `onChange`, so the parent only ever sees clean HTML.

- [ ] **Step 1: Write the failing test** — create `src/app/rich-text-editor.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RichTextEditor, type RichTextEditorLabels } from "./rich-text-editor";

// ProseMirror touches layout APIs jsdom lacks; stub them so the editor mounts.
beforeAll(() => {
  if (!("getClientRects" in Range.prototype)) {
    // @ts-expect-error jsdom polyfill
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  }
  // @ts-expect-error jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

const labels: RichTextEditorLabels = {
  bold: "Bold", italic: "Italic", underline: "Underline",
  heading1: "Heading 1", heading2: "Heading 2",
  bulletList: "Bullet list", numberedList: "Numbered list",
  link: "Link", unlink: "Remove link", linkPrompt: "Enter URL",
};

function setup(over: Partial<React.ComponentProps<typeof RichTextEditor>> = {}) {
  const onChange = vi.fn();
  render(
    <RichTextEditor
      value="<p>Hi</p>"
      onChange={onChange}
      label="Body"
      mergeFields={["taskName", "dueDate"]}
      fieldLabel={(f) => (f === "taskName" ? "Task name" : "Due date")}
      labels={labels}
      {...over}
    />,
  );
  return { onChange };
}

describe("RichTextEditor", () => {
  it("renders the editor surface with the given accessible label", async () => {
    setup();
    expect(await screen.findByLabelText("Body")).toBeTruthy();
  });
  it("renders the core toolbar buttons with accessible names", async () => {
    setup();
    await screen.findByLabelText("Body");
    for (const name of ["Bold", "Italic", "Underline", "Heading 1", "Heading 2", "Bullet list", "Numbered list", "Link", "Remove link"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });
  it("renders a merge-field chip per field", async () => {
    setup();
    await screen.findByLabelText("Body");
    expect(screen.getByRole("button", { name: "Task name" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Due date" })).toBeTruthy();
  });
  it("renders the initial HTML content as text", async () => {
    setup();
    const surface = await screen.findByLabelText("Body");
    expect(surface.textContent).toContain("Hi");
  });
});
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run src/app/rich-text-editor.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/app/rich-text-editor.tsx`:

```tsx
"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Editor } from "@tiptap/react";
import { sanitizeTemplateHtml } from "./sanitize-html";
import { isSafeHttpUrl } from "./document-link";

export interface RichTextEditorLabels {
  bold: string;
  italic: string;
  underline: string;
  heading1: string;
  heading2: string;
  bulletList: string;
  numberedList: string;
  link: string;
  unlink: string;
  linkPrompt: string;
}

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  label: string;
  mergeFields: readonly string[];
  fieldLabel: (field: string) => string;
  labels: RichTextEditorLabels;
}

const BTN = "rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-muted";
const BTN_ON = "rounded-md border border-line bg-AIPM-dark-blue px-2 py-1 text-xs text-white";

function ToolbarButton(props: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.active ?? false}
      onClick={props.onClick}
      className={props.active ? BTN_ON : BTN}
    >
      {props.label}
    </button>
  );
}

export function RichTextEditor(props: RichTextEditorProps) {
  const { value, onChange, label, mergeFields, fieldLabel, labels } = props;
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
        class:
          "min-h-40 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-AIPM-green prose-sm",
      },
    },
    onUpdate: ({ editor }: { editor: Editor }) => onChange(sanitizeTemplateHtml(editor.getHTML())),
  });

  function addLink() {
    const url = window.prompt(labels.linkPrompt, "");
    if (!url) return;
    const trimmed = url.trim();
    if (!isSafeHttpUrl(trimmed)) return;
    editor?.chain().focus().extendMarkRange("link").setLink({ href: trimmed, target: "_blank", rel: "noopener noreferrer" }).run();
  }

  return (
    <div className="flex flex-col gap-2">
      {editor && (
        <>
          <div className="flex flex-wrap gap-1">
            <ToolbarButton label={labels.bold} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
            <ToolbarButton label={labels.italic} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
            <ToolbarButton label={labels.underline} active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} />
            <ToolbarButton label={labels.heading1} active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
            <ToolbarButton label={labels.heading2} active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
            <ToolbarButton label={labels.bulletList} active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
            <ToolbarButton label={labels.numberedList} active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
            <ToolbarButton label={labels.link} active={editor.isActive("link")} onClick={addLink} />
            <ToolbarButton label={labels.unlink} onClick={() => editor.chain().focus().unsetLink().run()} />
          </div>
          <div className="flex flex-wrap gap-1">
            {mergeFields.map((field) => (
              <button
                key={field}
                type="button"
                onClick={() => editor.chain().focus().insertContent(`{{${field}}}`).run()}
                className="rounded-md border border-line px-2 py-1 text-xs text-foreground hover:bg-surface-muted"
              >
                {fieldLabel(field)}
              </button>
            ))}
          </div>
        </>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
```

(Note: `EditorContent` renders the contenteditable carrying the `aria-label`; `screen.findByLabelText(label)` resolves to it. If the test cannot find the surface because the `attributes` aria-label is applied a tick late, the `findBy*` await covers it.)

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/app/rich-text-editor.test.tsx && npx tsc --noEmit && npm run lint` → PASS / clean. If ProseMirror throws in jsdom despite the polyfills, extend the `beforeAll` stubs (add `document.createRange` returning a range with the stubbed methods) — do NOT weaken the assertions.

- [ ] **Step 5: Commit**
```bash
git add src/app/rich-text-editor.tsx src/app/rich-text-editor.test.tsx
git commit -m "feat: Tiptap rich-text editor (core toolbar + merge chips, sanitized onChange)"
```

---

### Task 3: Wire the editor into the settings pane + i18n

**Files:** Modify `src/app/settings-sections/comm-templates-section.tsx`, `src/app/settings-sections/comm-templates-section.test.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: Update the section test** — open `src/app/settings-sections/comm-templates-section.test.tsx`. At the TOP (after imports), add a mock that replaces the lazy editor with a synchronous stub, and make the merge-field test async. Replace the existing `"inserts a merge field token into the body"` test with the version below; keep the other two tests as-is.

Add near the top of the file (after the existing imports):
```tsx
import { vi } from "vitest";
vi.mock("../rich-text-editor", () => ({
  RichTextEditor: (p: {
    value: string;
    onChange: (html: string) => void;
    label: string;
    mergeFields: readonly string[];
    fieldLabel: (f: string) => string;
  }) => (
    <div>
      <textarea aria-label={p.label} value={p.value} onChange={(e) => p.onChange(e.target.value)} />
      {p.mergeFields.map((f) => (
        <button key={f} type="button" onClick={() => p.onChange(p.value + `{{${f}}}`)}>
          {p.fieldLabel(f)}
        </button>
      ))}
    </div>
  ),
}));
```
Replace the merge-field test body with (note `findByLabelText` — the editor mounts via `next/dynamic`, so it is async):
```tsx
  it("inserts a merge field token into the body", async () => {
    setup([tpl()]);
    fireEvent.click(screen.getByRole("button", { name: "Inquiry A" }));
    const body = (await screen.findByLabelText("Body")) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "Task name" }));
    expect(body.value).toContain("{{taskName}}");
  });
```
(If `setup`/`tpl` are defined inline in the existing test, keep them; only the body and the `async` keyword change. Ensure `findByLabelText` is awaited.)

- [ ] **Step 2: Run, verify the merge test fails** — `npx vitest run src/app/settings-sections/comm-templates-section.test.tsx` → the merge-field test FAILS (section still renders its own textarea/chips; `next/dynamic` editor not present). The other two tests still pass.

- [ ] **Step 3: Add i18n keys (EN via Edit)** — in `src/app/i18n.ts`, find the line `  commTplMergeFields: "Merge fields",` and insert AFTER it:
```
  commTplBold: "Bold",
  commTplItalic: "Italic",
  commTplUnderline: "Underline",
  commTplHeading1: "Heading 1",
  commTplHeading2: "Heading 2",
  commTplBulletList: "Bullet list",
  commTplNumberedList: "Numbered list",
  commTplLink: "Insert link",
  commTplUnlink: "Remove link",
  commTplLinkPrompt: "Enter a URL (https://…)",
```

- [ ] **Step 4: Add i18n keys (DE via node CRLF write)** — run with `node` (adjust the anchor if grep shows different bytes for the DE `commTplMergeFields` line):
```js
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = '  commTplMergeFields: "Platzhalter",';
if (!s.includes(anchor)) throw new Error("DE anchor not found");
if (s.includes("commTplBold")) throw new Error("DE keys already present");
const block = [
  '  commTplBold: "Fett",',
  '  commTplItalic: "Kursiv",',
  '  commTplUnderline: "Unterstrichen",',
  '  commTplHeading1: "Überschrift 1",',
  '  commTplHeading2: "Überschrift 2",',
  '  commTplBulletList: "Aufzählung",',
  '  commTplNumberedList: "Nummerierte Liste",',
  '  commTplLink: "Link einfügen",',
  '  commTplUnlink: "Link entfernen",',
  '  commTplLinkPrompt: "URL eingeben (https://…)",',
].join("\r\n");
s = s.replace(anchor, anchor + "\r\n" + block);
fs.writeFileSync(p, s, "utf8");
console.log("DE toolbar keys inserted");
```

- [ ] **Step 5: Rewrite the section body region** — in `src/app/settings-sections/comm-templates-section.tsx`:

  (a) Add `next/dynamic` import + the lazy editor at MODULE scope (after the existing imports, before `CAT_LABEL_KEY`):
```tsx
import dynamic from "next/dynamic";

const RichTextEditor = dynamic(() => import("../rich-text-editor").then((m) => m.RichTextEditor), {
  ssr: false,
  loading: () => <div className="min-h-40 rounded-md border border-line bg-surface-muted" />,
});
```
  (b) Remove the now-unused `bodyRef`, the `insertField` function, and the `import { useRef }` if `useRef` becomes unused (keep `useState`). The merge-field chip `<div>` block and the body `<textarea>` `<label>` are replaced.

  (c) Replace the selected-template body region — i.e. the merge-field chip `<div className="flex flex-col gap-1">…</div>` AND the body `<label>…<textarea/></label>` — with a single wrapper that persists on blur (focus leaving the whole editor+toolbar) and renders the lazy editor:
```tsx
          <div className="flex flex-col gap-1" onBlur={persistBody}>
            <span className="text-sm font-medium text-foreground">{t(lang, "commTplBody")}</span>
            <RichTextEditor
              key={selected.id}
              value={bodyDraft}
              onChange={setBodyDraft}
              label={t(lang, "commTplBody")}
              mergeFields={CATEGORY_FIELDS[category]}
              fieldLabel={(f) => t(lang, ("commTplField_" + f) as TranslationKey)}
              labels={{
                bold: t(lang, "commTplBold"),
                italic: t(lang, "commTplItalic"),
                underline: t(lang, "commTplUnderline"),
                heading1: t(lang, "commTplHeading1"),
                heading2: t(lang, "commTplHeading2"),
                bulletList: t(lang, "commTplBulletList"),
                numberedList: t(lang, "commTplNumberedList"),
                link: t(lang, "commTplLink"),
                unlink: t(lang, "commTplUnlink"),
                linkPrompt: t(lang, "commTplLinkPrompt"),
              }}
            />
          </div>
```
  Keep the `persistBody` function and `bodyDraft`/`selectTemplate` logic exactly as in SP1. `key={selected.id}` remounts the editor (fresh content) on template switch. The `onBlur` on the wrapper fires only when focus leaves the whole editor/toolbar group (toolbar buttons are inside the wrapper, so clicking them does not persist mid-edit).

- [ ] **Step 6: Run, verify pass** — run ALL:
```bash
npx vitest run src/app/settings-sections/comm-templates-section.test.tsx src/app/i18n-encoding.test.ts
npx tsc --noEmit
npm run lint
```
All pass; tsc proves EN/DE parity; i18n-encoding proves umlauts; lint 0 warnings (remove the now-unused `useRef` import / `bodyRef` / `insertField` — leftover symbols FAIL `--max-warnings=0`).

- [ ] **Step 7: Commit**
```bash
git add src/app/settings-sections/comm-templates-section.tsx src/app/settings-sections/comm-templates-section.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: rich-text editor in the comm-templates settings pane (lazy-loaded)"
```

---

### Task 4: Release — 0.89.0 "Bujold"

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1:** Full suite + build green:
```bash
npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```
If anything fails, STOP and fix before releasing. (Verify the editor chunk is code-split: `npm run build` output should NOT pull Tiptap into the main bundle — it loads via `next/dynamic`.)

- [ ] **Step 2:** `src/app/version.ts`: set `APP_VERSION = "0.89.0"`; update `APP_BUILD_DATE` comment to `// 0.89.0 comm templates SP2 rich editor`; set `APP_MILESTONE = "Bujold"` and update its JSDoc (`0.89.x line is "Bujold" (Lois McMaster Bujold)`). Append `"versionHighlightCommTemplatesRich"` to the END of `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 3:** EN (Edit) — in `i18n.ts`, after `  versionHighlightCommTemplates: "...",` insert:
```
  versionHighlightCommTemplatesRich: "Write communication templates in a rich editor (bold, lists, headings, links) with merge-field chips — formatting is sanitized on save.",
```
DE (node CRLF write) — anchor `  versionHighlightCommTemplates: "..."` line (grep its exact bytes first), insert after it:
```
  versionHighlightCommTemplatesRich: "Kommunikationsvorlagen in einem Rich-Text-Editor schreiben (Fett, Listen, Überschriften, Links) mit Platzhalter-Chips — Formatierung wird beim Speichern bereinigt.",
```
Verify bytes; run `npx vitest run src/app/i18n-encoding.test.ts`.

- [ ] **Step 4:** `CHANGELOG.md`: add a top entry above `## [0.88.0]`:
```
## [0.89.0] - 2026-06-15 "Bujold"

### Added / Changed
- **Communication templates rich-text editor (SP2)**: the Turso-only template
  Settings pane now edits bodies in a lazy-loaded Tiptap editor — bold, italic,
  underline, headings, bullet/numbered lists, and links — with the merge-field
  chips inline. Authored HTML is sanitized with DOMPurify on save. The body is
  still stored as HTML and flattened to plain text on send (rich HTML send
  arrives with the Graph slice). SP3 (named versions + compare/restore) is next.
```

- [ ] **Step 5:** Verify + commit:
```bash
npx vitest run && npx tsc --noEmit && npm run lint && npm run build
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "chore: release 0.89.0 comm templates SP2 rich editor"
```

---

## Final verification (before finishing)
```bash
npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```
Then **superpowers:finishing-a-development-branch**. The e2e axe gate runs in CI — the editor surface + toolbar/chip buttons must be labelled and keyboard-reachable (they are: `aria-label` on each toolbar button + the contenteditable, visible text on chips).

## Self-Review

**Spec coverage:** sanitizer (T1) ✓; Tiptap editor + core toolbar + merge chips + sanitized onChange + lazy-load (T2/T3) ✓; section swap with caret-safe remount via `key` + blur-persist (T3) ✓; i18n EN/DE toolbar keys (T3) ✓; testing — pure sanitizer test, focused editor test, section test mocks the editor (T1/T2/T3) ✓; a11y/palette (T2) ✓; release 0.89.0 (T4) ✓. Deps simplified per the verified fact that StarterKit v3 bundles Underline+Link.

**Placeholder scan:** none — every code/test/i18n block is concrete.

**Type consistency:** `RichTextEditorProps`/`RichTextEditorLabels` defined in T2 are consumed identically in T3; `sanitizeTemplateHtml(html): string` (T1) used in T2; `isSafeHttpUrl` (document-link.ts) used in T2; `CommTemplatesSectionProps` unchanged (the body still flows through `onSaveBody`). Editor labels object keys match the `RichTextEditorLabels` interface exactly.

**Adapt-to-existing notes (not placeholders):** the DE i18n anchors (`commTplMergeFields` / `versionHighlightCommTemplates`) — grep the exact bytes before the node write; the StarterKit v3 extension set (Underline/Link already included) — verified via Context7.
