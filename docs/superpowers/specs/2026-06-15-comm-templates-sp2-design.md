# Communication Templates SP2 — Rich-Text Editor (design)

**Status:** approved (design) — 2026-06-15
**Builds on:** SP1 (v0.88.0 "Niven", `docs/superpowers/specs/2026-06-15-comm-templates-sp1-design.md`)
**Slice:** 2 of 4 (SP1 model/store/pane/send ✓ · **SP2 rich editor** · SP3 versions/compare/restore · SP5 Graph HTML send)

## Goal

Replace the SP1 plain `<textarea>` for a template body with an Outlook-like **rich-text editor** (Tiptap), keeping the stored `body` as HTML end-to-end. Sanitize authored HTML with DOMPurify at the storage boundary. The data model, Turso store, hook, and both send flows are **unchanged** — SP2 is a surface swap inside the settings pane.

## Decisions (locked in brainstorming)

1. **Editor library: Tiptap** (ProseMirror). HTML-native I/O (`getHTML()`/`setContent(html)`) matches the stored HTML `body` and `renderTemplate`/`htmlToPlainText` exactly — no conversion seam (Lexical's JSON-state would add one). Use **Tiptap v3** (supports React 19; v2 predates it).
2. **Toolbar: Core set** — bold, italic, underline; H1/H2 headings; bullet + numbered lists; link (insert/edit/remove); plus the SP1 merge-field chip palette. (Strikethrough/color/alignment/font-size deferred — they are cosmetic until SP5 because the plain-text send flattens all marks.)
3. **Sanitization: DOMPurify on save.** The editor runs `sanitizeTemplateHtml(getHTML())` before bubbling `onChange`, so the stored HTML is always clean. DOMPurify lives in the lazy editor chunk (off the main bundle).

## Key constraint carried from SP1

On send, `htmlToPlainText` flattens the body to plain text (mailto is plain-text only). **Marks (bold/italic/underline/link styling) are lost on send; structure (paragraphs, line breaks, lists, headings→text) survives.** Rich formatting is authoring-only until SP5 (Graph HTML send). This is the SP1 "HTML authoring-only" decision and is expected.

## Architecture

The `body` model, `comm-templates.ts`, `comm-templates-store.ts`, `use-comm-templates.ts`, and the two send sites (`onSendInquiry`, `handleDraftMessageFromAction`) are **untouched**. SP2 changes only the authoring surface.

### New: `src/app/sanitize-html.ts` (pure)
- `sanitizeTemplateHtml(html: string): string` — DOMPurify with an explicit allow-list matching the editor's schema: tags `p, br, strong, em, u, h1, h2, ul, ol, li, a`; attrs `href, target, rel` on `a` only; `ALLOWED_URI_REGEXP` restricted to `http/https/mailto`. Drops `<script>`, event handlers (`onclick`…), `style`, etc. Leaves `{{field}}` merge tokens (plain text) intact.
- Pure + unit-testable. Imports `dompurify` (browser build; the only consumer is the lazy editor, so DOMPurify stays in that chunk).

### New: `src/app/rich-text-editor.tsx` (`"use client"`, lazy-loaded)
- Wraps `@tiptap/react` `useEditor` with the minimal extension set: Document, Paragraph, Text, Bold, Italic, Underline, Heading (levels 1–2), BulletList, OrderedList, ListItem, History, Link. (Plan confirms v3 packaging — several may ship inside `@tiptap/starter-kit` v3; Underline/Link may be separate `@tiptap/extension-*`.)
- Props: `{ value: string /* HTML */, onChange: (html: string) => void, label: string, mergeFields: readonly string[], fieldLabel: (field: string) => string }`.
- Renders an accessible **toolbar** (Bold/Italic/Underline/H1/H2/Bullet list/Numbered list/Link/Unlink) + the **merge-field chip row** (one `<button>` per `mergeFields` entry; click → `editor.chain().focus().insertContent("{{" + field + "}}").run()`).
- `onChange` fires `onChange(sanitizeTemplateHtml(editor.getHTML()))` (on update; debounced or on blur to avoid sanitizing every keystroke — plan decides). The editor is initialized from `value` via `content`; it does **not** re-`setContent` on every `value` change (avoid caret loss) — a `key` on the selected template id remounts it when the user switches templates.
- Link insertion: prompt for URL (reuse a simple `window.prompt` + the existing `isSafeHttpUrl` guard from SP1's SharePoint work); `setLink({ href })` with `rel="noopener noreferrer"` `target="_blank"`.

### Split (if the editor file grows >~250 lines): `src/app/rich-text-toolbar.tsx`
- The toolbar buttons + active-state (`aria-pressed` from `editor.isActive("bold")` etc.). Decided in the plan by file size.

### Modify: `src/app/settings-sections/comm-templates-section.tsx`
- Replace the `<textarea>` + the manual merge-field chip block with a lazy `<RichTextEditor … />` (loaded via `next/dynamic(() => import("../rich-text-editor"), { ssr: false, loading: <fallback> })`).
- `value={bodyDraft}`, `onChange={setBodyDraft}`, persist on blur via the existing `onSaveBody(selected.id, bodyDraft)`. `mergeFields={CATEGORY_FIELDS[category]}`, `fieldLabel={(f) => t(lang, ("commTplField_" + f) as TranslationKey)}`.
- Fallback while the chunk loads: a disabled, labelled textarea showing the raw HTML (graceful, keyboard-reachable).

## Data flow (unchanged except the editor)
1. Section selects a template → `bodyDraft = template.body` (HTML).
2. `RichTextEditor` initializes Tiptap from `bodyDraft` (remounts on template switch via `key`).
3. Edit / toolbar / merge-chip → editor `onChange(sanitizeTemplateHtml(getHTML()))` → `setBodyDraft`.
4. Blur → `onSaveBody(id, bodyDraft)` → hook → `storeUpsert` (clean HTML to Turso).
5. Send flow (untouched): `resolveTemplateBody(cat)` → `renderTemplate` → `htmlToPlainText` → mailto.

## Bundle
- `next/dynamic(..., { ssr: false })` for the editor so Tiptap + DOMPurify load only when the Turso-gated pane mounts. Non-Turso / non-settings users pay nothing.
- New deps: `@tiptap/react@^3`, `@tiptap/starter-kit@^3` (+ `@tiptap/extension-underline@^3`, `@tiptap/extension-link@^3` if not in StarterKit v3), `dompurify`, `@types/dompurify` (dev). Plan verifies exact v3 extension packaging via Context7/Tiptap docs before install.

## Testing
- **`sanitize-html.test.ts`** (pure): drops `<script>`, `onerror`/`onclick`, `javascript:` href, `<style>`; keeps `<strong>/<em>/<u>/<h1>/<ul>/<li>/<a href>`; leaves `{{taskName}}` text intact; `<a>` keeps only safe http/https/mailto href + gets `rel`/`target`.
- **`rich-text-editor.test.tsx`** (focused): renders; toolbar buttons have accessible names + `aria-pressed`; the contenteditable has the `aria-label` from `label`; a Bold command toggles `aria-pressed`; a merge-field chip inserts `{{field}}`; `onChange` receives sanitized HTML. (Tiptap runs in jsdom; keep assertions to DOM presence + simple commands to avoid ProseMirror flakiness.)
- **`comm-templates-section.test.tsx`** (update): **mock `../rich-text-editor`** with a lightweight stub (a labelled textarea + a "merge" button) so the section's create/select/setDefault logic stays covered without ProseMirror. The 3 SP1 section assertions are preserved against the stub.
- e2e axe gate: editor contenteditable + toolbar buttons labelled and keyboard-operable.

## a11y / palette
- Toolbar buttons: `type="button"`, `aria-label` (i18n), `aria-pressed={editor.isActive(...)}` for togglable marks/blocks. Active style uses sanctioned tokens (`bg-AIPM-dark-blue text-white`); inactive `hover:bg-surface-muted`. No off-palette colors, shadows, or gradients.
- Contenteditable: `aria-label` from `label` (the `commTplBody` string). Focus ring `focus:ring-AIPM-green`.

## i18n (EN + DE, parity tsc-enforced; DE via node CRLF write)
New keys: `commTplBold, commTplItalic, commTplUnderline, commTplHeading1, commTplHeading2, commTplBulletList, commTplNumberedList, commTplLink, commTplUnlink, commTplLinkPrompt`. (Reuse SP1 `commTplBody`, `commTplMergeFields`, `commTplField_*`.)

## Release
- Minor bump **0.89.0** (new milestone codename — next sci-fi/fantasy author, picked in the plan). CHANGELOG entry; append `versionHighlightCommTemplatesRich` to `APP_HIGHLIGHT_KEYS` (+ EN/DE).

## Out of scope (later slices)
- Strikethrough/color/alignment/font-size (cosmetic until SP5).
- Template versions / compare / restore (SP3).
- HTML email send via Graph (SP5) — where DOMPurify + the rich body finally render as HTML.
- Image upload / tables / mentions.

## Risks
- **ProseMirror in jsdom** — mitigate by stubbing the editor in the section test and keeping the editor test to DOM-presence + simple commands.
- **Tiptap v3 ↔ React 19** — v3 supports React 19; plan confirms exact versions/extension packaging via Context7 before install.
- **Bundle** — mandatory `next/dynamic` lazy-load; verify the editor chunk is split (not pulled into the main/settings bundle).
- **Caret loss on re-render** — initialize Tiptap from `value` once and remount via `key` on template switch rather than `setContent` on every `value` change.
