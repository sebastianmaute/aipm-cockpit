# Rich-text Note Log for Tasks & RAID — Design

**Status:** Approved (2026-07-23)
**Author:** brainstorming session

## Goal

Give Tasks and RAID items a **dated, rich-text note log** managed from a shared **draggable, non-modal floating window**, and promote the task's single free-text `notes` field into a proper rich **Description**.

## Architecture

- A pure i18n-free engine (`note-log.ts`) owns all note CRUD + author-permission logic; React surfaces call it and translate.
- One reusable, draggable/resizable, non-modal window (`notes-window.tsx`) is the single CRUD surface for note logs, opened from Open Points, the RAID panel, the task editor, and the RAID edit modal.
- Rich text uses the existing Tiptap + DOMPurify stack (lean mark set). All HTML is sanitized at the storage boundary.
- `Task.notes` is renamed to `Task.description` (rich HTML) on the wire and in the type. No runtime migration / no legacy decoder — there are no active users.

## Tech Stack

`@tiptap/react` + `@tiptap/starter-kit` (already deps, trimmed to bold/italic/lists + Link), `dompurify` (already a dep, via `sanitize-html.ts`), the app's draggable-window pattern (`help-menu.tsx`) + `useResizable`.

## Identity model (decided)

The app has **no authentication**. "The user who entered a note" = whoever's per-device `settings.selfResourceId` was active at creation. "Only the author may edit/delete" is therefore an **honor-system** check, not a security boundary.

- A note is stamped `authorResourceId = selfResourceId` at creation (authorless if `selfResourceId` unset — adding is still allowed).
- **Edit/delete permitted when** `note.authorResourceId == null` **OR** `note.authorResourceId === selfResourceId`.
- **Claim-on-edit:** editing an authorless note stamps it with the current `selfResourceId` (+ `authorName`).

## End-state model

A Task carries:
- **`description`** — one rich free-text field (the renamed `notes`), edited in the task editor form.
- **`noteLog`** — dated rich note entries, managed in the floating window.

A RAID item carries:
- **`description`** — already exists, stays plain (out of scope).
- **`noteLog`** — new dated rich note entries (same window).

---

## 1. Data model (`types.ts`)

`NoteLogEntry` (additive, sparse):

```ts
export type NoteLogEntry = {
  id: number;              // NEW — stable per-note id (max+1 within the entity's noteLog). Edit/delete + React keys.
  authorResourceId?: number;
  authorName?: string;
  timestamp: string;       // ISO create instant
  editedAt?: string;       // NEW — ISO; set on edit → renders "(edited)"
  html: string;            // NEW — sanitized rich HTML body
  text: string;            // plain-text projection of html (search / export / fallback)
};
```

`Task`:
- Remove `notes: string`.
- Add `description: string` — sanitized rich HTML (lean set). Required (defaults to `""` at the editor boundary).
- `noteLog?: NoteLogEntry[]` unchanged.

`RaidItem`:
- Add `noteLog?: NoteLogEntry[]` (new heavy JSON-in-cell field). `description?` unchanged (plain).

## 2. Wire / serialization

Rename the task free-text column `notes` → `description` everywhere it is serialized, and add `noteLog` persistence for RAID.

- **Task `description`:** rename the column in `CSV_COLUMNS` (`csv-codecs-core.ts`) and the task MD table (`*_MD_COLUMNS`, `markdown-codecs-core.ts`). Turso single + tenant derive from `CSV_COLUMNS` (DDL/insert), so the rename flows through; `turso-migrate.ts` self-heals existing DBs via PRAGMA-diff `ALTER ADD COLUMN` — but since there are no active users, no special migrate edit is required beyond what the column list drives. The cell stores the **sanitized HTML string** (escaped per codec).
- **RAID `noteLog`:** add as a heavy JSON-in-cell field — `RAID_CSV_COLUMNS` + `RAID_MD_COLUMNS` (+ Turso via CSV cols), JSON + IDB whole-object pass-through. Mirror the existing task `noteLog` heavy-field handling (`heavy-fields-persistence.test.ts`, `csv-codecs-core.ts` / `csv-codecs-decode.ts` / `markdown-codecs-core.ts`).
- **No runtime migration, no legacy `notes` decoder.** Old `notes` columns are simply not read.
- **Golden fixtures + sample:** regenerate `__fixtures__/golden-*`. Edit the sample master `sample-workspace-small.md` (+ `.csv`): rename the task Notes column to Description with curated rich content, and add a couple of demo `noteLog` entries (task + RAID) to exercise the window. Regenerate `.json` / `.sqlite3` / `-big` / `-huge` via `scripts/generate-sample-workspace.ts`, then regenerate goldens.

