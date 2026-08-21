# Rich-text Note Log for Tasks & RAID — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Tasks and RAID a dated **rich-text note log** managed from a shared draggable non-modal window, and promote the task's single free-text `notes` field into a rich **Description**.

**Architecture:** Pure i18n-free engine (`note-log.ts`) owns note CRUD + author permission. One reusable draggable/resizable non-modal window (`notes-window.tsx`) is the single CRUD surface, mounted once in `task-manager.tsx`. Rich text via the existing Tiptap stack (`rich-text-editor.tsx` pattern) sanitized through `sanitize-html.ts`. `Task.notes` renamed to `Task.description` (rich HTML) on wire + type; no runtime migration / no back-compat decoder.

**Tech Stack:** Next.js 16 / React 19 / TS / Tailwind v4 / Vitest 4; `@tiptap/react` + `@tiptap/starter-kit`, `dompurify`.

**Reference docs:** design spec `docs/superpowers/specs/2026-07-23-rich-text-note-log-design.md`. Key AGENTS.md rules: new heavy field byte-stable when empty; DE i18n via node UTF-8 write (CRLF, real umlauts); functional setters for entity CRUD; golden regen only for legit format change; `npx tsc --noEmit` authoritative; axe on Open Points + RAID.

---

## Identity & permission model (applies throughout)

- Author = per-device `settings.selfResourceId` at creation (authorless if unset — adding still allowed).
- `canEditNote(note, self)` = `note.authorResourceId == null || note.authorResourceId === self`.
- **Claim-on-edit:** editing an authorless note stamps it with the current `self` (+ `authorName`).
- Enter = commit, Shift+Enter = newline (composer only).

## File map

- `types.ts` — `NoteLogEntry` (+id/+html/+editedAt), `Task.notes`→`description`, `RaidItem`+`noteLog`.
- `note-log.ts` — extend: id mint + CRUD + `canEditNote`; `sanitizeNoteLog` upgrades legacy entries (mint id, derive html from text).
- `sanitize-html.ts` — `+sanitizeNoteHtml`, `+htmlToText`.
- `note-editor.tsx` (NEW) — lean Tiptap editor, `commitOnEnter?` prop.
- `notes-window.tsx` (NEW) — draggable non-modal CRUD window.
- Codecs: `csv-codecs-core.ts`, `csv-codecs-decode.ts`, `markdown-codecs-core.ts`, `markdown-codecs-decode.ts`, `turso-migrate.ts`.
- UI: `task-row.tsx`, `tasks-section.tsx`, `task-form-fields.tsx`, `raid-panel-columns.ts`, `raid-panel-rows.tsx`, `raid-panel.tsx`, `raid-edit-modal.tsx`, `task-manager.tsx`.
- Cross-cutting rename: `chat-tool-defs.ts`, `chat-tools.ts`, `use-chat-dispatcher.ts`, `use-task-submit.ts`, `task-inline-patch.ts`, `bulk-operations-helpers.ts`, `task-dedup/dedup.ts`, `global-search.ts`, `workspace-context.tsx`, `gantt.tsx`, `jira-api.ts`, `use-jira-sync.ts`, `templates.ts`, `ai-project-proposal.ts`, `action-task-seed.ts`, `use-action-center-handlers.ts`, `bulk-edit-modal.tsx`, `task-dedup-modal.tsx`.
- i18n / version / sample / goldens / tests.

---

## PHASE A — Data model + engine

### Task A1: Type changes (`types.ts`)

**Files:** Modify `src/app/types.ts` (L35-41 NoteLogEntry, L60 Task.notes, L177-223 RaidItem).

- [ ] **Step 1: Edit `NoteLogEntry`** (L35-41) to:

```ts
/** A single dated note in an entity's running note log. `id` is stable within
 *  the entity's array (max+1). `html` is sanitized rich body; `text` is the
 *  plain-text projection (search/export/fallback). Author is best-effort. */
export type NoteLogEntry = {
  id: number;
  authorResourceId?: number;
  authorName?: string;
  /** ISO timestamp when the note was recorded. */
  timestamp: string;
  /** ISO timestamp of the last edit; absent until edited → renders "(edited)". */
  editedAt?: string;
  /** Sanitized rich HTML body. */
  html: string;
  /** Plain-text projection of html. */
  text: string;
};
```

- [ ] **Step 2: Rename `Task.notes`** (L60) — replace `notes: string;` with:

```ts
  /** Rich free-text description (sanitized HTML). Renamed from the former
   *  plain `notes` field; the running dated log lives in `noteLog`. */
  description: string;
```

- [ ] **Step 3: Add `RaidItem.noteLog`** — after the `inquiriesSent?` field in RaidItem (L177-223), add:

```ts
  /** Running note log — dated rich notes. Optional + sparse; absent on legacy
   *  data. Persisted as a JSON-in-cell array across the text backends. */
  noteLog?: NoteLogEntry[];
```

- [ ] **Step 4:** `npx tsc --noEmit` — expect MANY errors (every `task.notes` reader). That's the work-list for later tasks; do not fix yet. Confirm the errors are all `notes`-related.

---

### Task A2: HTML sanitize + text projection (`sanitize-html.ts`)

**Files:** Modify `src/app/sanitize-html.ts`; Test `src/app/sanitize-html.test.ts`.

- [ ] **Step 1: Write failing tests** — append to `sanitize-html.test.ts`:

```ts
import { sanitizeNoteHtml, htmlToText } from "./sanitize-html";

describe("sanitizeNoteHtml", () => {
  it("keeps the lean mark set", () => {
    const out = sanitizeNoteHtml("<p><strong>a</strong> <em>b</em></p><ul><li>x</li></ul>");
    expect(out).toContain("<strong>a</strong>");
    expect(out).toContain("<em>b</em>");
    expect(out).toContain("<li>x</li>");
  });
  it("strips disallowed tags and scripts", () => {
    expect(sanitizeNoteHtml('<script>alert(1)</script><h1>no</h1><p>ok</p>'))
      .toBe("<p>ok</p>");
  });
  it("keeps safe links, drops javascript: urls", () => {
    expect(sanitizeNoteHtml('<a href="https://x.io">l</a>')).toContain('href="https://x.io"');
    expect(sanitizeNoteHtml('<a href="javascript:alert(1)">l</a>')).not.toContain("javascript");
  });
});

describe("htmlToText", () => {
  it("extracts plain text", () => {
    expect(htmlToText("<p><strong>Hi</strong> there</p>")).toBe("Hi there");
  });
  it("returns empty for empty", () => {
    expect(htmlToText("")).toBe("");
  });
});
```

- [ ] **Step 2: Run** `npm run test:run -- sanitize-html` → FAIL (exports missing).

- [ ] **Step 3: Implement** — add to `sanitize-html.ts` (keep existing `sanitizeTemplateHtml`):

```ts
const NOTE_ALLOWED_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li", "a"];
const NOTE_ALLOWED_ATTR = ["href", "target", "rel"];

/** Storage-boundary sanitizer for task Description + note-log HTML (lean set:
 *  bold/italic/lists/links). Mirrors the Tiptap editor schema. */
export function sanitizeNoteHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: NOTE_ALLOWED_TAGS,
    ALLOWED_ATTR: NOTE_ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):[^<>"]*$/i,
  });
}

/** Plain-text projection of sanitized HTML — for search/export/preview cells.
 *  DOMPurify with no tags yields the text content with entities decoded. */
export function htmlToText(html: string): string {
  const stripped = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  // Collapse whitespace introduced by removed block tags.
  return stripped.replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 4: Run** `npm run test:run -- sanitize-html` → PASS.
- [ ] **Step 5: Commit** `feat(notes): lean HTML sanitizer + text projection`.

> Note: `htmlToText` via DOMPurify `ALLOWED_TAGS:[]` drops tags but concatenates text nodes; block boundaries lose their space, hence the whitespace-collapse. Verify in the test that `<p>a</p><p>b</p>` → `"a b"` if a test needs it (add if flaky in jsdom).

---

### Task A3: Note-log engine (`note-log.ts`)

**Files:** Modify `src/app/note-log.ts`; Test `src/app/note-log.test.ts` (create if absent).

Current `note-log.ts` exports `sanitizeNoteLog`, `encodeNoteLog`, `decodeNoteLog` and caps `MAX_NOTE_ENTRIES=500`, `MAX_NOTE_TEXT=4000`, `MAX_AUTHOR_NAME=200`.

- [ ] **Step 1: Write failing tests** — `note-log.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextNoteId, addNote, editNote, deleteNote, canEditNote, sanitizeNoteLog } from "./note-log";
import type { NoteLogEntry } from "./types";

const base: NoteLogEntry = { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>a</p>", text: "a", authorResourceId: 7, authorName: "Sam" };

describe("nextNoteId", () => {
  it("is max+1", () => expect(nextNoteId([base, { ...base, id: 4 }])).toBe(5));
  it("is 1 for empty", () => expect(nextNoteId([])).toBe(1));
});

describe("addNote", () => {
  it("appends a stamped entry with self as author", () => {
    const out = addNote([base], { html: "<p>b</p>", text: "b", timestamp: "2026-02-02T00:00:00.000Z", self: 9, authorName: "Alex" });
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ id: 2, html: "<p>b</p>", text: "b", authorResourceId: 9, authorName: "Alex" });
  });
  it("is authorless when self is null", () => {
    const out = addNote([], { html: "<p>x</p>", text: "x", timestamp: "2026-02-02T00:00:00.000Z", self: null });
    expect(out[0].authorResourceId).toBeUndefined();
  });
});

describe("canEditNote", () => {
  it("true for matching author", () => expect(canEditNote(base, 7)).toBe(true));
  it("false for other author", () => expect(canEditNote(base, 8)).toBe(false));
  it("true for authorless", () => expect(canEditNote({ ...base, authorResourceId: undefined }, 8)).toBe(true));
});

