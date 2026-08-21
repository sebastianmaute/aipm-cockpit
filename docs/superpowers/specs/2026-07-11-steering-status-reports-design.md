# Steering-Committee AI Status Reports — Design

**Status:** Draft for review. **Date:** 2026-07-11.

**Goal:** Each steering-committee meeting can carry an AI-drafted status report that the user edits in a rich-text editor, versions (with restore), and sends by email — one report per meeting.

**Approach:** Compose existing infrastructure. Reuses the comm-templates Tiptap editor + version-diff/restore machinery, the weekly-digest AI-narrative direct-fetch pattern, and Graph HTML send. **Zero new browser hosts, zero new secrets, zero new backend write paths beyond a Turso-only version store.**

---

## Decisions (confirmed with user)

1. **Version storage:** current report body rides the `steeringCommittee` JSON blob (all 6 backends); version snapshots live in a **Turso-gated** store (out of `TABLE_NAMES`), consistent with the app's "version history = Turso only" rule. File/IndexedDB users get draft+edit+send but not version history.
2. **Email recipients:** prefilled from the committee's members (`memberResourceIds → resource.email`), **editable** before send; members with no email are skipped with a note.
3. **AI draft basis:** project status snapshot (`DashboardModel` projection — RAG+delta, % progress, milestones due, open RAID, recent changes) **plus the meeting's `agenda`** woven into the structure.
4. **One report per meeting** (regenerate replaces the current; the prior current auto-snapshots to version history first).

---

## Data / storage

- **`CommitteeMeeting`** gains `report?: { html: string; updatedAt: string; sentAt?: string }` — the *current* report. Rides the existing `steeringCommittee` blob serialization (JSON/CSV/MD/Turso-single/Turso-tenant/IndexedDB) → **no new write path**. `sanitizeSteeringCommittee` extends: `sanitize-html` the body, length-cap, validate the dates. A committee-less workspace stays byte-stable.
- **Version snapshots:** new Turso-gated store `committee_report_versions` (out of `TABLE_NAMES`), mirroring `comm-template-versions-store.ts`/`-schema.ts`: `{ id, projectId, meetingId, html, capturedAt, label? }`. Restore writes a version's `html` back into `meeting.report` (blob) + saves. Auto-snapshot the current report before a regenerate/overwrite so nothing is lost. Turso-gated (`tursoConfig !== null`).

## AI draft (gated `isAiEnabled`)

- Pure i18n-free `committee-report/report-draft.ts` — **direct-fetch forced-tool** Anthropic call (the digest-narrative security pattern: never `callClaude`, which embeds the response body in its thrown error = leak; thrown errors carry status digits / `"parse"` only; never log/echo key or body).
- Input = the shared `buildDashboardInput(entities, ctx)` projection **+ `meeting.agenda`**. Output → sections (Exec summary · Progress · Risks/Issues · Decisions needed · Next steps) → sanitized HTML into the editor. Advisory, fully editable.

## Editor + send

- **Rich editor:** reuse the comm-templates Tiptap editor (`next/dynamic({ssr:false})`, `sanitize-html.ts`, jsdom Range/getClientRects stubs in tests).
- **Send (gated M365 configured):** build brand-inline HTML from the sanitized body (digest-email pattern, all text escaped) → Graph `sendMail`. Recipients prefilled from committee members, editable. Stamps `report.sentAt`. `mailto` fallback not needed (committee send is Graph-only, mirrors the digest).

## UI

- In `steering-committee-panel.tsx`, each meeting gets a **"Status report"** affordance opening a report pane/modal: Draft-with-AI · rich editor · Versions (list / restore / diff — Turso-only) · Recipients + Send.
- **Window-change note:** this adds UI to the steering panel. Per the confirm-before-window-changes rule, the exact placement (inline expander under the meeting row vs a dedicated modal) will be confirmed with the user at implementation-review time. Steering committee is NOT in axe `A11Y_VIEWS` → row-unique labels + a11y eye-verified.

## Gating summary

Committee opt-in (per-project) · AI draft → `isAiEnabled` · email → M365 configured · versions/restore → Turso. Each degrades independently and fail-soft. i18n EN + DE for all new strings.

## Non-goals (YAGNI)

- No portfolio-wide / multi-meeting report rollup.
- No scheduled/automatic report generation (manual "Draft with AI" only).
- No per-recipient personalization of the email body.
- No PDF export of the report (print via existing `print-root` if wanted later).

## Slicing (for the implementation plan)

- **SP1** — report model on `CommitteeMeeting` + sanitize + rich editor + manual save + Graph send (recipients from members). Works on all backends.
- **SP2** — AI "Draft with AI" (status snapshot + agenda).
- **SP3** — Turso version store + restore + diff view.

## Testing strategy

- Pure engine: `report-draft.ts` contract/transforms (validate untrusted model output), sanitize extension, version-store round-trip.
- React: editor mount (jsdom stubs), send wiring (mock Graph), version list/restore.
- Security: assert no key/body logged; sanitize-html strips scripts; recipients skip empty emails.
- i18n EN/DE parity (tsc-enforced); golden fixtures unaffected (blob-only field).
