# Steering-Committee AI Status Reports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. FEATURE branch off `main` (e.g. `feat/steering-status-reports`). NOT a release until the user says "release".

**Goal:** Each steering-committee meeting can carry an AI-drafted status report the user edits (rich text), versions (restore/diff, Turso-only), and emails to committee members — one report per meeting.

**Architecture:** Compose existing infra. `CommitteeMeeting.report` rides the existing `steeringCommittee` JSON blob (ZERO new write paths). AI draft = a direct-fetch forced-tool call mirroring `digest/digest-narrative.ts` (never `callClaude` — it leaks the body). Rich editor = existing `RichTextEditor` (`rich-text-editor.tsx`, Tiptap, `ssr:false`). Send = `graph-mail.ts` `sendMail`. Versions = a Turso store mirroring `comm-template-versions-*` (out of `TABLE_NAMES`).

**Tech stack:** forked Next.js/React/TS; vitest; GitLab CI (tsc · eslint `--max-warnings=0` · size ratchet · dup · axe). Design tokens only; i18n EN+DE parity (tsc-enforced).

---

## Reference (verified signatures — do not re-derive)

- **Version store to mirror:** `comm-template-versions-schema.ts` (`CommTemplateVersion`, `COMM_TEMPLATE_VERSION_DDL`, `versionsSelect`/`insertVersionStatements`/`deleteVersionStatements`/`rowsToVersions`) + `comm-template-versions-store.ts` (`loadVersions`/`saveVersion`/`deleteVersion` over `runTursoPipeline(config, [...ddl(), ...stmt])`; `null` config throws → gate on `tursoConfig !== null`). Diff: `text-diff.ts` `diffLines(before, after): DiffLine[]`; view `comm-template-diff-view.tsx`.
- **Committee:** `types.ts:230` `CommitteeMeeting {id,date,title,agenda?,location?,outlookEventId?}`. Validator `sanitize-records.ts:477` `sanitizeSteeringCommittee`; meeting decode `flatMap` at L485-496 (`str`/`isDate` locals). Blob persistence = 6 paths via the `steering_committee` meta blob — **adding a nested field needs ONLY `types.ts` + `sanitizeSteeringCommittee`; no column, no golden regen.**
- **Panel:** `steering-committee-panel.tsx` props (L65-77): `{lang, committee, onChange, resources, today, outlookPush?, showHints?, isPopout?, onLearnMore?}`. Setter = `onChange` (whole-committee immutable replace); `patchMeeting(id, patch)` (L143); `update(patch)` (L110). Meeting `<tr>` rows L282-315. Push-to-Outlook section L454-466 (model for a gated per-meeting button). **NO AI/Turso/M365 props today — must thread new ones from `task-manager.tsx` → `workspace-section.tsx` → panel (mirror the `outlookPush` bag).** Mounted once in `workspace-section.tsx`.
- **AI:** `digest/digest-narrative.ts` `runDigestNarrative` — direct `fetch("https://api.anthropic.com/v1/messages")`, headers incl. `anthropic-dangerous-direct-browser-access:"true"`, body `tool_choice:{type:"tool",name:…}`, `if(!res.ok) throw new Error(String(res.status))`, parse `tool_use` block, output sanitizer strips `/[\x00-\x1f]/g`. `settings-types.ts:110` `isAiEnabled(ai)` / `aiKeyIfEnabled(ai)`. `ANTHROPIC_VERSION="2023-06-01"`.
- **Editor:** `rich-text-editor.tsx` `RichTextEditor({value,onChange,label,mergeFields,fieldLabel,labels})`; `onChange` already runs `sanitizeTemplateHtml`. Dynamic import pattern in `comm-templates-section.tsx:19`. Sanitizer `sanitize-html.ts` `sanitizeTemplateHtml(html)` (DOMPurify, browser-only). jsdom stubs (`Range.prototype.getClientRects`/`getBoundingClientRect`) in `rich-text-editor.test.tsx:6-13`.
- **Email:** `graph-mail.ts` `buildGraphMessage(to,subject,htmlBody)` (SINGLE recipient) + `sendMail(token,msg)` (`POST /me/sendMail`), `MAIL_SEND_SCOPE=["Mail.Send"]`, `class GraphMailError`. Connector wiring model: `digest/digest-card-connected.tsx` (`useMsAuth`, `acquireToken`, `useToastContext`). `Resource.email?` optional.
- **Dashboard:** `dashboard.ts` `buildDashboardInput(entities, ctx): DashboardInput` + `computeDashboard(input): DashboardModel` (fields: `overall/schedule/budget/scope.{effective}`, `progress`, `topChanges`, `topRaid`/`openRaidCount`, `overdue`/`dueSoon`, milestone buckets, `recentActivity`).
- **Release:** `version.ts` (`APP_VERSION`/`APP_MILESTONE`/`APP_HIGHLIGHT_KEYS`), `i18n.ts`+`i18n.de.ts` (DE via node UTF-8 write + `\uXXXX` + CRLF `\r\n` anchors; `i18n-encoding` bans ASCII umlaut subs; positional `{0}`).