describe("editNote", () => {
  it("updates body + editedAt for the author", () => {
    const out = editNote([base], 1, { html: "<p>z</p>", text: "z", editedAt: "2026-03-03T00:00:00.000Z", self: 7, authorName: "Sam" });
    expect(out[0]).toMatchObject({ html: "<p>z</p>", text: "z", editedAt: "2026-03-03T00:00:00.000Z", authorResourceId: 7 });
  });
  it("claims an authorless note on edit", () => {
    const authorless: NoteLogEntry = { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>a</p>", text: "a" };
    const out = editNote([authorless], 1, { html: "<p>z</p>", text: "z", editedAt: "2026-03-03T00:00:00.000Z", self: 5, authorName: "Kim" });
    expect(out[0]).toMatchObject({ authorResourceId: 5, authorName: "Kim" });
  });
});

describe("deleteNote", () => {
  it("removes by id", () => expect(deleteNote([base, { ...base, id: 2 }], 1)).toEqual([{ ...base, id: 2 }]));
});

describe("sanitizeNoteLog legacy upgrade", () => {
  it("mints ids and derives html from text for legacy entries", () => {
    const legacy = [{ timestamp: "2026-01-01T00:00:00.000Z", text: "hello" }] as unknown as NoteLogEntry[];
    const out = sanitizeNoteLog(legacy);
    expect(out[0].id).toBe(1);
    expect(out[0].text).toBe("hello");
    expect(out[0].html).toContain("hello");
  });
});
```

- [ ] **Step 2: Run** `npm run test:run -- note-log` → FAIL.

- [ ] **Step 3: Implement** — add to `note-log.ts`. Import `sanitizeNoteHtml`, `htmlToText` from `./sanitize-html` and add:

```ts
export function nextNoteId(log: readonly NoteLogEntry[]): number {
  return log.reduce((m, n) => Math.max(m, n.id ?? 0), 0) + 1;
}

export function canEditNote(note: NoteLogEntry, self: number | null | undefined): boolean {
  return note.authorResourceId == null || note.authorResourceId === self;
}

export function addNote(
  log: readonly NoteLogEntry[],
  { html, text, timestamp, self, authorName }:
    { html: string; text: string; timestamp: string; self: number | null | undefined; authorName?: string },
): NoteLogEntry[] {
  const entry: NoteLogEntry = {
    id: nextNoteId(log),
    timestamp,
    html: sanitizeNoteHtml(html),
    text,
    ...(self != null ? { authorResourceId: self } : {}),
    ...(self != null && authorName ? { authorName } : {}),
  };
  return [...log, entry];
}

export function editNote(
  log: readonly NoteLogEntry[],
  id: number,
  { html, text, editedAt, self, authorName }:
    { html: string; text: string; editedAt: string; self: number | null | undefined; authorName?: string },
): NoteLogEntry[] {
  return log.map((n) => {
    if (n.id !== id) return n;
    const claim = n.authorResourceId == null && self != null;
    return {
      ...n,
      html: sanitizeNoteHtml(html),
      text,
      editedAt,
      ...(claim ? { authorResourceId: self, ...(authorName ? { authorName } : {}) } : {}),
    };
  });
}

export function deleteNote(log: readonly NoteLogEntry[], id: number): NoteLogEntry[] {
  return log.filter((n) => n.id !== id);
}
```

- [ ] **Step 4: Upgrade `sanitizeNoteLog`** to guarantee `id`/`html` on every entry. In the existing entry-mapping, ensure: assign `id` = existing valid id else index-based mint (dedupe within the array); ensure `html` = `sanitizeNoteHtml(existing.html)` if present, else `<p>${escaped text}</p>`; keep `text` (if only html present, set `text = htmlToText(html)`); cap `html` at a new `MAX_NOTE_HTML = 20000`. Preserve `MAX_NOTE_TEXT`/`MAX_AUTHOR_NAME` caps + `MAX_NOTE_ENTRIES`. (Read the current implementation and thread these in; keep it never-throwing.)

- [ ] **Step 5: Run** `npm run test:run -- note-log sanitize-html` → PASS. `npx tsc --noEmit` will still show the codebase `notes` errors (expected).
- [ ] **Step 6: Commit** `feat(notes): note-log CRUD engine + legacy-entry upgrade`.

---

## PHASE B — Serialization

### Task B1: Rename task `notes`→`description` column in codecs

**Files:** `src/app/csv-codecs-core.ts` (L54), `src/app/csv-codecs-decode.ts` (L459), `src/app/markdown-codecs-core.ts` (L351), `src/app/markdown-codecs-decode.ts` (L350, L405).

- [ ] **Step 1:** `csv-codecs-core.ts` `CSV_COLUMNS` — replace `"notes",` (L54) with `"description",`.
- [ ] **Step 2:** `csv-codecs-decode.ts` `buildTaskFromObj` — replace `notes: obj.notes ?? "",` (L459) with `description: obj.description ?? "",`.
- [ ] **Step 3:** `markdown-codecs-core.ts` `MD_COLUMNS` — replace `{ key: "notes", label: "Notes" },` (L351) with `{ key: "description", label: "Description" },`.
- [ ] **Step 4:** `markdown-codecs-decode.ts` task inline decode — L350 `else if (norm === "notes") colMap[idx] = "notes";` → `else if (norm === "description") colMap[idx] = "description";`. L405 `notes: obj.notes ?? "",` → `description: obj.description ?? "",`.
- [ ] **Step 5:** `fieldToString` (csv-codecs-core L456-462) needs no arm — `description` falls to the `String(t[c] ?? "")` default (it's a plain HTML string cell). Confirm no `notes` case exists there.
- [ ] **Step 6:** `npm run test:run -- codecs golden` → golden tests FAIL (expected — column renamed). Leave failing until Task B5 regen.
- [ ] **Step 7: Commit** `refactor(notes): rename task notes column to description in codecs`.

### Task B2: RAID `noteLog` codec (5 additive edits)

**Files:** `src/app/csv-codecs-core.ts`, `src/app/markdown-codecs-core.ts`, `src/app/markdown-codecs-decode.ts`.

- [ ] **Step 1:** `csv-codecs-core.ts` — import already has `encodeNoteLog` (L12); add `decodeNoteLog` to that import: `import { encodeNoteLog, decodeNoteLog } from "./note-log";`.
- [ ] **Step 2:** add `"noteLog",` to `RAID_CSV_COLUMNS` (after `"inquiriesSent"`, L107).
- [ ] **Step 3:** `raidFieldToString` (L261-272) — add before the final `return`: `if (c === "noteLog") return encodeNoteLog(r.noteLog);`.
- [ ] **Step 4:** `buildRaidItemFromObj` (L323-350 return object) — add before the closing `}`:

```ts
    noteLog: (() => {
      const nl = decodeNoteLog(obj.noteLog);
      return nl.length ? nl : undefined;
    })(),