Empty `noteLog` ⇒ byte-stable (no golden churn from the RAID field alone); the golden churn comes from the task `notes`→`description` column rename + the sample's demo content.

## 3. New modules

### `note-log.ts` (pure, i18n-free)
- `nextNoteId(log: readonly NoteLogEntry[]): number` — max id + 1.
- `addNote(log, {html, text, timestamp, self}): NoteLogEntry[]` — appends stamped entry (author from `self`, authorless if `self == null`).
- `editNote(log, id, {html, text, editedAt, self}): NoteLogEntry[]` — updates body + `editedAt`; **claims** an authorless note (stamps `authorResourceId`/`authorName` from `self`).
- `deleteNote(log, id): NoteLogEntry[]`.
- `canEditNote(note, self): boolean` — `note.authorResourceId == null || note.authorResourceId === self`.
- No `Date`/`Math.random` in the module — `timestamp`/`editedAt` passed in (minted in event handlers).

### `sanitize-html.ts` (extend)
Add `sanitizeNoteHtml(html: string): string` — DOMPurify with the **lean allowlist** (`ALLOWED_TAGS: ["p","br","strong","em","ul","ol","li","a"]`, `ALLOWED_ATTR: ["href","target","rel"]`, same end-anchored `ALLOWED_URI_REGEXP`). Reused for both `Task.description` and every `noteLog` entry.

Add `htmlToText(html: string): string` — plain-text projection for the `text` field, search index, dedup digest, exports, and the Open Points Description preview.

### `note-editor.tsx` (presentational)
Lean Tiptap editor:
- StarterKit trimmed to bold, italic, bullet list, ordered list; + Link.
- Tiny toolbar: **B / I / • / 1. / link** (each `aria-label`ed, palette-safe, `INTERACTIVE`).
- **Enter = commit** (calls `onCommit`), **Shift+Enter = newline** (default hard-break).
- jsdom needs `Range.getClientRects` + `getBoundingClientRect` stubs in tests (per AGENTS.md; comm-templates editor already establishes the pattern).
- Emits `{html, text}` (sanitized html + `htmlToText`).

### `notes-window.tsx` (presentational, props-only)
The draggable + resizable, **non-modal** window (no backdrop; does not block the app):
- Drag via the title-bar pattern from `help-menu.tsx`; size persisted via `useResizable("aipm-cockpit:notes-window-size")`.
- **Single instance** — opening for another entity re-targets the same window.
- Header: `Notes — {entity label}` + ✕. Closes on ✕ and Escape.
- Body: composer (`note-editor`) on top; entries list below, **newest-first**. Each row: author (`authorName ?? "—"`) · relative time · `(edited)` when `editedAt`; sanitized `html` rendered; **edit + delete controls shown only when `canEditNote`**; edit swaps the row to an inline `note-editor`.
- Props: `entries`, `onAdd(html,text)`, `onEdit(id,html,text)`, `onDelete(id)`, `self`, `resources`, `lang`, `entityLabel`, `open`, `onClose`. Owns no persistence — parent wires it.
- a11y: focusable, row-unique control names, labeled toolbar, palette-safe.

## 4. Surface wiring

- **Mount once** in `task-manager.tsx`: a `NotesWindow` driven by target state `{ kind: "task" | "raid", id: number } | null`. Handlers resolve the target array and dispatch CRUD via **functional setters** (`setTasks(prev => …)` / the RAID setter `setRaid(prev => …)`) — the bulk-edit landmine (N-saves-in-one-tick / stale-closure).
- **Open Points table (`task-row.tsx` / `tasks-section.tsx`):**
  - Remove the old `notes` column, `NotesCell`, its show-more + double-click inline-edit.
  - Add a **Description column** — non-expandable plain-text preview (`htmlToText`, truncated), hideable, no inline edit.
  - Add a **notes-log column** — a `🗒 N` count-badge `<button>` (row-unique `aria-label` `Notes – {task}`) opening the window for that task.
