# Communication Templates SP3 — Named Versions + Compare + Restore (design)

**Status:** approved (design) — 2026-06-15
**Builds on:** SP1 (v0.88.0 "Niven") + SP2 (v0.89.0 "Bujold")
**Slice:** 3 of 4 (SP1 model/store/pane/send ✓ · SP2 rich editor ✓ · **SP3 versions/compare/restore** · SP5 Graph HTML send)

## Goal

Let a user save **named versions** of a communication template, **compare** any two (as a rendered plain-text diff), and **restore** an earlier one (auto-snapshotting the current body first). Turso-only, in the existing template Settings pane. The live body keeps autosaving as in SP1/SP2 — versions are explicit checkpoints on top.

## Decisions (locked in brainstorming)

1. **Explicit named versions** — the user clicks "Save version" and names it; the live body continues to autosave (SP1 `saveBody`). No auto-snapshot-on-every-edit, no retention policy.
2. **Rendered plain-text diff** — compare runs a line diff over `htmlToPlainText(body)` of each side, mirroring what the recipient actually gets. Formatting-only edits (e.g. bolding a word) do not show — acceptable (cosmetic until SP5).
3. **Auto-snapshot before restore** — restoring captures the current live body as an auto-named version (`is_auto=1`) first, then overwrites the live body. Reversible; nothing silently lost.

## What is NOT reused

The existing version-history subsystem (`version-diff.ts`, `version-restore.ts`, `version-diff-view.tsx`, `version-store.ts`) is **Workspace-structural** — it diffs collections of records (`diffWorkspaces`, `COLLECTION_SPECS`, `applyRestore`) and renders field-level changes. None of it applies to diffing two HTML body strings. Only the **append-only Turso store pattern** (table kept OUT of `TABLE_NAMES`; DDL prepended each call) is reused as a pattern. There is no text-diff util or diff library in the repo — SP3 adds a small in-repo LCS line diff.

## Data model