```

- [ ] **Step 5:** `markdown-codecs-core.ts` `RAID_MD_COLUMNS` (L61-84) — add `{ key: "noteLog", label: "NoteLog" },` after `inquiriesSent`.
- [ ] **Step 6:** `markdown-codecs-decode.ts` `RAID_ALIASES` (L258-273) — add `notelog: "noteLog",`.
- [ ] **Step 7:** `npx tsc --noEmit` — RAID codec errors clear. Golden still fails (Task B5). Commit `feat(raid): persist noteLog across CSV/MD/Turso`.

> Turso single + tenant + migrate self-heal are automatic (derive from `RAID_CSV_COLUMNS`/`raidFieldToString`/`buildRaidItemFromObj` per `turso-schema.ts` `ENTITY_SPECS`). JSON + IDB are whole-object pass-through — no change.

### Task B3: Turso column rename registry

**Files:** `src/app/turso-migrate.ts` (L50-52).

- [ ] **Step 1:** add to `COLUMN_RENAMES`: `{ from: "notes", to: "description" },` (after the documentLinks entry). The `want.has(to) && present.has(from) && !present.has(to)` guard makes this fire only on the `tasks` table (RAID/Change/Milestone want `description` but lack a `notes` column; Resource/Stakeholder have `notes` but don't want `description`).
- [ ] **Step 2:** `npx tsc --noEmit`; commit `feat(notes): turso self-heal renames task notes→description`.

### Task B4: Persistence tests

**Files:** `src/app/heavy-fields-persistence.test.ts`, `src/app/entity-persistence-registry.test.ts`.

- [ ] **Step 1:** In `heavy-fields-persistence.test.ts`: rename every task seed `notes: ""` (L30, L75, L95) → `description: ""`. Add a new `describe("RaidItem.noteLog persistence")` block mirroring the `Task.noteLog` block (L60-101): a `seedRaidNote` helper seeding `raid: [{ …, noteLog: [{ id:1, timestamp, html:"<p>hi | \"q\"</p>", text:"hi | \"q\"" }] }]`, with CSV round-trip, MD round-trip (comma/quote/pipe edge), and a sparse (legacy no noteLog → undefined) test, reading `back.raid[0]?.noteLog?.[0]?.text`.
- [ ] **Step 2:** In `entity-persistence-registry.test.ts`: rename task seeds `notes: ""` (L66, L149) → `description: ""`. Add `expect(RAID_CSV_COLUMNS as readonly string[]).toContain("noteLog");` and a `seedRaidNote` + CSV/MD round-trips reading `back.raid[0]?.noteLog?.[0]?.text`.
- [ ] **Step 3:** `npm run test:run -- heavy-fields entity-persistence` → PASS. Commit `test(notes): RAID noteLog persistence + rename seeds`.

### Task B5: Sample data + golden regen

**Files:** `sample-workspace-small.md`, `sample-workspace-small.csv`, `scripts/generate-sample-workspace.ts`, `src/app/__fixtures__/golden-workspace.{csv,md}`.

- [ ] **Step 1:** `sample-workspace-small.md` — rename the task table header `| … | Notes | … |` → `| … | Description | … |` (the 11th column). Content stays for now (the generator folds it — Step 3).
- [ ] **Step 2:** `sample-workspace-small.csv` `# TASKS` header — rename `notes`→`description` (do NOT touch the `notes` column in `# RESOURCES`/`# STAKEHOLDERS`). Use the app codec round-trip if editing by hand is risky (per AGENTS.md: edit .csv via `csvToWorkspace`→patch→`workspaceToCsv`).
- [ ] **Step 3:** `scripts/generate-sample-workspace.ts` — after `markdownToWorkspace(mdSource)` (L65-66), add a fold step: for each task, if `description` is non-empty, move it into a `noteLog` entry `{ id: 1, timestamp: task.lastUpdateDate, html: "<p>" + escaped + "</p>", text: description, authorless }` and set `description = ""`. Also add 2-3 demo authored `noteLog` entries on a couple tasks and a couple RAID items (author = a real resource id, distinct timestamps) so the window has content to demo. Import `sanitizeNoteHtml` if wrapping; keep deterministic (no `Date.now()`/random — use fixed ISO strings derived from existing dates).
- [ ] **Step 4:** Regenerate JSON + SQLite: `npx vite-node scripts/generate-sample-workspace.ts`.
- [ ] **Step 5:** Regenerate goldens: run a one-off vite-node script feeding `sample-workspace-small.json` → `jsonToWorkspace` → `workspaceToCsv(ws)` / `workspaceToMarkdown(ws)`, writing `src/app/__fixtures__/golden-workspace.csv` (CRLF) and `golden-workspace.md` (LF). (Preserve `.gitattributes` line endings.)
- [ ] **Step 6:** `npm run test:run -- golden` → PASS. Verify the diff is only the `notes`→`description` column rename + the demo noteLog cells (no unrelated byte drift). Commit `chore(sample): rename task notes→description, seed demo note logs, regen goldens`.

---

## PHASE C — Cross-cutting `notes`→`description` rename (logic)

> `sanitizeNotes` (`sanitize-core.ts:87`, cap 5000, shared with `Absence.note`) MUST NOT be repurposed. For task `description` (rich HTML) use `sanitizeNoteHtml`. Where a site takes plain text destined for description, wrap: `sanitizeNoteHtml("<p>" + escapeHtml(text) + "</p>")` — add a small `plainToHtml(text)` helper in `sanitize-html.ts` (escape `&<>` then wrap `<p>` with `\n`→`<br>`), and use it for AI/seed/Jira plain-text inputs.

### Task C1: plainToHtml helper + AI/form/seed writers