- **RAID panel (`raid-panel-rows.tsx` / toolbar):** add the same `🗒 N` badge column opening the window for that RAID item (row-unique label). RAID is axe-scanned.
- **Task editor form (`task-form-fields.tsx`):** replace the current inline note-log section with (a) a rich **Description** field (`note-editor`) and (b) a **"Notes (N)"** button opening the window. Remove the author `<select>` (author is auto = self).
- **RAID edit modal (`raid-edit-modal.tsx` / `raid-edit-fields.tsx`):** add a **"Notes (N)"** button opening the window; keep the existing (plain) description field.

## 5. Cross-cutting `notes` → `description` sweep (task only)

Mechanical rename of every `task.notes` reader/writer:
- AI tool schema `taskFields` (`chat-tool-defs.ts`): `notes` → `description`. The tool accepts **plain text**; on apply, wrap + sanitize into HTML (`<p>`-wrap → `sanitizeNoteHtml`). `noteLog` is **not** an AI tool (out of scope for AI writes this slice).
- Global search index (`global-search.ts`) — index `htmlToText(description)` + each `noteLog` entry's `text`.
- Task dedup digest (`task-dedup/…`) — use `htmlToText(description)`.
- Exports (`export-docx.ts` / `export-xlsx.ts` / `export-pptx.ts` / PDF / `export-sections.ts`) — render `htmlToText(description)` where a task's free text is emitted.
- `task-validation.ts`, `task-form-context.tsx`, `task-row.tsx`, any reports that read `task.notes`.

## 6. Security

- All HTML (description + every note) sanitized via `sanitizeNoteHtml` at the **storage boundary** (on add/edit/import), never raw.
- Rendering uses the sanitized string; if `dangerouslySetInnerHTML` is used it is only on already-sanitized content (mirrors comm-templates' defense-in-depth). Prefer the existing sanitized-render approach.
- Link URIs constrained to `https?|mailto` by the allowlist regex.
- No secrets/tokens involved.

## 7. Testing

- `note-log.test.ts` — add/edit/delete, `nextNoteId`, `canEditNote`, claim-on-edit, authorless add.
- `sanitize-html.test.ts` — note allowlist (strips disallowed tags/attrs/URIs), `htmlToText`.
- `notes-window` component test — add via Enter, Shift+Enter newline, edit, delete, author-gated controls hidden for non-author, claim on edit (jsdom Tiptap stubs).
- RAID `noteLog` persistence — `entity-persistence-registry.test.ts` + `heavy-fields-persistence.test.ts` rows.
- Golden byte-stability regenerated intentionally for the column rename + sample content.
- `npx tsc --noEmit` (i18n EN/DE parity for new keys), `npm run lint` (`--max-warnings=0`), axe on Open Points + RAID (badges labeled), size ratchet (watch `task-row.tsx` / `tasks-section.tsx` — extract if needed).

## 8. i18n

New EN + DE keys: window title, composer placeholder, toolbar labels (bold/italic/bullet/numbered/link), add/edit/delete, `(edited)`, notes-count badge label, Description column header + field label, `versionHighlight*` for the release. DE via node UTF-8 write (umlauts), key parity enforced by tsc.

## 9. Out of scope

- RAID `description` staying plain (not promoted to rich).
- Stakeholder/Resource `notes` fields (unchanged).
- AI write access to `noteLog`.
- Real per-user authentication (identity remains `selfResourceId`, honor-system).
- Multiple simultaneous note windows.

## 10. Risks / landmines

- **Functional setters** for all note CRUD (bulk-edit landmine).
- **Rich Description on the wire** — CSV/MD cells now hold escaped HTML; verify round-trip byte-stability after regen.
- **Column rename touches Turso DDL** — derived from `CSV_COLUMNS`; confirm single + tenant both pick it up.
- **Tiptap in jsdom** — Range/getClientRects stubs required or component tests silently misbehave.
- **Enter=commit inside a Tiptap editor** — intercept before the editor's default paragraph split; Shift+Enter must still hard-break (including inside lists).
- **Size ratchet** — the Open Points changes may push `task-row.tsx`; extract the badge/preview cells if it grows.
- **axe** — new badge buttons + window controls need accessible names; RAID + Open Points are scanned.
