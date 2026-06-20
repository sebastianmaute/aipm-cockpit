# SP-E - Steering Committee + Meetings + Info Reminders + Outlook - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Document a steering committee (members + meetings + info-schedule rules), surface info reminders in BOTH the Action Center and an in-panel list, and push meetings + info-reminder due dates to Outlook (M365).

**Architecture:** New non-tabular `Workspace.steeringCommittee` field (persisted like `plan`/`status` across all six backends). Pure engines: `steering-reminders.ts` (working-day reminder math) + `committee-calendar-reconcile.ts` (Outlook diff). A next-actions provider + an in-panel list both consume the reminder engine. A new Steering Committee view. Outlook push reuses `outlook-calendar-write.ts` (the Milestone plumbing).

**Tech Stack:** Forked Next.js 16 / React 19 / TS; vitest; M365 Graph (Calendars.ReadWrite); i18n EN+DE (tsc parity); Tailwind AIPM tokens.

Spec: `docs/superpowers/specs/2026-06-20-steering-committee-spe-design.md`.

---

## Conventions (read first)
- After editing ANY test run `npx tsc --noEmit`. `getByRole` string name already exact - no `{exact}`.
- `npm run lint` `--max-warnings=0`: unused import/var FATAL. react-hooks: no `obj.member` deps (hoist to const); no `Date.now()`/`new Date()` in render body; no `set-state-in-effect`.
- i18n EN/DE key sets identical (tsc). DE CRLF; add DE keys via node UTF-8 write (real umlauts), delete script. Tests use `lang="en-US"`; DE via `loadI18n("de")` in `beforeAll`.
- AIPM palette tokens only.
- **New persisted Workspace field -> SIX write paths** (JSON/CSV/MD/Turso-single/Turso-tenant/IndexedDB). `steeringCommittee` is a NESTED object, so mirror how `status` (ProjectStatus) / `plan` (ResourcePlan) persist - NOT a per-row table. Read `sanitizeProjectStatus` + how `status`/`plan` flow through `workspace.ts`, `csv-codecs.ts`, `markdown-codecs.ts`, the Turso schema, `browser-backend.ts`.
- **Outlook security:** never log/echo the Graph token or response body; status-only errors (mirror `use-outlook-calendar-push.ts` / `outlook-calendar-write.ts`).
- `npm run test:run` green before each commit; commit per task.

---

## File Map
- `types.ts` - `SteeringCommittee`/`CommitteeMeeting`/`InfoSchedule` + `Workspace.steeringCommittee?`.
- `sanitize.ts` - `sanitizeSteeringCommittee`.
- `steering-reminders.ts` (NEW pure) - `dueInfoReminders`.
- `committee-calendar-reconcile.ts` (NEW pure) - `planCommitteeReconcile` (meetings + info-instances).
- `next-actions/providers/committee-info.ts` (NEW) + `next-actions/types.ts` (optional `ActionInput` field) + provider registration.
- `steering-committee-panel.tsx` (NEW) + `nav-config.ts`.
- `use-committee-outlook-push.ts` (NEW).
- `workspace.ts`, `csv-codecs.ts`, `markdown-codecs.ts`, Turso single+tenant schema, `browser-backend.ts` - six paths.
- `__fixtures__/golden-*`, `sample-workspace-small.{md,json,sqlite3}` - regenerate.
- `i18n.ts` / `i18n.de.ts`, `version.ts`, `CHANGELOG.md`.

---

## Task 1: Model + sanitizer

**Files:** Modify `types.ts`, `sanitize.ts`; Test: `sanitize.test.ts` (extend).

- [ ] **Step 1: failing test** - add to `sanitize.test.ts`:
```ts
import { sanitizeSteeringCommittee } from "./sanitize";
describe("sanitizeSteeringCommittee", () => {
  it("keeps a valid committee + drops bad meetings/schedules", () => {
    const out = sanitizeSteeringCommittee({
      name: "Project Board",
      memberResourceIds: [1, 2, "x", 2],
      meetings: [
        { id: 1, date: "2026-07-01", title: "Kickoff", agenda: "a" },
        { id: 2, date: "not-a-date", title: "bad" },
        { id: 3, title: "no date" },
      ],
      infoSchedules: [{ id: 1, label: "Board pack", leadDays: 3 }, { id: 2, label: "x", leadDays: -5 }],
    })!;
    expect(out.name).toBe("Project Board");
    expect(out.memberResourceIds).toEqual([1, 2]); // non-number dropped, deduped
    expect(out.meetings.map((m) => m.id)).toEqual([1]); // bad/missing date dropped
    expect(out.infoSchedules).toHaveLength(2);
    expect(out.infoSchedules[1].leadDays).toBe(0); // negative clamped to >=0
  });
  it("returns undefined for absent/garbage input (never throws)", () => {
    expect(sanitizeSteeringCommittee(undefined)).toBeUndefined();
    expect(sanitizeSteeringCommittee(null)).toBeUndefined();
    expect(sanitizeSteeringCommittee("x")).toBeUndefined();
  });
});
```