New append-only, GLOBAL (cross-project) Turso table `comm_template_versions`, kept **OUT of `TABLE_NAMES`** (mirrors `comm_templates` / snapshots; a guard test enforces this — the workspace save's per-table DELETE must never touch it):

```
comm_template_versions (
  id          TEXT PRIMARY KEY,
  template_id TEXT,        -- FK (logical) to comm_templates.id
  name        TEXT,        -- user-given, or "Before restore — <ISO>" for auto
  body        TEXT,        -- HTML snapshot at save time
  is_auto     INTEGER,     -- 1 = auto "before restore" snapshot, 0 = user-named
  created_at  TEXT         -- ISO
)
```
`SqlArg.value` (turso-schema) is string-only even for ints → `is_auto` bound via `String(v)`.

## Architecture (new units)

### `src/app/comm-template-versions-schema.ts` (pure)
- `COMM_TEMPLATE_VERSION_DDL` (CREATE TABLE IF NOT EXISTS …).
- `versionsSelect(templateId)`, `insertVersionStatements(v)`, `deleteVersionStatements(id)`.
- `rowsToVersions(result)` — decode via the same `cols[].name` → `rows[][].value` shape as `comm-templates-schema.rowsToTemplates`.
- `CommTemplateVersion` type: `{ id, templateId, name, body, isAuto, createdAt }`.

### `src/app/comm-template-versions-store.ts`
- `loadVersions(config, templateId): Promise<CommTemplateVersion[]>` (DDL prepended; ordered by `created_at` desc).
- `saveVersion(config, v): Promise<void>` (insert).
- `deleteVersion(config, id): Promise<void>`.
- Mirrors `comm-templates-store.ts` exactly (DDL prepend, positional results after DDL).

### `src/app/text-diff.ts` (pure)
- `type DiffLine = { type: "same" | "added" | "removed"; text: string }`.
- `diffLines(before: readonly string[], after: readonly string[]): DiffLine[]` — classic LCS line diff (build the LCS table, backtrack into same/added/removed runs). No dependency.
- Used by the diff view on `htmlToPlainText(body).split("\n")` of each side.

### `src/app/use-comm-template-versions.ts` (Turso-gated hook)
- `useCommTemplateVersions({ active, config, templateId }: { active: boolean; config: TursoConfig | null; templateId: string | null })`.
- Loads versions for `templateId` when active + a templateId is set (effect keyed on `templateId`); mirrors SP1 hook gating (cfgRef, opSeq staleness guard).
- Returns `{ versions, busy, saveVersion(name, body, isAuto?), removeVersion(id), refresh }`. `saveVersion` generates `id = ${templateId}-v-${ISO}-${rand6}`, `createdAt = ISO`, persists, prepends to state.

### `src/app/comm-template-diff-view.tsx`
- Props `{ lines: DiffLine[], beforeLabel: string, removedLabel: string, addedLabel: string }` (i18n-free — labels via props, like the SP2 editor).
- Renders each line: `same` neutral, `added` green-tint row with a `+`/`aria-label` added marker, `removed` purple-tint row with `−`/`aria-label`. Sanctioned tokens only (`text-AIPM-green-strong`/`text-AIPM-purple` + `surface-muted` tints already used elsewhere; verify by eye, no off-palette). Monospace, `role="list"`/list items for screen readers, an `aria-label` summarizing counts.

### `src/app/settings-sections/comm-templates-section.tsx` (modify)
- Below the SP2 editor (still inside the selected-template block): a **Versions** area.
  - **Save version** button → `window.prompt(name)` → `versions.saveVersion(name, bodyDraft, false)`.
  - **Version list**: each row = name + `created_at` + auto-badge (when `is_auto`), a **Restore** button, and a compare-select control (checkbox/radio) plus a synthetic **Current** entry.
  - **Compare**: when exactly two of {Current, …versions} are selected → render `<CommTemplateDiffView lines={diffLines(htmlToPlainText(a).split("\n"), htmlToPlainText(b).split("\n"))} … />`. "Current" uses `bodyDraft`.
  - **Restore(version)** orchestration (section, not hook): ① `versions.saveVersion("Before restore — " + ISO, bodyDraft, true)`; ② `setBodyDraft(version.body)` + `props.onSaveBody(selected.id, version.body)`. The editor remounts via its `key={selected.id}` only on template switch — restore changes `bodyDraft` of the same template, so also bump a `restoreNonce` appended to the editor `key` (`key={selected.id + ":" + restoreNonce}`) so the editor reloads the restored content.
- The hook is instantiated by the surface that owns Turso (`task-manager.tsx`) and threaded into the section like SP1's `commTemplates` — OR, simpler, the section receives a `versions` prop bundle. **Decision:** thread a `versions` hook-result prop into `CommTemplatesSection` (keep the section prop-driven + testable, consistent with SP1).

## Data flow
1. User selects a template → section shows the SP2 editor (live `bodyDraft`) + the Versions area.
2. Save version → `saveVersion(name, bodyDraft, false)` → Turso insert → prepended to `versions`.
3. Compare two selections → pure `diffLines` over their `htmlToPlainText` → diff view.
4. Restore → auto-snapshot current (`is_auto=1`) → set `bodyDraft` + `onSaveBody` → editor remounts via the nonce'd key.
5. Send flow + the live `comm_templates.body` are untouched; versions are a side table.

## Turso gating
- `active = tursoConfig !== null && !isPopout` (same as SP1/SP2). The Versions area renders only when active. Off-Turso the whole comm-templates pane is already hidden (SP1).

## Testing
- **`text-diff.test.ts`** (pure): identical inputs → all `same`; an inserted line → one `added`; a removed line → one `removed`; a changed line → one `removed` + one `added`; empty inputs.
- **`comm-template-versions-store.test.ts`**: `comm_template_versions` NOT in `TABLE_NAMES`; `saveVersion` prepends DDL + INSERTs; `loadVersions` decodes rows after the DDL; integer `is_auto` bound as a string.
- **`use-comm-template-versions.test.tsx`**: inactive → empty, store not hit; active + templateId → loads; `saveVersion` prepends to state.
- **`comm-template-diff-view.test.tsx`**: renders added/removed/same rows with accessible markers; summarizing `aria-label`.
- **`comm-templates-section.test.tsx`** (extend): with a mocked versions bundle — Save version calls `saveVersion`; selecting Current + a version shows a diff; Restore calls `saveVersion`(auto) then `onSaveBody`. Mock `../rich-text-editor` (as SP2) to avoid ProseMirror.
- e2e axe gate: Save/Restore/Compare controls + the diff view labelled and keyboard-operable.

## a11y / palette
- Every new control (Save version, Restore, compare selectors) labelled; the diff view exposes per-line semantics (`role="list"` + item `aria-label` "added: …"/"removed: …") and a summary label. Restore is destructive-ish → no confirm needed (it auto-snapshots), but it gets a clear label.
- Only sanctioned tokens; added/removed tints reuse existing green/purple semantic tokens (no new colors, no shadow/gradient).

## i18n (EN + DE, parity tsc-enforced; DE via node CRLF write)
New keys: `commTplVersions, commTplSaveVersion, commTplVersionNamePrompt, commTplRestore, commTplRestored, commTplCompare, commTplCurrent, commTplVersionAuto, commTplVersionsEmpty, commTplDiffAdded, commTplDiffRemoved, commTplDiffSummary, commTplBeforeRestore`.

## Release
- Minor bump **0.90.0** (new milestone codename, picked in the plan). CHANGELOG + `versionHighlightCommTemplatesVersions` (EN/DE), appended to `APP_HIGHLIGHT_KEYS`.

## Out of scope (later)
- Partial / field-level restore (that's the Workspace version-history feature, not a single body).
- Diff of formatting/HTML markup (cosmetic until SP5).
- Per-template retention caps (named versions are low-volume; revisit only if needed).
- Version rename/edit (delete + re-save covers it for SP3).

## Risks
- **Editor not reloading on restore** — the SP2 editor reads `value` only as initial content; restoring the same template's body must change the editor `key` (append a `restoreNonce`) or the editor keeps the pre-restore content. Explicit in the plan.
- **Diff readability on long bodies** — line diff over plain text is fine for email-length bodies; no virtualization needed.
- **Turso write count** — Save version = 1 insert; Restore = 1 insert + 1 body upsert. Acceptable.