## File structure

- `types.ts` — MODIFY: `MeetingReport` type + `CommitteeMeeting.report?`.
- `sanitize-records.ts` — MODIFY: `sanitizeMeetingReport` + wire into meeting decode.
- `graph-mail.ts` — MODIFY: `buildGraphMessage` accepts `string | readonly string[]`.
- `committee-report/report-recipients.ts` — CREATE: pure `committeeMemberEmails(committee, resources)`.
- `committee-report/report-draft.ts` — CREATE: tool schema + `parseMeetingReport` + `buildMeetingReportPrompt`.
- `committee-report/report-call.ts` — CREATE: `runMeetingReport` (direct fetch).
- `committee-report-versions-schema.ts` / `-store.ts` — CREATE: Turso version store (mirror comm-template-versions-*).
- `meeting-report-panel.tsx` — CREATE: the report pane (rich editor + AI draft + versions + send), presentational.
- `use-meeting-report.ts` — CREATE: AI-generate state machine hook.
- `steering-committee-panel.tsx` / `workspace-section.tsx` / `workspace-section-types.ts` / `task-manager.tsx` — MODIFY: thread the `report` prop bag + connected handlers.
- `i18n.ts` / `i18n.de.ts` / `version.ts` / `CHANGELOG.md` — MODIFY: strings + release.

---

# SLICE 1 — Report model + rich editor + manual save + email (all backends)

### Task 1: `MeetingReport` model + sanitizer (persistence is free)

**Files:** `types.ts`, `sanitize-records.ts`, `sanitize.test.ts` (or `sanitize-records.test.ts`).

- [ ] **Step 1 — failing test** (`sanitize-records.test.ts`): a committee whose meeting carries a `report` round-trips through `sanitizeSteeringCommittee`; an oversized body is capped; a bad `report` (non-object / missing html) is dropped; `updatedAt`/`sentAt` non-date dropped.

```ts
import { sanitizeSteeringCommittee } from "./sanitize";
test("keeps a valid meeting report and caps the body", () => {
  const out = sanitizeSteeringCommittee({
    name: "SC", memberResourceIds: [], infoSchedules: [],
    meetings: [{ id: 1, date: "2026-06-01", title: "M1",
      report: { html: "<p>hi</p>", updatedAt: "2026-05-30T10:00:00.000Z", sentAt: "2026-05-31T09:00:00.000Z" } }],
  });
  expect(out?.meetings[0].report).toEqual({ html: "<p>hi</p>", updatedAt: "2026-05-30T10:00:00.000Z", sentAt: "2026-05-31T09:00:00.000Z" });
});
test("drops a report with no html and caps an oversized body", () => {
  const big = "x".repeat(200_000);
  const out = sanitizeSteeringCommittee({ name: "SC", memberResourceIds: [], infoSchedules: [],
    meetings: [
      { id: 1, date: "2026-06-01", title: "M1", report: { foo: 1 } },
      { id: 2, date: "2026-06-02", title: "M2", report: { html: big, updatedAt: "2026-05-30T10:00:00.000Z" } },
    ] });
  expect(out?.meetings[0].report).toBeUndefined();
  expect(out?.meetings[1].report?.html.length).toBe(100_000);
});
```