**Files:** `sanitize-html.ts`, `chat-tools.ts` (L262, L378), `use-chat-dispatcher.ts` (L242, L318-319), `use-task-submit.ts` (L159, L320), `task-inline-patch.ts` (L51), `bulk-operations-helpers.ts` (L51), `templates.ts` (L127), `ai-project-proposal.ts` (L245), `action-task-seed.ts` (L14-19), `use-action-center-handlers.ts` (L130).

- [ ] **Step 1:** Add `plainToHtml(text: string): string` to `sanitize-html.ts` (escape + `<p>`/`<br>` wrap → `sanitizeNoteHtml`). Add a unit test (escapes `<`, wraps, empty→"").
- [ ] **Step 2:** Rename each `notes` → `description` at the sites above. For **plain-text sources** (AI create/update, templates, ai-project-proposal, action-task-seed, dictation append), convert via `plainToHtml`. For the **form path** (`use-task-submit` L159/L320), the form now supplies HTML (Task D2) → use `sanitizeNoteHtml`. `task-inline-patch`/`bulk-operations-helpers`: these now patch `description` — the values come from the rich editor (HTML) → `sanitizeNoteHtml`.
- [ ] **Step 3:** `action-task-seed.ts` returns `{ taskName, notes }` → `{ taskName, description }` (still builds plain text; the consumer `use-action-center-handlers.ts:130` sets `description` — the form will render it; keep it plain and let the form editor wrap, OR wrap here via `plainToHtml`. Choose wrap-here for consistency). Update `action-task-seed.test.ts` assertions `seed.notes`→`seed.description`.
- [ ] **Step 4:** `npx tsc --noEmit` — these sites clear. Commit `refactor(notes): task writers use description (rich)`.

### Task C2: AI tool schema (`chat-tool-defs.ts`)

**Files:** `chat-tool-defs.ts` (L191).

- [ ] **Step 1:** In `taskFields`, replace `notes: { type: "string" as const, description: "Free-form notes" },` with `description: { type: "string" as const, description: "Free-form task description (plain text; formatting applied automatically)" },`.
- [ ] **Step 2:** Confirm the dispatcher (C1) reads `input.description` and wraps via `plainToHtml`. `npx tsc --noEmit`; commit `feat(ai): task description tool field (plain in, rich stored)`.

### Task C3: Search + dedup

**Files:** `global-search.ts` (L111), `workspace-context.tsx` (L209), `task-dedup/dedup.ts` (L61, L149, L197-198, L250-251).

- [ ] **Step 1:** `global-search.ts` L111 `coerce(t.notes)` → `coerce(htmlToText(t.description))` (import `htmlToText`). Do NOT touch L170 (resource notes).
- [ ] **Step 2:** `workspace-context.tsx` L209 `t.notes,` → `htmlToText(t.description),` (import `htmlToText`).
- [ ] **Step 3:** `task-dedup/dedup.ts`: L61 digest `tk.notes` → `htmlToText(tk.description)`; L197-198 `g.unifiedFields.notes`→`description` (sanitize via `sanitizeNoteHtml`); L250-251 `tk.notes`→`tk.description`. L149 already tolerates `description` — leave. Update `task-dedup/dedup.test.ts` (L24, L108, L135) `notes`→`description`.
- [ ] **Step 4:** `npm run test:run -- dedup global-search`; `npx tsc --noEmit`; commit `refactor(notes): search + dedup use description`.

### Task C4: Jira bridge (HTML ↔ ADF)

**Files:** `jira-api.ts` (L226, L263), `use-jira-sync.ts` (L144, L232, L267), test `use-jira-sync.test.tsx`.

- [ ] **Step 1:** `jira-api.ts` L226 (Jira→task): `notes: sanitizeNotes(adfToText(f.description))` → `description: plainToHtml(adfToText(f.description))` (import `plainToHtml`).
- [ ] **Step 2:** `jira-api.ts` L263 (task→Jira): `description: textToAdf(task.notes ?? "")` → `description: textToAdf(htmlToText(task.description ?? ""))` (import `htmlToText`).
- [ ] **Step 3:** `use-jira-sync.ts` L144/L232/L267 `notes`→`description`.
- [ ] **Step 4:** `use-jira-sync.test.tsx` conflict-picks (L512/533/556/607) `notes: "remote"` → `description: "remote"` (and any resulting expected value — Jira text becomes `<p>remote</p>` after `plainToHtml`; adjust the assertion to `htmlToText` or the wrapped form as the code dictates).
- [ ] **Step 5:** `npm run test:run -- jira`; `npx tsc --noEmit`; commit `feat(jira): bridge task description html↔ADF`.

> **Risk:** rich Description ↔ Jira plain ADF loses formatting on round-trip (HTML→text→ADF→text→HTML wraps to a single `<p>`). Accepted (Jira owns plain text). Note in CHANGELOG.

### Task C5: Gantt + remaining readers

**Files:** `gantt.tsx` (L247), plus any residual tsc errors.

- [ ] **Step 1:** `gantt.tsx` L247 `task.notes ?? ""` → `htmlToText(task.description ?? "")` (import htmlToText) — it feeds the search haystack there.
- [ ] **Step 2:** `npx tsc --noEmit` — resolve any remaining non-UI `notes` readers surfaced (next-actions fixtures are Task D/F test updates). Commit `refactor(notes): gantt + residual readers use description`.

---

## PHASE D — Rich Description UI

### Task D1: Lean note editor (`note-editor.tsx`)

**Files:** Create `src/app/note-editor.tsx`; Test `src/app/note-editor.test.tsx`.

Model on `rich-text-editor.tsx` (Tiptap StarterKit + `sanitize*` in `onUpdate`, aria textbox). Differences: lean toolbar (B / I / • / 1. / link), `sanitizeNoteHtml`, optional `commitOnEnter`.