- [ ] **Step 2:** `npm run test:run -- sanitize` -> FAIL.

- [ ] **Step 3: types** in `types.ts` (near the other entity types):
```ts
export interface CommitteeMeeting { id: number; date: string; title: string; agenda?: string; location?: string; outlookEventId?: string; }
export interface InfoSchedule { id: number; label: string; leadDays: number; }
export interface SteeringCommittee {
  name: string;
  memberResourceIds: number[];
  meetings: CommitteeMeeting[];
  infoSchedules: InfoSchedule[];
  infoReminderEventIds?: Record<string, string>;
}
```
Add `steeringCommittee?: SteeringCommittee;` to the `Workspace` type (OPTIONAL - absent until used, like other optional fields).

- [ ] **Step 4: sanitizer** in `sanitize.ts` (follow `sanitizeProjectStatus`'s defensive style; read it):
```ts
export function sanitizeSteeringCommittee(raw: unknown): SteeringCommittee | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, cap: number) => (typeof v === "string" ? v.slice(0, cap) : "");
  const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const members = Array.isArray(r.memberResourceIds)
    ? [...new Set(r.memberResourceIds.filter((x): x is number => typeof x === "number"))]
    : [];
  const meetings = Array.isArray(r.meetings)
    ? r.meetings.flatMap((m): CommitteeMeeting[] => {
        if (!m || typeof m !== "object") return [];
        const mm = m as Record<string, unknown>;
        if (typeof mm.id !== "number" || !isDate(mm.date)) return [];
        const out: CommitteeMeeting = { id: mm.id, date: mm.date, title: str(mm.title, 200) };
        if (typeof mm.agenda === "string") out.agenda = mm.agenda.slice(0, 2000);
        if (typeof mm.location === "string") out.location = mm.location.slice(0, 300);
        if (typeof mm.outlookEventId === "string") out.outlookEventId = mm.outlookEventId;
        return [out];
      })
    : [];
  const infoSchedules = Array.isArray(r.infoSchedules)
    ? r.infoSchedules.flatMap((s): InfoSchedule[] => {
        if (!s || typeof s !== "object") return [];
        const ss = s as Record<string, unknown>;
        if (typeof ss.id !== "number") return [];
        const lead = Number(ss.leadDays);
        return [{ id: ss.id, label: str(ss.label, 200), leadDays: Number.isFinite(lead) && lead >= 0 ? Math.round(lead) : 0 }];
      })
    : [];
  const eventIds: Record<string, string> = {};
  if (r.infoReminderEventIds && typeof r.infoReminderEventIds === "object") {
    for (const [k, v] of Object.entries(r.infoReminderEventIds as Record<string, unknown>)) {
      if (typeof v === "string") eventIds[k] = v;
    }
  }
  return { name: str(r.name, 200), memberResourceIds: members, meetings, infoSchedules,
    ...(Object.keys(eventIds).length ? { infoReminderEventIds: eventIds } : {}) };
}
```

- [ ] **Step 5:** `npm run test:run -- sanitize` -> PASS. `npx tsc --noEmit` (will flag the new field needs handling at construction sites; for THIS task confirm 0 errors in types.ts/sanitize.ts - the optional field doesn't force callers). `npm run lint`.

- [ ] **Step 6: commit**
```bash
git add src/app/types.ts src/app/sanitize.ts src/app/sanitize.test.ts
git commit -m "feat(sp-e): SteeringCommittee model + sanitizeSteeringCommittee"
```

---

## Task 2: Pure reminder engine

**Files:** Create `steering-reminders.ts`, `steering-reminders.test.ts`.

Context: read `due-dates.ts` for the working-day helper (`workdaysUntil(from, to, holidays?)` or similar) - reuse it for "N working days before". If it computes count-between, derive the due date by stepping back working days; if a helper for "subtract N working days" doesn't exist, write a small pure stepper here (skip Sat/Sun).

- [ ] **Step 1: failing test** - `steering-reminders.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { dueInfoReminders } from "./steering-reminders";
import type { SteeringCommittee } from "./types";

const committee = (over: Partial<SteeringCommittee> = {}): SteeringCommittee => ({
  name: "Board", memberResourceIds: [],
  meetings: [{ id: 1, date: "2026-07-10", title: "July board" }],
  infoSchedules: [{ id: 1, label: "Board pack", leadDays: 3 }],
  ...over,
});

describe("dueInfoReminders", () => {
  it("computes a due date N working days before the meeting", () => {
    const out = dueInfoReminders(committee(), "2026-07-01");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ meetingId: 1, scheduleId: 1, label: "Board pack", meetingDate: "2026-07-10" });
    // 2026-07-10 is a Friday; 3 working days before = Tue 2026-07-07
    expect(out[0].dueDate).toBe("2026-07-07");
  });
  it("skips past meetings and returns [] for an empty committee", () => {
    expect(dueInfoReminders(committee({ meetings: [] }), "2026-07-01")).toEqual([]);
    expect(dueInfoReminders(committee({ meetings: [{ id: 9, date: "2020-01-01", title: "old" }] }), "2026-07-01")).toEqual([]);
  });
  it("flags an overdue/now reminder when the due date has passed but the meeting is future", () => {
    const out = dueInfoReminders(committee(), "2026-07-09"); // due 07-07 already passed, meeting 07-10 future
    expect(out[0].tier).toBe("now");
  });
});
```

- [ ] **Step 2:** `npm run test:run -- steering-reminders` -> FAIL.

- [ ] **Step 3: implement `steering-reminders.ts`** (pure, i18n-free; import only `./types` + the `due-dates` working-day helper):
```ts
import type { SteeringCommittee } from "./types";
// import the working-day helper from ./due-dates (confirm its name/signature)

export type ReminderTier = "now" | "soon" | "upcoming";
export interface InfoReminder {
  meetingId: number; scheduleId: number; label: string;
  meetingTitle: string; meetingDate: string; dueDate: string; daysLeft: number; tier: ReminderTier;
}

const SOON_DAYS = 5;

/** Step `n` working days BACKWARD from an ISO date (skip Sat/Sun). Pure. */
function subtractWorkingDays(isoDate: string, n: number): string {
  // parse as UTC to avoid TZ drift; step back skipping weekends
  const d = new Date(isoDate + "T00:00:00Z");
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + "T00:00:00Z"); const b = Date.parse(toIso + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

/** For each FUTURE meeting x infoSchedule, the info due date (leadDays working days before)
 *  + a tier. `today` always passed in (test-pure). */
export function dueInfoReminders(committee: SteeringCommittee | undefined, today: string): InfoReminder[] {
  if (!committee) return [];
  const out: InfoReminder[] = [];
  for (const m of committee.meetings) {
    if (daysBetween(today, m.date) < 0) continue; // past meeting
    for (const s of committee.infoSchedules) {
      const dueDate = subtractWorkingDays(m.date, s.leadDays);
      const daysLeft = daysBetween(today, dueDate);
      const tier: ReminderTier = daysLeft <= 0 ? "now" : daysLeft <= SOON_DAYS ? "soon" : "upcoming";
      out.push({ meetingId: m.id, scheduleId: s.id, label: s.label, meetingTitle: m.title, meetingDate: m.date, dueDate, daysLeft, tier });
    }
  }
  return out;
}
```
(If `due-dates.ts` already has a working-day subtract/holiday-aware helper, USE it instead of the local `subtractWorkingDays` so holidays are respected; otherwise the weekend-only stepper is acceptable - note which you used.)

- [ ] **Step 4:** `npm run test:run -- steering-reminders` -> PASS. `npx tsc --noEmit` -> 0. `npm run lint`.

- [ ] **Step 5: commit**
```bash
git add src/app/steering-reminders.ts src/app/steering-reminders.test.ts
git commit -m "feat(sp-e): pure dueInfoReminders working-day reminder engine"
```

---

## Task 3: Pure Outlook reconcile

**Files:** Create `committee-calendar-reconcile.ts`, `committee-calendar-reconcile.test.ts`.

Context: mirror `calendar-reconcile.ts` `planCalendarReconcile` (read it: returns `{create, update, delete}`). SP-E reconciles TWO sets: meetings (1:1 via `outlookEventId`) and info-instances (keyed `"<meetingId>:<scheduleId>"` in `infoReminderEventIds`). Produce a desired-vs-stored diff for both, including DELETE of stale event ids (for removed meetings/schedules).

- [ ] **Step 1: failing test** - `committee-calendar-reconcile.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { planCommitteeReconcile } from "./committee-calendar-reconcile";
import type { SteeringCommittee } from "./types";

const base: SteeringCommittee = {
  name: "B", memberResourceIds: [],
  meetings: [{ id: 1, date: "2026-07-10", title: "M1" }, { id: 2, date: "2026-08-10", title: "M2", outlookEventId: "ev2" }],
  infoSchedules: [{ id: 1, label: "Pack", leadDays: 3 }],
  infoReminderEventIds: { "2:1": "old-info", "9:1": "stale-removed" },
};

describe("planCommitteeReconcile", () => {
  it("creates meetings without an eventId, updates those with one", () => {
    const r = planCommitteeReconcile(base, "2026-07-01");
    expect(r.meetingCreate.map((m) => m.id)).toContain(1);          // no eventId -> create
    expect(r.meetingUpdate.map((u) => u.eventId)).toContain("ev2"); // has eventId -> update
  });
  it("creates info-instances for current meeting x schedule and deletes stale ids", () => {
    const r = planCommitteeReconcile(base, "2026-07-01");
    // current instances: "1:1" (new -> create), "2:1" (has id old-info -> update)
    expect(r.infoCreate.map((i) => i.key)).toContain("1:1");
    expect(r.infoUpdate.map((i) => i.eventId)).toContain("old-info");
    // "9:1" references a removed meeting -> delete its stale event id
    expect(r.deleteEventIds).toContain("stale-removed");
  });
});
```

- [ ] **Step 2:** run -> FAIL.

- [ ] **Step 3: implement** `committee-calendar-reconcile.ts` (pure; import `./types` + `dueInfoReminders` from `./steering-reminders` for the desired info-instance set):
```ts
import type { SteeringCommittee, CommitteeMeeting } from "./types";
import { dueInfoReminders } from "./steering-reminders";

export interface CommitteeReconcile {
  meetingCreate: CommitteeMeeting[];
  meetingUpdate: { meeting: CommitteeMeeting; eventId: string }[];
  infoCreate: { key: string; label: string; dueDate: string; meetingTitle: string }[];
  infoUpdate: { key: string; eventId: string; label: string; dueDate: string; meetingTitle: string }[];
  deleteEventIds: string[]; // stale meeting + info ids no longer desired
}

export function planCommitteeReconcile(committee: SteeringCommittee, today: string): CommitteeReconcile {
  const meetingCreate: CommitteeMeeting[] = [];
  const meetingUpdate: { meeting: CommitteeMeeting; eventId: string }[] = [];
  for (const m of committee.meetings) {
    if (m.outlookEventId) meetingUpdate.push({ meeting: m, eventId: m.outlookEventId });
    else meetingCreate.push(m);
  }
  const desired = dueInfoReminders(committee, today); // future meetings x schedules
  const stored = committee.infoReminderEventIds ?? {};
  const desiredKeys = new Set(desired.map((d) => `${d.meetingId}:${d.scheduleId}`));
  const infoCreate: CommitteeReconcile["infoCreate"] = [];
  const infoUpdate: CommitteeReconcile["infoUpdate"] = [];
  for (const d of desired) {
    const key = `${d.meetingId}:${d.scheduleId}`;
    const eventId = stored[key];
    if (eventId) infoUpdate.push({ key, eventId, label: d.label, dueDate: d.dueDate, meetingTitle: d.meetingTitle });
    else infoCreate.push({ key, label: d.label, dueDate: d.dueDate, meetingTitle: d.meetingTitle });
  }
  // stale: stored info ids whose key is no longer desired (removed meeting/schedule/past meeting)
  const deleteEventIds = Object.entries(stored).filter(([k]) => !desiredKeys.has(k)).map(([, v]) => v);
  return { meetingCreate, meetingUpdate, infoCreate, infoUpdate, deleteEventIds };
}
```

- [ ] **Step 4:** run -> PASS. `npx tsc --noEmit` -> 0. `npm run lint`.

- [ ] **Step 5: commit**
```bash
git add src/app/committee-calendar-reconcile.ts src/app/committee-calendar-reconcile.test.ts
git commit -m "feat(sp-e): pure committee Outlook reconcile (meetings + info-instances)"
```

---

## Task 4: Persistence (six write paths + fixtures)

**Files:** Modify `workspace.ts`, `csv-codecs.ts`, `markdown-codecs.ts`, the Turso single + tenant schema, `browser-backend.ts`. Regenerate `__fixtures__/golden-*` + `sample-workspace-small.*`. Test: codec round-trip + `golden-workspace.test.ts`.

Context: `steeringCommittee` is a NESTED object like `status` (ProjectStatus). MIRROR `status` EXACTLY through every path. Read how `status` is: sanitized on JSON load (`workspace.ts:322` `status: sanitizeProjectStatus(p.status)`), included in the workspace object (`workspace.ts:265`), and serialized in CSV (`csv-codecs.ts` - a keyed/section block) + Markdown (`markdown-codecs.ts` `## Project Status` section + parser) + Turso (single + tenant - how the status blob is stored/loaded).

- [ ] **Step 1: failing test** - add a round-trip test (extend the codec test or a new `steering-committee-persistence.test.ts`):
```ts
import { describe, expect, it } from "vitest";
import { jsonToWorkspace } from "./workspace";
import { csvToWorkspace, workspaceToCsv } from "./csv-codecs";
import { markdownToWorkspace, workspaceToMarkdown } from "./storage";

const wsJson = JSON.stringify({
  tasks: [], raid: [],
  steeringCommittee: { name: "Board", memberResourceIds: [1], meetings: [{ id: 1, date: "2026-07-10", title: "July" }], infoSchedules: [{ id: 1, label: "Pack", leadDays: 3 }] },
});

describe("steeringCommittee persistence", () => {
  it("round-trips through JSON load", () => {
    expect(jsonToWorkspace(wsJson).steeringCommittee?.name).toBe("Board");
  });
  it("round-trips through CSV", () => {
    const ws = csvToWorkspace(workspaceToCsv(jsonToWorkspace(wsJson)));
    expect(ws.steeringCommittee?.meetings[0].title).toBe("July");
  });
  it("round-trips through Markdown", () => {
    const ws = markdownToWorkspace(workspaceToMarkdown(jsonToWorkspace(wsJson)));
    expect(ws.steeringCommittee?.infoSchedules[0].leadDays).toBe(3);
  });
});
```

- [ ] **Step 2:** run -> FAIL (steeringCommittee undefined after round-trip).

- [ ] **Step 3: JSON** (`workspace.ts`): in `jsonToWorkspace`, add `steeringCommittee: sanitizeSteeringCommittee(p.steeringCommittee)` (only set the key when defined - mirror how optional fields like `project` are conditionally added, OR set it and let `undefined` be fine). Add it to the workspace object construction where `status`/`plan` are listed (so it's carried through). Import `sanitizeSteeringCommittee`.

- [ ] **Step 4: CSV** (`csv-codecs.ts`): mirror the `status` serialization. The committee is nested -> serialize as a dedicated section/keyed block (the same mechanism `status` uses - likely a JSON-encoded cell or a labeled block). Add to both `workspaceToCsv` (emit) and `csvToWorkspace` (parse -> `sanitizeSteeringCommittee`). Match the existing escaping. (If `status` is emitted as a JSON blob in a single labeled row, do the same for `steeringCommittee` - simplest + robust for a nested object.)

- [ ] **Step 5: Markdown** (`markdown-codecs.ts`): mirror the `## Project Status` section - add a `## Steering Committee` section emitter + parser. Serialize members/meetings/schedules as a readable sub-block or a fenced JSON block (match what `status` does). Parser -> `sanitizeSteeringCommittee`.

- [ ] **Step 6: Turso single + tenant:** find where `status`/`plan` are written/read in the Turso backend (single-row blob, NOT in `TABLE_NAMES`). Add `steeringCommittee` the SAME way (serialize to the same global/meta row as status/plan, or its own meta key - match the existing non-tabular field storage). `turso-migrate.ts` self-heals any new column. Confirm it stays OUT of `TABLE_NAMES`.

- [ ] **Step 7: IndexedDB** (`browser-backend.ts`): confirm the committee rides through the JSON workspace object (if IDB stores the workspace via the JSON shape, it's covered by Step 3; if it reconstructs fields explicitly, add `steeringCommittee`). 

- [ ] **Step 8: regenerate fixtures + sample.** Add a small `steeringCommittee` to the curated `sample-workspace-small.md` master (a `## Steering Committee` section matching your Step-5 format), then `npx vite-node scripts/generate-sample-workspace.ts` (regen .json/.sqlite). Then regenerate `__fixtures__/golden-workspace.{csv,md}` from the new `sample-workspace-small.json` via the serializers (the golden test reads sample-small.json -> asserts byte-identity). Verify CSV pure CRLF / MD pure LF. (Mirror the SP-A Task-3 fixture-regen flow.)

- [ ] **Step 9:** `npm run test:run -- steering-committee-persistence golden-workspace` -> PASS. `npm run test:run` (full) -> green (watch sample-data tests). `npx tsc --noEmit` -> 0. `npm run lint`.

- [ ] **Step 10: commit**
```bash
git add -A
git commit -m "feat(sp-e): persist steeringCommittee across six backends + regenerate fixtures"
```

NOTE: if mirroring `status` is unclear at any path, READ that path's `status` handling and copy it verbatim for `steeringCommittee`. Do NOT invent a new persistence shape.

---

## Task 5: Next-actions reminder provider

**Files:** Create `next-actions/providers/committee-info.ts`; modify `next-actions/types.ts` (optional `ActionInput.steeringCommittee` + `today` if not present) + the provider registry (`next-actions/index.ts` or where providers are listed). Test: `next-actions/providers/committee-info.test.ts`.

Context: read an existing provider (e.g. `next-actions/providers/milestone.ts` or `task-due.ts`) for the `ActionProvider` shape (`provide(input): SuggestedAction[]`), the `SuggestedAction` shape (tier, title, why.key, source), and how providers are registered. The new `ActionInput` field MUST be OPTIONAL (or the existing provider-test `input()` helpers break).

- [ ] **Step 1: failing test** - `committee-info.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { committeeInfoProvider } from "./committee-info";
import type { ActionInput } from "../types";

function input(over: Partial<ActionInput> = {}): ActionInput {
  return { features: [], dismissed: new Set(), today: "2026-07-09",
    steeringCommittee: { name: "B", memberResourceIds: [], meetings: [{ id: 1, date: "2026-07-10", title: "July board" }], infoSchedules: [{ id: 1, label: "Board pack", leadDays: 3 }] },
    ...over } as ActionInput;
}

describe("committeeInfoProvider", () => {
  it("emits a now-tier action for an overdue info reminder", () => {
    const actions = committeeInfoProvider.provide(input());
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].tier).toBe("now");
    expect(actions[0].title).toMatch(/Board pack/);
  });
  it("emits nothing without a committee", () => {
    expect(committeeInfoProvider.provide(input({ steeringCommittee: undefined }))).toEqual([]);
  });
});
```
(Adjust to the REAL `ActionProvider`/`SuggestedAction`/`ActionInput` shapes you find - tier names, `why` object, `source`, id scheme. Mirror an existing provider exactly.)

- [ ] **Step 2:** run -> FAIL.

- [ ] **Step 3: implement.** `next-actions/types.ts`: add OPTIONAL `steeringCommittee?: SteeringCommittee` to `ActionInput` (and `today` if not already there). `committee-info.ts`: `provide(input)` -> `dueInfoReminders(input.steeringCommittee, input.today)` mapped to `SuggestedAction`s (map tier now/soon; `upcoming` -> drop or monitor tier per the engine's tiers); `source: "committee"` (or the existing source enum + add a value if needed); a stable id per reminder (`committee-info:<meetingId>:<scheduleId>`); a `why.key` i18n key. Register `committeeInfoProvider` in the providers list. Keep the engine i18n-free (why.key only; the surface translates).

- [ ] **Step 4:** `npm run test:run -- committee-info next-actions` -> PASS (+ existing provider/engine tests still green - the optional ActionInput field shouldn't break them). `npx tsc --noEmit` -> 0. `npm run lint`.

- [ ] **Step 5: commit**
```bash
git add -A
git commit -m "feat(sp-e): next-actions committee-info reminder provider"
```

---

## Task 6: Steering Committee view (panel + nav + i18n)

**Files:** Create `steering-committee-panel.tsx`; modify `nav-config.ts` (+ wherever views mount - `task-manager.tsx`/the shells, mirroring how Milestones/Stakeholders panels mount). Modify `i18n.ts`/`i18n.de.ts`. Modify the workspace context/setters if needed (a `setSteeringCommittee`). Test: `steering-committee-panel.test.tsx`.

Context: read how an existing panel (e.g. `stakeholders` or `milestones-panel.tsx`) is defined + added to `nav-config.ts` (`AppView` + nav label) + mounted in the shells. Read `workspace-context.tsx` for the live-workspace setter pattern (add `setSteeringCommittee` mirroring the others, threading the new field).

- [ ] **Step 1: failing test** - `steering-committee-panel.test.tsx`:
```ts
it("renders the committee name, members, meetings, and the reminder list", () => {
  // render SteeringCommitteePanel with a committee (1 meeting, 1 schedule) + a resources list;
  // assert the meeting title renders, the info-schedule label renders, and the reminder list shows the due item.
});
it("adds a meeting via the meetings editor (calls the setter)", () => {
  // click "Add meeting", fill date+title, assert the committee setter was called with the new meeting.
});
```
(Follow the panel test harness used by milestones/stakeholders.)

- [ ] **Step 2:** run -> FAIL.

- [ ] **Step 3: nav + mount.** `nav-config.ts`: add the `AppView` (e.g. `"steering-committee"`) + nav label key. Mount the panel in the shells the same way Milestones/Stakeholders mount (modern + classic). Gate it behind a feature module if the app gates other views (check `feature-modules.ts`); else always available.

- [ ] **Step 4: panel.** `steering-committee-panel.tsx`:
- Committee name input (-> setSteeringCommittee).
- Members: shared ResourcePicker (multi-select of resources -> memberResourceIds); show member names from the live resources.
- Meetings table: add/edit/delete rows (date, title, agenda, location). Row-unique a11y labels (`${t(lang,"edit")} - ${meeting.title}`).
- Info-schedules editor: add/edit/delete (label + lead working-days number input).
- Reminder list: `dueInfoReminders(committee, todayISO)` rendered (overdue/soon/upcoming styling via AIPM tokens).
- "Push to Outlook" button: gated on M365 enabled (`isM365Enabled`/the existing gate); wired to the Task-7 hook (or a placeholder handler this task + real wiring in Task 7 - prefer wiring in Task 7).
- AIPM tokens only; ids via max+1 (`nextEntityId`-style) on add; setter updates the workspace (six paths via the context).

- [ ] **Step 5: i18n** EN (`i18n.ts`): nav label, panel headings, field labels (meeting date/title/agenda/location, schedule label/leadDays), reminder strings, add/edit/delete labels (reuse existing `edit`/`delete`/`add` where present), push-button labels. DE (`i18n.de.ts`) via node UTF-8 write (real umlauts; delete script). Parity (tsc).

- [ ] **Step 6:** `npm run test:run -- steering-committee-panel nav-config i18n` -> PASS. `npm run test:run` (full) -> green. `npx tsc --noEmit` -> 0. `npm run lint`.

- [ ] **Step 7: a11y.** If you added the view to `A11Y_VIEWS` (`e2e/a11y.spec.ts`), run `npx playwright test e2e/a11y.spec.ts -g "<View>"` -> PASS. If NOT added, eye-verify all controls labeled + report. (Adding it to the gate is encouraged for a new always-present view; row-unique labels in the meetings table are required there.)

- [ ] **Step 8: commit**
```bash
git add -A
git commit -m "feat(sp-e): Steering Committee view (members/meetings/schedules + reminder list)"
```

---

## Task 7: Outlook push hook + wiring

**Files:** Create `use-committee-outlook-push.ts`; modify `steering-committee-panel.tsx` (wire the Push button) + the mount site to provide the hook. Test: `use-committee-outlook-push.test.tsx` or a reconcile-integration test.

Context: read `use-outlook-calendar-push.ts` + `outlook-calendar-write.ts` (the Graph create/update/delete event helpers + `useMsAuth().acquireToken`). Reuse them. Use Task-3's `planCommitteeReconcile` to compute the diff.

- [ ] **Step 1: failing test** - `use-committee-outlook-push.test.tsx` (mock the Graph write helpers + acquireToken):
```ts
it("creates events for new meetings + info-instances and persists the returned eventIds", async () => {
  // mock outlook-calendar-write create -> returns an eventId; render the hook;
  // call push(committee); assert the committee setter received meetings with outlookEventId set
  // and infoReminderEventIds populated for the new info-instance keys.
});
it("sets a status-only error and never logs the token on a Graph failure", async () => {
  // mock create to reject/return non-OK; assert error is a controlled token, no token in it.
});
```
(Adapt to the real `outlook-calendar-write` signatures + how `use-outlook-calendar-push` structures push/busy/error.)

- [ ] **Step 2:** run -> FAIL.

- [ ] **Step 3: implement `use-committee-outlook-push.ts`** (mirror `use-outlook-calendar-push.ts`):
- `push(committee)`: acquire `Calendars.ReadWrite` token (via `useMsAuth().acquireToken({interactive:true})`); compute `planCommitteeReconcile(committee, todayISO)`; for `meetingCreate` -> create a timed event (start=meeting date, e.g. 1h) -> set `meeting.outlookEventId`; `meetingUpdate` -> patch; `infoCreate` -> create an all-day reminder event (subject from label + meetingTitle, date=dueDate) -> set `infoReminderEventIds[key]`; `infoUpdate` -> patch; `deleteEventIds` -> delete each + remove from `infoReminderEventIds` / clear meeting eventIds for removed meetings; then call `setSteeringCommittee(updatedCommittee)` to persist the new eventIds (six paths).
- busy/error state; status-only errors (never log token/body); consent-denied caught; idempotent (re-push uses stored ids).
- Reuse `outlook-calendar-write.ts`'s create/update/delete fns (don't write new Graph fetches - if a needed verb is missing, add it there mirroring the existing ones).

- [ ] **Step 4: wire the panel** Push button -> `push(committee)`; disable while busy; show status-only error. Gated on M365.

- [ ] **Step 5:** `npm run test:run -- use-committee-outlook-push steering-committee-panel` -> PASS. `npm run test:run` (full) -> green. `npx tsc --noEmit` -> 0. `npm run lint`.

- [ ] **Step 6: commit**
```bash
git add -A
git commit -m "feat(sp-e): push committee meetings + info reminders to Outlook"
```

---

## Task 8: Release

**Files:** `version.ts`, `i18n.ts`/`i18n.de.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** - `APP_VERSION = "0.111.0"`, `APP_MILESTONE = "Chambers"` (Becky Chambers); update build-date comment + milestone JSDoc; append `"versionHighlightSteering"` as the LAST `APP_HIGHLIGHT_KEYS` entry.

- [ ] **Step 2: EN highlight** (`i18n.ts`):
```ts
  versionHighlightSteering: "Document your steering committee, its meeting schedule, and information-circulation deadlines - get reminders in the Action Center and push the meetings to your Outlook calendar.",
```

- [ ] **Step 3: DE highlight** (`i18n.de.ts`) via node UTF-8 write (real umlauts; delete script):
`"Dokumentieren Sie Ihren Lenkungsausschuss, seinen Sitzungsplan und Fristen für die Informationsverteilung - mit Erinnerungen im Aktionscenter und Übertragung der Sitzungen in Ihren Outlook-Kalender."`
(real ü in "für", "Übertragung"; ä in... none; ß in "Lenkungsausschuss"). Confirm parity + i18n-encoding.

- [ ] **Step 4: CHANGELOG.md** - new top entry `## [0.111.0] - 2026-06-20 "Chambers"`:
```markdown
### Added
- Steering committee: document the committee and its members, schedule its meetings, and define information-circulation rules (e.g. "board pack 3 working days before each meeting"). Reminders appear in the Action Center and the committee panel; when M365 is enabled you can push the meetings and the information deadlines to your Outlook calendar.
```

- [ ] **Step 5: build + suites** - `npm run build` -> PASS. `npm run test:run` -> green. `npx tsc --noEmit` -> 0. `npm run lint` -> clean.

- [ ] **Step 6: axe** - if the Steering Committee view is in `A11Y_VIEWS`, `npx playwright test e2e/a11y.spec.ts -g "<View>"` -> PASS (report verbatim). Else eye-verify.

- [ ] **Step 7: commit**
```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "chore(sp-e): release v0.111.0 Chambers (steering committee + Outlook)"
```

---

## Final review
After all tasks, review `git diff main...HEAD`:
- `steeringCommittee` round-trips through ALL SIX backends (mirrors `status`); golden fixtures regenerated + byte-stable; sanitizer never throws.
- Reminder engine pure + working-day-correct; the SAME `dueInfoReminders` feeds the provider AND the panel (no divergent logic).
- Outlook reconcile idempotent (stored eventIds keyed; stale ids pruned); push never logs/echoes the token/body; status-only errors; eventIds persisted back via the committee setter; M365-gated; popout read-only.
- New view + nav wired into both shells; row-unique a11y labels; AIPM tokens only; axe (if scanned) passes.
- No `obj.member` deps / `Date.now()` in render; i18n EN/DE parity + real umlauts; tsc clean incl tests.

Then use **superpowers:finishing-a-development-branch**.