- [ ] **Step 2 — run, verify RED** (`report` doesn't exist yet → type + assertion fail).

- [ ] **Step 3 — types** (`types.ts`, beside `CommitteeMeeting`):

```ts
/** A per-meeting status report (current version). Rides the steeringCommittee
 *  JSON blob — no new write path. `html` is sanitized rich text. */
export interface MeetingReport {
  html: string;
  updatedAt: string;   // ISO
  sentAt?: string;     // ISO — set when last emailed
}
```
Add `report?: MeetingReport;` to `CommitteeMeeting`.

- [ ] **Step 4 — sanitizer** (`sanitize-records.ts`). Add above `sanitizeSteeringCommittee` (uses the file's local `isDate`; add a cap const):

```ts
const REPORT_HTML_MAX = 100_000;
function sanitizeMeetingReport(raw: unknown): MeetingReport | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.html !== "string" || r.html.trim() === "") return undefined;
  if (typeof r.updatedAt !== "string") return undefined;
  const out: MeetingReport = { html: r.html.slice(0, REPORT_HTML_MAX), updatedAt: r.updatedAt };
  if (typeof r.sentAt === "string") out.sentAt = r.sentAt;
  return out;
}
```
NOTE: do NOT call `sanitizeTemplateHtml` (DOMPurify) here — `sanitize-records.ts` is pure/SSR-safe; the editor's `onChange` and the AI-draft path already sanitize at write time. This is a defensive cap + shape check only. Import `MeetingReport` from `./types`.

- [ ] **Step 5 — wire into meeting decode** (`sanitize-records.ts`, inside the `meetings` `flatMap`, after the `outlookEventId` guard):

```ts
      const report = sanitizeMeetingReport(mm.report);
      if (report) out.report = report;
```

- [ ] **Step 6 — run tests → GREEN.** Then `npx tsc --noEmit` (no golden regen — blob field).

- [ ] **Step 7 — commit:** `feat(steering): add per-meeting MeetingReport model (rides the committee blob)`

### Task 2: multi-recipient Graph message + committee-email resolver

**Files:** `graph-mail.ts`, `graph-mail.test.ts`, `committee-report/report-recipients.ts`, `committee-report/report-recipients.test.ts`.

- [ ] **Step 1 — failing test** (`report-recipients.test.ts`):

```ts
import { committeeMemberEmails } from "./report-recipients";
test("resolves member emails, skips members with none", () => {
  const committee = { name: "SC", memberResourceIds: [1, 2, 3], meetings: [], infoSchedules: [] };
  const resources = [
    { id: 1, firstName: "A", lastName: "", roleId: null, utilizationMode: "percent", utilization: {}, email: "a@x.com" },
    { id: 2, firstName: "B", lastName: "", roleId: null, utilizationMode: "percent", utilization: {} }, // no email
    { id: 3, firstName: "C", lastName: "", roleId: null, utilizationMode: "percent", utilization: {}, email: "c@x.com" },
  ];
  expect(committeeMemberEmails(committee as never, resources as never)).toEqual(["a@x.com", "c@x.com"]);
});
```

- [ ] **Step 2 — verify RED.**

- [ ] **Step 3 — implement** (`committee-report/report-recipients.ts`, pure i18n-free):

```ts
import type { SteeringCommittee, Resource } from "../types";
/** Committee members' emails (deduped, members with no email skipped). */
export function committeeMemberEmails(
  committee: SteeringCommittee, resources: readonly Resource[],
): string[] {
  const byId = new Map(resources.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of committee.memberResourceIds) {
    const email = byId.get(id)?.email?.trim();
    if (email && !seen.has(email.toLowerCase())) { seen.add(email.toLowerCase()); out.push(email); }
  }
  return out;
}
```
(Directory path is `committee-report/` → `../types`.)

- [ ] **Step 4 — graph-mail multi-recipient test** (`graph-mail.test.ts`): `buildGraphMessage(["a@x.com","b@x.com"], s, h)` produces two `toRecipients`; a single string still produces one (back-compat).

- [ ] **Step 5 — widen `buildGraphMessage`** (`graph-mail.ts`):

```ts
export function buildGraphMessage(
  to: string | readonly string[], subject: string, htmlBody: string,
): GraphMessage {
  const list = (Array.isArray(to) ? to : [to]).filter((a) => a.trim() !== "");
  return {
    message: {
      subject,
      body: { contentType: "HTML", content: htmlBody },
      toRecipients: list.map((address) => ({ emailAddress: { address } })),
    },
    saveToSentItems: true,
  };
}
```
(Adjust to the file's actual `GraphMessage` shape — keep existing single-string callers working.)

- [ ] **Step 6 — run graph-mail + recipients tests → GREEN; `npx tsc --noEmit`** (check existing `buildGraphMessage` callers still typecheck).

- [ ] **Step 7 — commit:** `feat(graph-mail): multi-recipient message + committee email resolver`

### Task 3: report pane component (editor + save + send scaffold)

**Files:** `meeting-report-panel.tsx`, `meeting-report-panel.test.tsx`.

Presentational, props-only (no context — steering panel is unit-tested outside providers). AI-draft + versions wired in later slices via optional props.

- [ ] **Step 1 — props + failing test** (`meeting-report-panel.test.tsx`, with the jsdom Range stubs from `rich-text-editor.test.tsx:6-13`): renders the editor seeded with `report?.html`; clicking Save calls `onSave(html)`; Send button disabled when `!m365Configured`; when enabled, clicking Send calls `onSend()`.

```ts
export interface MeetingReportPanelProps {
  lang: Lang;
  meeting: CommitteeMeeting;
  report: MeetingReport | undefined;
  onSave: (html: string) => void;
  onSend: () => void;
  m365Configured: boolean;
  sendBusy?: boolean;
  isPopout?: boolean;
  // Slice 2:
  onGenerate?: () => void;       // "Draft with AI"
  generateBusy?: boolean;
  aiConfigured?: boolean;
  // Slice 3:
  versions?: MeetingReportVersionUi[];  // list/restore/diff (Turso-only)
  onRestore?: (versionId: string) => void;
}
```

- [ ] **Step 2 — verify RED.**

- [ ] **Step 3 — implement.** Dynamic-import `RichTextEditor` (`ssr:false`, mirror `comm-templates-section.tsx:19`). Local draft `useState(report?.html ?? "")`; render-time reconcile to a new `report?.updatedAt` (NOT set-state-in-effect — use the nonce/last-seen guard). Buttons: "Draft with AI" (gated `aiConfigured && onGenerate`, busy label), Save (`onSave(draft)`), Send (gated `m365Configured`, busy `sendBusy`). Versions list gated `versions?.length` (Slice 3). `mergeFields=[]`, `fieldLabel={(f)=>f}`. All labels from i18n. Palette tokens only; row-unique a11y labels (steering NOT in axe gate → eye-verify).

- [ ] **Step 4 — run → GREEN. `npx tsc --noEmit` (test edits).**

- [ ] **Step 5 — commit:** `feat(steering): meeting report pane (rich editor + save/send scaffold)`

### Task 4: thread the report prop bag into the steering panel + open the pane

**Files:** `steering-committee-panel.tsx`, `workspace-section-types.ts`, `workspace-section.tsx`, `task-manager.tsx`.

- [ ] **Step 1** — add an optional bag to `SteeringCommitteePanelProps`:

```ts
  report?: {
    m365Configured: boolean;
    aiConfigured: boolean;
    tursoActive: boolean;
    onSaveReport: (meetingId: number, html: string) => void;
    onSendReport: (meetingId: number) => void;
    sendBusyMeetingId: number | null;
  };
```

- [ ] **Step 2** — in the meeting `<tr>` (or an expander under it), add a "Status report" toggle button (gated `report && !isPopout`) that opens `<MeetingReportPanel>` for that meeting, mirroring the Push-to-Outlook section style (L454-466). Wire `onSave`→`report.onSaveReport(m.id, html)`, `onSend`→`report.onSendReport(m.id)`, `report={m.report}`, `sendBusy={report.sendBusyMeetingId===m.id}`, `m365Configured`/`aiConfigured` from the bag. Confirm exact placement (inline expander vs modal) with the user at review per confirm-before-window-changes.

- [ ] **Step 3** — thread the bag `task-manager.tsx` → `workspace-section-types.ts` (`WorkspaceSectionProps`) → `workspace-section.tsx` → panel, mirroring `outlookPush`.

- [ ] **Step 4** — `task-manager.tsx` connected handlers:
  - `onSaveReport(meetingId, html)`: functional committee update — `patchMeeting`-style: `setSteeringCommittee(c => c && { ...c, meetings: c.meetings.map(m => m.id===meetingId ? { ...m, report: { html, updatedAt: todayISO-or-new Date().toISOString() } } : m) })`. (Use `new Date().toISOString()` in the handler body, NOT render.)
  - `onSendReport(meetingId)`: resolve `committeeMemberEmails(committee, resources)`; if empty → info toast (`reportNoRecipients`); else `sanitizeTemplateHtml(report.html)` → `sendMail(token, buildGraphMessage(emails, subject, html))` (loop or array); on success stamp `report.sentAt` + success toast; errors → status-only toast (never body). Gate on `m365Configured && !isPopout`; acquire token via the M365 hook (mirror `digest-card-connected.tsx`). `sendBusyMeetingId` state drives the busy label.
  - Bag values: `m365Configured` (existing), `aiConfigured = isAiEnabled(settings.ai)`, `tursoActive = tursoConfig !== null`.

- [ ] **Step 5** — i18n EN (`i18n.ts`) + DE (`i18n.de.ts` via node UTF-8 write) new keys: `reportStatusReport`, `reportDraftWithAi`, `reportGenerating`, `reportSave`, `reportSend`, `reportSending`, `reportSentToast` (`{0}` count), `reportNoRecipients`, `reportSendFailed`. Grep-verify DE umlauts.

- [ ] **Step 6** — `npx tsc --noEmit`; `npm run test:run` (steering panel characterization/tests); `npm run size:check` (steering-committee-panel + task-manager may grow → rebaseline via `--update` if legit). Eye-verify a11y (steering not axe-gated).

- [ ] **Step 7 — commit:** `feat(steering): wire per-meeting report save + email send`

---

# SLICE 2 — AI "Draft with AI"

### Task 5: pure report-draft contract + prompt + output sanitizer

**Files:** `committee-report/report-draft.ts`, `committee-report/report-draft.test.ts`.

- [ ] **Step 1 — failing test:** `parseMeetingReport` strips control chars + caps; rejects non-string → `null`. `buildMeetingReportPrompt(model, agenda, lang)` returns a string mentioning the agenda + key metrics. `REPORT_TOOL` has `tool_choice`-able name + `input_schema` requiring the report fields.

- [ ] **Step 2 — verify RED.**

- [ ] **Step 3 — implement** (mirror `digest-narrative.ts` helpers; pure, i18n-free, English-only prompt):

```ts
import type { DashboardModel } from "../dashboard";
import type { Lang } from "../i18n";

export const REPORT_TOOL = {
  name: "write_status_report",
  description: "Write a concise steering-committee status report as HTML.",
  input_schema: {
    type: "object",
    properties: { html: { type: "string", description: "Report body as simple HTML (p/ul/li/strong/h2)." } },
    required: ["html"],
  },
} as const;

const CONTROL = /[\x00-\x1f]/g;   // hex escapes — never type literal control bytes
const REPORT_MAX = 100_000;
export function parseMeetingReport(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.replace(CONTROL, " ").trim();
  return clean === "" ? null : clean.slice(0, REPORT_MAX);
}

export function buildMeetingReportPrompt(model: DashboardModel, agenda: string, lang: Lang): string {
  // English-only prompt; summarize model.overall.effective, progress.percent,
  // overdue/dueSoon counts, openRaidCount, topChanges, milestone buckets, and
  // weave the meeting agenda items into the sections. (Full prompt body here.)
  return `You are writing a steering-committee status report...\nAgenda:\n${agenda}\n...`;
}
```

- [ ] **Step 4 → GREEN; commit:** `feat(committee-report): AI report-draft contract + prompt + sanitizer`

### Task 6: `runMeetingReport` direct-fetch call

**Files:** `committee-report/report-call.ts`, `committee-report/report-call.test.ts`.

- [ ] **Step 1 — failing test:** mock `fetch`; a forced-tool response → returns the parsed HTML; `!ok` → throws `Error(String(status))` (never key/body); missing tool_use → throws `"parse"`. Assert the request body has `tool_choice:{type:"tool",name:"write_status_report"}` and headers include `anthropic-dangerous-direct-browser-access`.

- [ ] **Step 2 — verify RED.**

- [ ] **Step 3 — implement** (verbatim structure of `runDigestNarrative`, swapping tool/prompt):

```ts
export interface MeetingReportCtx { apiKey: string; model: string; lang: Lang }
export async function runMeetingReport(
  model: DashboardModel, agenda: string, ctx: MeetingReportCtx, signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ctx.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ctx.model, max_tokens: 2048,
      messages: [{ role: "user", content: buildMeetingReportPrompt(model, agenda, ctx.lang) }],
      tools: [REPORT_TOOL], tool_choice: { type: "tool", name: "write_status_report" },
    }),
    signal,
  });
  if (!res.ok) throw new Error(String(res.status));
  const json = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
  const tool = (json.content ?? []).find((b) => b.type === "tool_use" && b.name === "write_status_report");
  const html = parseMeetingReport((tool?.input as { html?: unknown } | undefined)?.html);
  if (html == null) throw new Error("parse");
  return html;
}
```
★ SECURITY: never log/echo `ctx.apiKey` or the response body; thrown messages are status digits / `"parse"` only.

- [ ] **Step 4 → GREEN; commit:** `feat(committee-report): runMeetingReport direct-fetch forced-tool call`

### Task 7: generate hook + wire "Draft with AI"

**Files:** `use-meeting-report.ts`, `use-meeting-report.test.ts`, `task-manager.tsx`, `meeting-report-panel.tsx` (already has the `onGenerate` prop), i18n.

- [ ] **Step 1 — failing test:** the hook exposes `generate(meetingId)` → sets busy, calls `runMeetingReport`, on success writes the sanitized HTML into the meeting via the provided save callback, clears busy; on error surfaces a status-only toast; a request-generation nonce discards a stale result if re-invoked.

- [ ] **Step 2 — implement** `use-meeting-report.ts` (deps-object hook; coverage-excluded if pure UI glue per AGENTS.md). In `task-manager.tsx`, build the `DashboardModel` via `buildDashboardInput(entities, ctx)` + `computeDashboard(...)` (already assembled for the render model — reuse it), pass `aiKeyIfEnabled(settings.ai)` + model + the meeting's `agenda`. On success call the SAME `onSaveReport` path (Task 4) so the generated HTML lands in the blob + editor. Gate on `isAiEnabled(settings.ai)`; `isPopout` → no-op.

- [ ] **Step 3** — pass `onGenerate`/`generateBusy`/`aiConfigured` into the report pane via the bag; the "Draft with AI" button (Task 3) becomes live. i18n already added in Task 4 (`reportDraftWithAi`/`reportGenerating`) — add any AI-error key.

- [ ] **Step 4 — verify → GREEN; `npx tsc --noEmit`; size:check; commit:** `feat(steering): AI Draft-with-AI for meeting status reports`

---

# SLICE 3 — Turso version history (restore + diff)

### Task 8: `committee_report_versions` store (mirror comm-template-versions)

**Files:** `committee-report-versions-schema.ts`, `committee-report-versions-store.ts`, `committee-report-versions-store.test.ts`, and the `TABLE_NAMES` guard test.

- [ ] **Step 1 — failing test:** schema builders produce the expected SQL; store `saveVersion`/`loadVersions`/`deleteVersion` round-trip (mock `runTursoPipeline`); `loadVersions` decodes rows newest-first.

- [ ] **Step 2 — implement schema** (mirror `comm-template-versions-schema.ts`):

```ts
export interface MeetingReportVersion {
  id: string; projectId: string; meetingId: number;
  html: string; isAuto: boolean; capturedAt: string;
}
export const MEETING_REPORT_VERSION_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS committee_report_versions (id TEXT PRIMARY KEY, project_id TEXT, meeting_id INTEGER, html TEXT, is_auto INTEGER, captured_at TEXT)`,
];
// versionsSelect(projectId, meetingId) → WHERE project_id=? AND meeting_id=? ORDER BY captured_at DESC
// insertVersionStatements(v), deleteVersionStatements(id), rowsToVersions(res)  — copy the comm-template pattern
```

- [ ] **Step 3 — implement store** (mirror `comm-template-versions-store.ts`): `loadVersions(config, projectId, meetingId)`, `saveVersion(config, v)`, `deleteVersion(config, id)`; each `[...ddl(), ...stmt]` through `runTursoPipeline`.

- [ ] **Step 4 — `TABLE_NAMES` guard:** add `committee_report_versions` to the guard test's allowlist of NON-workspace tables (so the workspace-save DELETE loop never wipes it), matching how `comm_template_versions` is handled.

- [ ] **Step 5 → GREEN; commit:** `feat(committee-report): Turso committee_report_versions store`

### Task 9: version UI — auto-snapshot, list, restore, diff (Turso-only)

**Files:** `use-meeting-report.ts` (extend), `meeting-report-panel.tsx` (versions section), `task-manager.tsx`, `meeting-report-diff.tsx` (or reuse `comm-template-diff-view.tsx` shape), i18n.

- [ ] **Step 1 — failing tests:** (a) before an overwrite (save or AI regenerate) of a meeting that ALREADY has a report, an auto-snapshot of the prior HTML is saved to the version store; (b) restore writes a version's HTML back into the meeting (+ auto-snapshots the current first); (c) diff renders added/removed lines via `diffLines`.

- [ ] **Step 2 — implement:** gate ALL version behavior on `tursoActive` (`tursoConfig !== null`). Extend the save/generate path (Task 4/7): if `meeting.report` exists, `saveVersion(config, {…isAuto:true…})` BEFORE writing the new body. Versions list in the pane (`versions?.length` gated) with per-row Restore + a diff toggle (current vs selected) using `diffLines(current.split("\n"), version.split("\n"))` rendered like `comm-template-diff-view.tsx`. `onRestore(versionId)` in task-manager: load version → auto-snapshot current → write version HTML into the meeting via `onSaveReport`.

- [ ] **Step 3** — i18n EN/DE: `reportVersions`, `reportRestore`, `reportRestoredToast`, `reportVersionAuto`, `reportDiff`, added/removed labels (reuse existing diff labels if present).

- [ ] **Step 4 — verify → GREEN; `npx tsc --noEmit`; test:run; size:check; commit:** `feat(steering): Turso-gated report version history + restore + diff`

---

# Release (only after the user says "release")

### Task 10: release prep

- [ ] Bump `version.ts` `APP_VERSION` + `APP_MILESTONE` (new unused sci-fi codename — grep CHANGELOG to confirm) + append `versionHighlightSteeringReports` to `APP_HIGHLIGHT_KEYS`.
- [ ] `i18n.ts` EN + `i18n.de.ts` DE (node UTF-8 write, `\uXXXX`, grep-verify umlauts) for `versionHighlightSteeringReports`.
- [ ] `CHANGELOG.md` entry.
- [ ] Full gates: `npx tsc --noEmit` · `npm run lint` · `npm run test:run` · `npm run build` · `npm run size:check` · `npm run dup:check`.
- [ ] Commit `chore(release): …`; then the "release" chain (push → MR → poll → merge-on-green).

---

## Security / constraints (all tasks)

- **AI:** direct fetch only (never `callClaude`); never log/echo `apiKey` or response body; thrown errors carry status digits / `"parse"` only. Gate on `isAiEnabled(settings.ai)`.
- **HTML:** every stored/emailed body passes `sanitizeTemplateHtml` (editor onChange + AI-draft + before send). Email embeds sanitized HTML RAW (do not `esc()` rich HTML).
- **Email:** M365-gated + `!isPopout`; skip members with no email; per-status toasts; token via `Mail.Send` scope.
- **Persistence:** `report` rides the committee blob — NO new write path, NO golden regen. Version table stays OUT of `TABLE_NAMES`.
- **Turso gating:** versions/restore gated on `tursoConfig !== null` (not `storageConfig.kind`).
- **i18n:** EN/DE parity (tsc); DE via node write (umlauts; `i18n-encoding` bans ASCII subs); positional `{0}`.
- **Popout:** report pane read-only in popouts (no save/send/generate).
- **Size:** watch `steering-committee-panel.tsx` + `task-manager.tsx` ratchets; rebaseline via `--update` for legit growth, or extract the pane (already its own file).

## Verification (end-to-end)

- `npx tsc --noEmit`; `npm run test:run`; `npm run build`; `npm run size:check`; `npm run dup:check`.
- Eye-verify steering panel a11y (not in axe `A11Y_VIEWS`): row-unique labels on the per-meeting report controls; palette tokens only.
- Manual: on a committee with members, open a meeting → Draft with AI (key configured) → edit → Save → (Turso) see a version → edit again → restore prior → Send → members receive the email. On a file backend: draft/edit/save/send work; versions section hidden.
