# Create-Project Multi-File Upload + Loading Modal — Design

**Date:** 2026-06-29
**Status:** Approved (design)
**Branch:** `feat-create-project-multi-upload` (off `main` — the create-project wizard/step0 is independent of the Action Center slice branches)

## Problem

The create-project wizard's Step-0 file import accepts ONE file and gives only a disabled-input "busy" hint while the (10–30s) AI proposal call runs. Users want to upload MULTIPLE source documents at once, and to see a clear blocking loading modal during processing — like the Timelog import modal.

## Goals

1. Multi-file upload in Step-0 (`step0-import-panel.tsx`): read all selected files into one multimodal `ProposalContent` for a single proposal call.
2. A blocking loading modal during processing (file read + AI call), mirroring the Timelog modal, with a Cancel that truly aborts the AI call.

## Non-Goals

- No change to SharePoint/Confluence/Describe sources (single-file SP stays as-is this slice).
- No new persisted state. No change to the proposal contract beyond an optional abort signal.
- No shared `LoadingModal` extraction (only one new consumer — inline it; Timelog stays as-is. A future 3rd consumer can extract).

## Architecture

### Multi-read (`step0-import-panel.tsx` `onFile`)
- `<input type="file" multiple>`.
- Iterate `Array.from(e.target.files)`. Constants: `MAX_IMPORT_FILES = 10` (module const). For each file (up to the cap):
  - `checkAttachmentSize(file.size)` fail → record `{name, reason: "too-large"}`, skip.
  - `classifyAttachment(file.type, file.name)` null → record `{name, reason: "unsupported"}`, skip.
  - else read via `readFileData` + `buildAttachmentBlock` → push block.
- Files beyond `MAX_IMPORT_FILES` → recorded as skipped (`reason: "too-many"`).
- After the loop:
  - **0 valid blocks** → `setImportError` (all skipped) — no ingest.
  - **≥1 valid** → `content = [{ type: "text", text: t(lang,"wizardImportFilePrompt") }, ...blocks]`; set a non-blocking **skipped notice** if any were skipped; then `await onIngest(content, signal)`.
- Reads run inside the loading modal (see below); `reading` true for the whole read loop. Each `readFileData` is awaited sequentially (simpler; files are local/fast) — collect blocks in order.
- Never log file bytes.

### Skipped notice
- New state `skipped: { name: string; reason: "too-large" | "unsupported" | "too-many" }[]`.
- Rendered as a non-blocking info line (not `role=alert`; muted) listing names + a per-reason summary, e.g. `wizardImportSkippedFiles` with count + joined names. Cleared on a new selection / method change.

### Loading modal (mirrors Timelog)
- Shown while `reading || aiBusy`. Inlined in step0 (mirror `timelog-panel.tsx` lines 718–741): `<Modal open onClose={cancel} ariaLabel={…} align="center" zIndex={70}>` → a `role="status" aria-live="polite"` box with the spinner (`h-7 w-7 animate-spin rounded-full border-2 border-AIPM-dark-blue border-t-transparent`), a label, and a Cancel button (`INTERACTIVE` atom).
- Label is phase-aware: `reading` → `wizardImportReadingFiles`; else (`aiBusy`) → `wizardImportAnalyzing`.
- `Modal` already exists (`./modal`) and stacks correctly (topmost-only Escape) — the wizard is itself a modal, so this nested loading modal must be topmost while open (Modal's stack handles it).

### Abort
- `use-project-proposal.ts`: `generate(input, signal?: AbortSignal)` → pass `signal` to `fetch(..., { signal })`. In the `catch`, if `signal?.aborted` (or the error is an `AbortError` — `e instanceof DOMException && e.name === "AbortError"`), do NOT `setError` (user-initiated; return null silently); else existing error handling.
- `create-project-wizard.tsx` `runIngest(content)` → widen to `runIngest(content, signal?)` and forward `signal` to `generate(content, signal)`.
- `step0-import-panel.tsx`: own an `AbortController` (created per ingest, in a ref or local). `onIngest` prop widens to `(content, signal?) => Promise<void>`. The Cancel button in the loading modal calls `controller.abort()` (and closes the modal / resets `reading`). After abort, no error is shown (silent).
- The file-read phase: also abortable cheaply — check `signal.aborted` between file reads and bail; but the AI call is the main wait. Minimum: abort the AI call; reads are fast.

### i18n (EN + DE)
| Key | EN | DE |
|---|---|---|
| `wizardImportReadingFiles` | `Reading files…` | `Dateien werden gelesen…` |
| `wizardImportAnalyzing` | `Analyzing documents…` | `Dokumente werden analysiert…` |
| `wizardImportSkippedFiles` | `{0} file(s) skipped: {1}` | `{0} Datei(en) übersprungen: {1}` |
(Reuse existing `wizardImportFilePrompt`, `wizardImportErrorTooLarge`, `wizardImportErrorUnsupported`, `cancel`.) DE via node utf8 write (ü in übersprungen); tsc parity.

## Testing

- **`step0-import-panel.test.tsx`** (create if absent / extend): selecting 2 valid files → `onIngest` called once with a `ProposalContent` array containing 2 attachment blocks (+ the text prompt first); a mix of 1 valid + 1 too-large → ingest with 1 block + skipped-notice shows the bad name; all-invalid → error, `onIngest` not called; files beyond `MAX_IMPORT_FILES` → skipped notice; the loading modal renders while reading/aiBusy and its Cancel calls the abort. (Stub `onIngest`; stub `FileReader`/File as the existing chat-attachments tests do — check how those construct File/FileReader in jsdom.)
- **`use-project-proposal.test.tsx`**: `generate(input, signal)` passes `signal` to `fetch` (assert via the fetch mock's init.signal); an aborted signal / AbortError → returns null WITHOUT setting a user-facing error; non-abort errors still set error.
- **`create-project-wizard.test.tsx`**: `runIngest` forwards the signal to `generate` (light assertion or via the proposal hook mock).
- `npx tsc --noEmit`, `npm run lint`, `npm run test:run`. The create wizard is NOT axe-gated — eye-verify the modal (spinner + Cancel keyboard) in light/dark/Mockup.

## Acceptance

- Selecting multiple files imports them all in one proposal call; invalid ones are skipped with a clear notice; all-invalid shows an error.
- A blocking modal with a spinner + phase label shows during read + AI call; Cancel aborts the in-flight AI call and dismisses, with no error surfaced.
- Single-file behavior is preserved (one file → one block). No file bytes logged. All gates green.