- [ ] **Step 1: Write failing test** (`note-editor.test.tsx`) with the jsdom `Range` stubs from `rich-text-editor.test.tsx` (L6-13). Assert: renders a textbox with the aria-label; typing + toolbar bold toggles produce sanitized HTML via `onChange`; with `commitOnEnter`, pressing Enter calls `onCommit` and Shift+Enter does not.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `note-editor.tsx`:
  - `useEditor({ extensions: [StarterKit], content, immediatelyRender: false, editorProps: { attributes: { "aria-label": label, role: "textbox", "aria-multiline": "true", class: "…" }, handleKeyDown(view, event) { if (commitOnEnter && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onCommitRef.current(); return true; } return false; } }, onUpdate: ({editor}) => onChangeRef.current(sanitizeNoteHtml(editor.getHTML())) })`.
  - Toolbar: Bold, Italic, BulletList, OrderedList, Link (reuse `addLink` pattern from `rich-text-editor.tsx` L71-77 with `isSafeHttpUrl` guard). No underline/H1/H2 (lean).
  - Props: `{ value, onChange, onCommit?, commitOnEnter?, label, disabled? }`. Route `onChange`/`onCommit` through refs (mount doesn't fire).
  - Palette-safe classes + `FOCUS_RING`; toolbar buttons carry `aria-label`s.
- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(notes): lean rich-text note editor`.

### Task D2: Task form — rich Description + Notes button

**Files:** `task-form-fields.tsx` (L94-96 dictation, L107-129 composer state, L558-641 render), `task-form-context.tsx` (notes→description), `use-task-submit.ts` (already C1).

- [ ] **Step 1:** Replace the single `notes` `Textarea` block (L558-581) with a `NoteEditor` bound to `form.description` (`value={form.description}`, `onChange={(html) => setForm(p => ({...p, description: html}))}`, `commitOnEnter={false}`, `label={t(lang,"description")}`). Keep dictation: the `notesMic`/`descriptionMic` appends to the editor value via `appendDictation` (append plain text → the editor's onChange wraps; simplest: keep a dictation target that inserts text — reuse the existing mic wiring pointing at description). Update L94-96 `notes`→`description` + label key.
- [ ] **Step 2:** Replace the in-form note-log composer (L583-641) + the `noteText`/`chosenAuthor`/`addNote` state (L107-129) with a **"Notes (N)"** `<button>` that calls a new `onOpenNotes()` prop (opens the window for this task). Show `N = (form.noteLog ?? []).length`. Remove the author `<select>` and the plain composer entirely.
- [ ] **Step 3:** `task-form-context.tsx` — rename any `notes` field references → `description`; ensure `emptyForm()`/draft carries `description: ""`.
- [ ] **Step 4:** Thread `onOpenNotes` from the task editor host down to `task-form-fields` (the floating TaskFormModal in `app-modals.tsx` → task-manager provides it; wire in Task E2).
- [ ] **Step 5:** `npx tsc --noEmit`; commit `feat(notes): rich Description field + Notes button in task form`.

### Task D3: Open Points row (`task-row.tsx`)

**Files:** `task-row.tsx`.

- [ ] **Step 1:** Remove the `notes` column cell (L609-617), `NotesCell`/`NotesCellImpl` (L642-673), `summarizeNote` (L125-155), `NOTES_COLLAPSED_MAX`, the `"notes"` arm of `renderInlineTextarea`/`InlineField`, and `onToggleNoteExpanded`/`isExpanded` usage tied to notes.
- [ ] **Step 2:** Add a **Description** cell (gated `!hiddenCols.has("description")`): a non-expandable truncated plain preview — `<Td className="max-w-xs truncate text-muted-foreground" title={htmlToText(task.description)}>{htmlToText(task.description) || "—"}</Td>`. No inline edit.
- [ ] **Step 3:** Add a **noteLog badge** cell (gated `!hiddenCols.has("notesLog")`): a `<button aria-label={`${t(lang,"noteLogTitle")} – ${task.taskName}`} onClick={() => onOpenNotes(task.id)}>` rendering `🗒 {n}` (use a heroicon + count; n = `task.noteLog?.length ?? 0`). Row-unique label.
- [ ] **Step 4:** `RowContextValue` — add `onOpenNotes: (id: number) => void`; remove note-expand fields no longer used (keep `onToggleNoteExpanded` only if still used elsewhere — grep; if solely for notes, remove).
- [ ] **Step 5:** `npx tsc --noEmit`; commit `feat(notes): Open Points description preview + notes badge`.

### Task D4: Open Points columns (`tasks-section.tsx`)

**Files:** `tasks-section.tsx` (L60-80 col constants, L389-436 rowContextValue, L865-896 headers, L854-864 colgroup), `use-column-manager.ts` (DEFAULT_COL_WIDTHS).

- [ ] **Step 1:** `ALL_TASK_COLS` — replace `"notes"` with `"description"` and add `"notesLog"` (place after `description`).
- [ ] **Step 2:** `CONFIGURABLE_COLS` — replace `{ key: "notes", labelKey: "notes" }` with `{ key: "description", labelKey: "description" }` and add `{ key: "notesLog", labelKey: "noteLogTitle" }`.
- [ ] **Step 3:** Header `<thead>` (L887-888) — rename the notes `<Th>` to description; add a `notesLog` header (`t(lang,"noteLogTitle")`). `<colgroup>` widths follow `ALL_TASK_COLS`; add default widths for `description`/`notesLog` in `use-column-manager.ts` `DEFAULT_COL_WIDTHS`.
- [ ] **Step 4:** `rowContextValue` useMemo (L389-436) — add `onOpenNotes` to the object + deps + `TasksSectionProps` + destructure. Thread `onOpenNotes` from task-manager (Task E2).
- [ ] **Step 5:** `npx tsc --noEmit`; commit `feat(notes): Open Points description + notes-log columns`.

---

## PHASE E — Floating notes window

### Task E1: `notes-window.tsx`

**Files:** Create `src/app/notes-window.tsx`; Test `src/app/notes-window.test.tsx`.

Clone the draggable-window mechanics from `help-menu.tsx` (pos state, `useResizable("aipm-cockpit:notes-window-size")`, `onTitleBarMouseDown` drag, Escape close, `resize overflow-auto` panel, ✕ + ResetSizeButton). Controlled by external `open`/`onClose` (not self-triggering).

- [ ] **Step 1: Write failing test** (`notes-window.test.tsx`, with Tiptap jsdom stubs). Props render N entries; typing + Enter calls `onAdd(html,text)`; an entry authored by `self` shows edit+delete, one by another author does not; editing an authorless entry then saving calls `onEdit`; delete calls `onDelete(id)`; Escape calls `onClose`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement:**
  - Props: `{ open, onClose, entries: readonly NoteLogEntry[], onAdd(html,text), onEdit(id,html,text), onDelete(id), self: number|null|undefined, resources: readonly Resource[], lang, entityLabel: string }`.
  - Header: `t(lang,"noteLogTitle") + " — " + entityLabel`, ✕ (`XMarkIcon`, `aria-label` close), ResetSizeButton.
  - Composer: `NoteEditor commitOnEnter` → on commit, sanitize + `htmlToText` → `onAdd`; clear via a nonce/key reset.
  - Entries list (newest-first): author name (`authorName ?? resource lookup ?? "—"`) · `formatDisplayTimestamp`-style time · `(edited)` when `editedAt`; body rendered from `note.html` (already sanitized — render via a small `NoteBody` that sets sanitized html, mirroring comm-templates render). `canEditNote(note, self)` gates Edit/Delete buttons (row-unique aria-labels). Edit swaps the row to an inline `NoteEditor` (commit → `onEdit`).
  - Position/drag/clamp identical to help-menu; storage keys `aipm-cockpit:notes-window-pos` + `...-size`.
- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(notes): draggable non-modal notes window`.

### Task E2: Mount + wire in `task-manager.tsx`

**Files:** `task-manager.tsx` (setters L250-269, modalsBlock L2561-2668, raid handlers L610-626).

- [ ] **Step 1:** Add state `const [notesTarget, setNotesTarget] = useState<{ kind: "task" | "raid"; id: number } | null>(null);`.
- [ ] **Step 2:** Derive the live entries + handlers:
  - `const notesEntries = notesTarget?.kind === "task" ? (tasks.find(t => t.id === notesTarget.id)?.noteLog ?? []) : notesTarget?.kind === "raid" ? (raid.find(r => r.id === notesTarget.id)?.noteLog ?? []) : [];`
  - `onAdd`/`onEdit`/`onDelete` dispatch to the right array via **functional setters**: for tasks `setTasks(prev => prev.map(t => t.id === id ? { ...t, noteLog: addNote(t.noteLog ?? [], {...}) } : t))` (same for edit/delete + raid via `setRaid`). Timestamps minted here (`new Date().toISOString()` — event handler, not render). `self = settings.selfResourceId`; `authorName` from `resources`. Stamp `localModifiedAt` on the entity. Log activity if the app logs entity edits (mirror existing patterns).
  - Guard popouts: if `isPopout`, the window is read-only (pass `self`/handlers as undefined or a read-only flag). Simplest: don't mount in popout.
- [ ] **Step 3:** Mount `<NotesWindow open={notesTarget != null} onClose={() => setNotesTarget(null)} entries={notesEntries} … entityLabel={…} />` inside `modalsBlock` (renders in all non-popout layouts).
- [ ] **Step 4:** Provide `onOpenNotes`:
  - Tasks: pass `(id) => setNotesTarget({ kind: "task", id })` into `tasks-section` (→ rowContextValue) AND into the task form modal (`app-modals.tsx` → `task-form-fields` "Notes (N)" button) — for the form, target the currently-edited task id.
  - RAID: pass `(id) => setNotesTarget({ kind: "raid", id })` via `workspace-section` → `raid-panel` (Task E3).
- [ ] **Step 5:** `npx tsc --noEmit`; commit `feat(notes): mount shared notes window + task/raid CRUD wiring`.

### Task E3: RAID surfaces

**Files:** `raid-panel-columns.ts`, `raid-panel-rows.tsx`, `raid-panel.tsx`, `raid-edit-modal.tsx`, `workspace-section.tsx` + `workspace-section-types.ts` (thread `onOpenNotes`).

- [ ] **Step 1:** `raid-panel-columns.ts` — add `notesLog: 90` to `RAID_COL_WIDTHS` and `{ key: "notesLog", labelKey: "noteLogTitle" }` to `RAID_CONFIG_COLS`.
- [ ] **Step 2:** `raid-panel-rows.tsx` — add a `notesLog` header cell (gated `!hiddenSet.has("notesLog")`, `ColumnResizeHandle col="notesLog"`) and a body cell with a `🗒 N` button (`onClick={e => { e.stopPropagation(); onOpenNotes(item.id); }}` — stopPropagation so the row's `openEdit` doesn't also fire; row-unique aria-label). Bump the empty/add-row `colSpan`. Add `onOpenNotes` to `RaidTableProps`.
- [ ] **Step 3:** `raid-panel.tsx` — add `onOpenNotes` to `RaidPanelProps`, thread to `<RaidTable>`.
- [ ] **Step 4:** `raid-edit-modal.tsx` — add a **"Notes (N)"** button in the modal body (near description) calling an `onOpenNotes(item.id)` prop (N = `item.noteLog?.length ?? 0`).
- [ ] **Step 5:** `workspace-section-types.ts` + `workspace-section.tsx` — thread `onOpenNotes` from task-manager → raid-panel (+ the edit modal).
- [ ] **Step 6:** `npx tsc --noEmit`; commit `feat(notes): RAID notes badge column + editor button`.

---

## PHASE F — i18n, version, tests, gates

### Task F1: i18n

**Files:** `i18n.ts`, `i18n.de.ts` (CRLF; DE via node UTF-8 write, real umlauts).

- [ ] **Step 1:** Add EN keys: `description: "Description"`, `noteLogEdit: "Edit note"`, `noteLogDelete: "Delete note"`, `noteLogEdited: "(edited)"`, `noteLogOpen: "Notes"`, `noteLogCount: "Notes ({0})"`, plus editor toolbar labels (`rtBold`/`rtItalic`/`rtBulletList`/`rtNumberedList`/`rtLink` — reuse existing rich-text-editor label keys if present; else add). Keep existing `notes`/`noteLog*` keys (still referenced by resource/stakeholder/absence + the log title).
- [ ] **Step 2:** Add the matching DE keys via node UTF-8 script (`Beschreibung`, `Notiz bearbeiten`, `Notiz löschen`, `(bearbeitet)`, `Notizen`, `Notizen ({0})`, toolbar labels). Verify with grep; run `npm run test:run -- i18n-encoding`.
- [ ] **Step 3:** `npx tsc --noEmit` (EN/DE key parity enforced). Commit `i18n(notes): description + note-log window strings (EN/DE)`.

### Task F2: Version + changelog

**Files:** `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1:** Bump `APP_VERSION` (next patch/minor — this is a feature → **minor**, e.g. `0.196.0`), update `APP_BUILD_DATE`, append `versionHighlightRichNotes` (+ EN/DE strings) and `versionHighlightTaskDescription` to `APP_HIGHLIGHT_KEYS` + i18n.
- [ ] **Step 2:** `CHANGELOG.md` — new entry (Added: rich note log + floating window on tasks & RAID; Changed: task notes → rich Description; note the Jira plain-text round-trip caveat).
- [ ] **Step 3:** `npx tsc --noEmit`; commit `chore(release): rich note log + task description`.

### Task F3: Fix broken tests

**Files:** `action-task-seed.test.ts`, `bulk-operations-helpers.test.ts`, `task-dedup/dedup.test.ts`, `task-inline-patch.test.ts`, `reports.test.tsx`, `use-jira-sync.test.tsx`, `next-actions/index.test.ts`, `next-actions/providers/{milestone,task-attention,task-due}.test.ts`, `task-form-fields.test.tsx`, plus any others surfaced.

- [ ] **Step 1:** Update every task fixture/assertion `notes`→`description` (and value expectations where `plainToHtml` now wraps). Task fixtures setting `notes: ""` → `description: ""`. Do NOT touch `noteLog`-specific tests except where they assert the removed in-form composer (task-form-fields.test.tsx L166-193 — update to the new "Notes (N)" button behavior).
- [ ] **Step 2:** `npm run test:run` → full green. Commit `test(notes): update fixtures for description rename + window`.

### Task F4: Gates

- [ ] **Step 1:** `npx tsc --noEmit` (0 errors).
- [ ] **Step 2:** `npm run lint` (`--max-warnings=0`; watch unused imports after removals, `obj.member` deps hoisting, no `set-state-in-effect`, purity `new Date()`).
- [ ] **Step 3:** `npm run test:run` (coverage floors; the new `.ts` engines are covered — `notes-window.tsx`/`note-editor.tsx` are `.tsx` UI, coverage-exempt).
- [ ] **Step 4:** `npm run size:check` (watch `task-row.tsx`/`tasks-section.tsx`/`task-form-fields.tsx` — extract cells/sections if over ratchet).
- [ ] **Step 5:** `npm run dup:check` (the RAID badge cell mirrors the task one — extract a shared `NotesBadgeButton` if jscpd flags it).
- [ ] **Step 6:** axe: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"` and `-g "RAID"` (badge buttons + window controls labeled). The notes window is not in `A11Y_VIEWS` — eye-verify focus/contrast.
- [ ] **Step 7:** Commit any gate fixes. Final review before merge (superpowers requesting-code-review) per standing rule.

---

## Landmines (carry into every task)

- **Functional setters** for all note CRUD (`setTasks(prev=>…)`/`setRaid(prev=>…)`) — the bulk-edit N-in-one-tick / stale-closure trap.
- **Do not touch `noteLog`-unrelated `notes`** (Resource/Stakeholder/ProjectMeta/Absence) or `sanitizeNotes` (shared with Absence).
- **`new Date()` only in event handlers**, never render (purity rule).
- **Tiptap in jsdom** needs `Range.getClientRects`/`getBoundingClientRect` stubs in every component test.
- **Enter=commit** must `preventDefault` before Tiptap's paragraph split; Shift+Enter still hard-breaks.
- **DE i18n** via node UTF-8 write (CRLF anchors, real umlauts); tsc enforces EN/DE parity.
- **Golden regen** only after the sample legitimately changed; verify the diff is scoped.
- **RAID row badge** must `stopPropagation` (row click opens the edit modal).
- **Size ratchet** on the three fat task files after adds/removes.
- **Jira round-trip** rich→plain is lossy by design — documented.
- **stakeholder/resource `notes` columns** in sample `.csv` (`# RESOURCES`, `# STAKEHOLDERS`) must NOT be renamed.
