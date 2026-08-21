# Weekly Status Digest (audit #7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. FEATURE branch off `main` (e.g. `feat/weekly-status-digest`) AFTER 0.171.0 lands. `npx tsc --noEmit` + `npm run test:run` after each task; each task its own commit. NOT a release until the user says "release".

**Goal:** Recurring per-project status digest (RAG + overdue + milestones-due-soon + open RAID) surfaced as an always-on Dashboard card, optionally emailed via Graph and announced by a desktop notification, with an optional AI narrative — plus a manual "Generate now" button.

**Architecture:** Pure engine (`digest-model`) projects the already-computed `DashboardModel` into structured facts; a per-device store (`digest-state`, mirrors `landing-state`) holds cadence + prior-snapshot deltas; a pure HTML builder (`digest-email`) and a forced-tool AI call (`digest-narrative`) feed the three delivery channels; one render-scope hook (`use-digest`) owns cadence/manual/delivery; one presentational card renders it. No new Workspace field, no golden regen — `digest-state` + `settings.digest` are per-device.

**Tech Stack:** TypeScript, React (Next.js forked), Vitest, existing `dashboard.ts` model, `graph-mail.ts` (`sendMail`), `secrets.ts`/`settings`, i18n EN/DE.

**Bound signatures (verified against current code):**
- `DashboardModel` (`dashboard.ts:183`): `overall.effective: Health` (`"R"|"A"|"G"` from `health.ts:24`), `overdue: Task[]`, `dueSoonMilestones: Milestone[]`, `overdueMilestones: Milestone[]`, `openRaidCount: number`.
- `RaidItem.severity?: RaidSeverity` = `"Low"|"Medium"|"High"|"Critical"` (`types.ts:116`); high = `High`/`Critical`.
- `sendMail(token, buildGraphMessage(to, subject, htmlBody))`, scope `MAIL_SEND_SCOPE` (`graph-mail.ts`).
- Notification fire pattern (`use-action-notifications.ts:94`): `new Notification(title, { body, tag })` guarded on `Notification.permission === "granted"`.
- `landing-state.ts`: `loadLandingState(projectId)` / `saveLandingState(projectId, state)`, cap 50, cleared by `clearAppConfig`.
- Settings sanitizer pattern: `use-settings.ts:267` load-merge (e.g. `dashboardDensity`), `writeSettings` spread (no allowlist edit).

---

## Task 1: `digest-model.ts` — pure digest projection

**Files:**
- Create: `src/app/digest/digest-model.ts`
- Test: `src/app/digest/digest-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/digest/digest-model.test.ts
import { describe, it, expect } from "vitest";
import { buildDigest, type DigestInput } from "./digest-model";
import type { DashboardModel } from "../dashboard";
import type { RaidItem, Task, Milestone } from "../types";

function task(id: number): Task {
  return { id, title: `T${id}`, status: "To Do" } as unknown as Task;
}
function milestone(id: number, date: string): Milestone {
  return { id, name: `M${id}`, date } as unknown as Milestone;
}
function raid(id: number, severity: RaidItem["severity"]): RaidItem {
  return { id, category: "Risk", status: "Open", severity } as unknown as RaidItem;
}
function model(over: Partial<DashboardModel>): DashboardModel {
  return {
    overall: { computed: "A", effective: "A", overridden: false },
    overdue: [], dueSoonMilestones: [], overdueMilestones: [], openRaidCount: 0,
    ...over,
  } as unknown as DashboardModel;
}

const BASE: DigestInput = {
  model: model({}),
  raid: [],
  prior: null,
};

describe("buildDigest", () => {
  it("projects RAG, overdue count, milestones-due-soon and open RAID with high count", () => {
    const input: DigestInput = {
      model: model({
        overall: { computed: "R", effective: "R", overridden: false },
        overdue: [task(1), task(2)],
        overdueMilestones: [milestone(10, "2026-07-01")],
        dueSoonMilestones: [milestone(11, "2026-07-15")],
        openRaidCount: 4,
      }),
      raid: [raid(1, "High"), raid(2, "Critical"), raid(3, "Low")],
      prior: null,
    };
    const d = buildDigest(input, "2026-07-10", "2026-07-10T09:00:00.000Z");
    expect(d.rag).toBe("R");
    expect(d.ragPrev).toBeNull();
    expect(d.overdue).toEqual({ count: 2, delta: null });
    expect(d.milestonesDueSoon.map((m) => m.id)).toEqual([10, 11]);
    expect(d.openRaid).toEqual({ count: 4, high: 2, delta: null });
    expect(d.generatedAt).toBe("2026-07-10T09:00:00.000Z");
  });

  it("computes deltas against a prior snapshot", () => {
    const input: DigestInput = {
      model: model({ overall: { computed: "R", effective: "R", overridden: false }, overdue: [task(1), task(2), task(3)], openRaidCount: 5 }),
      raid: [],
      prior: { rag: "A", overdue: 1, openRaid: 2 },
    };
    const d = buildDigest(input, "2026-07-10", "2026-07-10T09:00:00.000Z");
    expect(d.ragPrev).toBe("A");
    expect(d.overdue).toEqual({ count: 3, delta: 2 });
    expect(d.openRaid.delta).toBe(3);
  });

  it("returns a minimal model for an empty project (no crash)", () => {
    const d = buildDigest(BASE, "2026-07-10", "2026-07-10T09:00:00.000Z");
    expect(d.overdue.count).toBe(0);
    expect(d.milestonesDueSoon).toEqual([]);
    expect(d.openRaid).toEqual({ count: 0, high: 0, delta: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/digest/digest-model.test.ts`
Expected: FAIL — "Cannot find module './digest-model'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/digest/digest-model.ts
// Pure, i18n-free projection of the already-computed DashboardModel into the
// structured facts the weekly status digest renders/emails. No Date/now — the
// caller passes `today` and `generatedAt`. The digest is a PROJECTION of the
// dashboard model, so it can never disagree with the Dashboard.
import type { DashboardModel } from "../dashboard";
import type { Health } from "../health";
import type { Milestone, RaidItem } from "../types";

/** Prior snapshot for "since last digest" deltas (from the per-device store). */
export interface DigestPrior {
  rag: Health;
  overdue: number;
  openRaid: number;
}

export interface DigestInput {
  model: DashboardModel;
  raid: readonly RaidItem[];
  prior: DigestPrior | null;
}

export interface DigestMilestoneFact {
  id: number;
  name: string;
  date: string;
}

export interface DigestModel {
  rag: Health;
  ragPrev: Health | null;
  overdue: { count: number; delta: number | null };
  milestonesDueSoon: DigestMilestoneFact[];
  openRaid: { count: number; high: number; delta: number | null };
  generatedAt: string;
  /** Optional AI narrative paragraph, prepended when AI is enabled. */
  narrative?: string;
}

const HIGH_SEVERITIES: ReadonlySet<RaidItem["severity"]> = new Set(["High", "Critical"]);

/** Build the digest facts. `today` is the effective-zone today (YYYY-MM-DD);
 *  `generatedAt` is a full ISO instant. Both passed in (purity). */
export function buildDigest(input: DigestInput, today: string, generatedAt: string): DigestModel {
  const { model, raid, prior } = input;
  const overdueCount = model.overdue.length;
  const openRaid = model.openRaidCount;
  const high = raid.filter((r) => HIGH_SEVERITIES.has(r.severity)).length;
  // Overdue + due-soon milestones are the "coming up / already slipped" set.
  const milestonesDueSoon: DigestMilestoneFact[] = [
    ...model.overdueMilestones,
    ...model.dueSoonMilestones,
  ].map((m: Milestone) => ({ id: m.id, name: m.name, date: m.date }));
  return {
    rag: model.overall.effective,
    ragPrev: prior ? prior.rag : null,
    overdue: { count: overdueCount, delta: prior ? overdueCount - prior.overdue : null },
    milestonesDueSoon,
    openRaid: { count: openRaid, high, delta: prior ? openRaid - prior.openRaid : null },
    generatedAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/digest/digest-model.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/digest/digest-model.ts src/app/digest/digest-model.test.ts
git commit -m "feat(digest): pure digest-model projection of the dashboard model"
```

---

## Task 2: `digest-state.ts` — per-device cadence + prior-snapshot store

**Files:**
- Create: `src/app/digest/digest-state.ts`
- Test: `src/app/digest/digest-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/digest/digest-state.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadDigestState, advanceDigestState, isDigestDue, clearDigestState,
  DIGEST_STATE_MAX_PROJECTS, type DigestState,
} from "./digest-state";

beforeEach(() => localStorage.clear());

describe("digest-state", () => {
  it("returns null for an unknown project", () => {
    expect(loadDigestState("p1")).toBeNull();
  });

  it("advance sets lastRunAt=now, nextDueAt=now+cadenceDays, snapshots rag/metrics", () => {
    advanceDigestState("p1", {
      now: "2026-07-10T09:00:00.000Z", cadenceDays: 7, rag: "R",
      metrics: { overdue: 3, openRaid: 5 },
    });
    const s = loadDigestState("p1") as DigestState;
    expect(s.lastRunAt).toBe("2026-07-10T09:00:00.000Z");
    expect(s.nextDueAt).toBe("2026-07-17T09:00:00.000Z");
    expect(s.priorRag).toBe("R");
    expect(s.priorMetrics).toEqual({ overdue: 3, openRaid: 5 });
  });

  it("isDigestDue is true at/after nextDueAt, false before", () => {
    const s: DigestState = {
      lastRunAt: "2026-07-10T09:00:00.000Z", nextDueAt: "2026-07-17T09:00:00.000Z",
      priorRag: "G", priorMetrics: { overdue: 0, openRaid: 0 },
    };
    expect(isDigestDue(s, "2026-07-16T09:00:00.000Z")).toBe(false);
    expect(isDigestDue(s, "2026-07-17T09:00:00.000Z")).toBe(true);
    expect(isDigestDue(s, "2026-07-18T00:00:00.000Z")).toBe(true);
  });

  it("keeps projects isolated and caps at DIGEST_STATE_MAX_PROJECTS", () => {
    for (let i = 0; i < DIGEST_STATE_MAX_PROJECTS + 5; i++) {
      advanceDigestState(`p${i}`, {
        now: `2026-07-10T09:00:0${(i % 10)}.000Z`, cadenceDays: 7, rag: "A",
        metrics: { overdue: i, openRaid: 0 },
      });
    }
    // Oldest evicted; a recent one survives.
    expect(loadDigestState(`p${DIGEST_STATE_MAX_PROJECTS + 4}`)).not.toBeNull();
    const raw = JSON.parse(localStorage.getItem("lop-app:digest-state") || "{}");
    expect(Object.keys(raw).length).toBeLessThanOrEqual(DIGEST_STATE_MAX_PROJECTS);
  });

  it("treats malformed storage as absent (no crash)", () => {
    localStorage.setItem("lop-app:digest-state", "not json");
    expect(loadDigestState("p1")).toBeNull();
  });

  it("clearDigestState wipes the key", () => {
    advanceDigestState("p1", { now: "2026-07-10T09:00:00.000Z", cadenceDays: 7, rag: "A", metrics: { overdue: 0, openRaid: 0 } });
    clearDigestState();
    expect(localStorage.getItem("lop-app:digest-state")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/digest/digest-state.test.ts`
Expected: FAIL — "Cannot find module './digest-state'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/digest/digest-state.ts
// Per-device, per-project cadence + prior-snapshot store for the weekly digest.
// Mirrors landing-state.ts: single localStorage key, capped, validated load,
// OUT of exports/Turso, swept by clearAppConfig's `lop-app:*` sweep. NOT a
// Workspace field (zero backend write paths).
import type { Health } from "../health";

export const DIGEST_STATE_KEY = "lop-app:digest-state";
export const DIGEST_STATE_MAX_PROJECTS = 50;

export interface DigestMetrics {
  overdue: number;
  openRaid: number;
}

export interface DigestState {
  lastRunAt: string;
  nextDueAt: string;
  priorRag: Health;
  priorMetrics: DigestMetrics;
}

type StateMap = Record<string, DigestState>;

const RAGS: ReadonlySet<string> = new Set(["R", "A", "G"]);

function isState(v: unknown): v is DigestState {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const m = o.priorMetrics as Record<string, unknown> | undefined;
  return (
    typeof o.lastRunAt === "string" &&
    typeof o.nextDueAt === "string" &&
    typeof o.priorRag === "string" && RAGS.has(o.priorRag) &&
    typeof m === "object" && m !== null &&
    typeof m.overdue === "number" && typeof m.openRaid === "number"
  );
}

function loadMap(): StateMap {
  try {
    const raw = localStorage.getItem(DIGEST_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: StateMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isState(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveMap(map: StateMap): void {
  // Cap: keep the most-recently-run projects (by lastRunAt desc).
  const entries = Object.entries(map).sort((a, b) => b[1].lastRunAt.localeCompare(a[1].lastRunAt));
  const capped = Object.fromEntries(entries.slice(0, DIGEST_STATE_MAX_PROJECTS));
  try {
    localStorage.setItem(DIGEST_STATE_KEY, JSON.stringify(capped));
  } catch {
    /* storage full / unavailable — non-fatal (digest is advisory) */
  }
}

export function loadDigestState(projectId: string): DigestState | null {
  return loadMap()[projectId] ?? null;
}

/** Advance the cadence: record this run and schedule the next. `now` is a full
 *  ISO instant; `nextDueAt = now + cadenceDays`. */
export function advanceDigestState(
  projectId: string,
  args: { now: string; cadenceDays: number; rag: Health; metrics: DigestMetrics },
): void {
  const next = new Date(Date.parse(args.now) + args.cadenceDays * 86_400_000).toISOString();
  const map = loadMap();
  map[projectId] = {
    lastRunAt: args.now,
    nextDueAt: next,
    priorRag: args.rag,
    priorMetrics: args.metrics,
  };
  saveMap(map);
}

export function isDigestDue(state: DigestState, now: string): boolean {
  return Date.parse(now) >= Date.parse(state.nextDueAt);
}

export function clearDigestState(): void {
  try {
    localStorage.removeItem(DIGEST_STATE_KEY);
  } catch {
    /* non-fatal */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/digest/digest-state.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/digest/digest-state.ts src/app/digest/digest-state.test.ts
git commit -m "feat(digest): per-device digest cadence + prior-snapshot store"
```

---

## Task 3: `digest-email.ts` — brand HTML + subject builder

**Files:**
- Create: `src/app/digest/digest-email.ts`
- Test: `src/app/digest/digest-email.test.ts`

Email clients ignore CSS variables, so inline literal hex (AIPM brand): dark-blue `#003c78`, red `#d0021b`, amber `#f5a623`, green `#417505`. All fact text HTML-escaped.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/digest/digest-email.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildDigestEmailHtml, buildDigestEmailSubject } from "./digest-email";
import { loadI18n } from "../i18n";
import type { DigestModel } from "./digest-model";

const MODEL: DigestModel = {
  rag: "R", ragPrev: "A",
  overdue: { count: 2, delta: 1 },
  milestonesDueSoon: [{ id: 10, name: "Design <sign-off>", date: "2026-07-15" }],
  openRaid: { count: 4, high: 2, delta: 3 },
  generatedAt: "2026-07-10T09:00:00.000Z",
};

beforeAll(async () => {
  await loadI18n("de");
});

describe("digest email", () => {
  it("subject carries the project RAG", () => {
    expect(buildDigestEmailSubject(MODEL, "en-US")).toMatch(/digest/i);
  });

  it("html contains the facts and escapes user-derived text", () => {
    const html = buildDigestEmailHtml(MODEL, "en-US");
    expect(html).toContain("2"); // overdue count
    expect(html).toContain("Design &lt;sign-off&gt;"); // escaped milestone name
    expect(html).not.toContain("Design <sign-off>"); // never raw
    expect(html).toContain("#d0021b"); // red brand hex for RAG=R
  });

  it("renders German labels when lang=de", () => {
    const html = buildDigestEmailHtml(MODEL, "de");
    expect(html.length).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/digest/digest-email.test.ts`
Expected: FAIL — "Cannot find module './digest-email'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/digest/digest-email.ts
// Pure brand-inline HTML + subject for the Graph-sent digest email. Email
// clients ignore CSS vars → literal AIPM hex. All fact text HTML-escaped; no
// user free-text is injected unescaped.
import { t, type Lang } from "../i18n";
import type { Health } from "../health";
import type { DigestModel } from "./digest-model";

const RAG_HEX: Record<Health, string> = { R: "#d0021b", A: "#f5a623", G: "#417505" };
const DARK_BLUE = "#003c78";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ragLabel(lang: Lang, h: Health): string {
  return t(lang, h === "R" ? "healthRed" : h === "A" ? "healthAmber" : "healthGreen");
}

export function buildDigestEmailSubject(model: DigestModel, lang: Lang): string {
  return t(lang, "digestEmailSubject", ragLabel(lang, model.rag));
}

export function buildDigestEmailHtml(model: DigestModel, lang: Lang): string {
  const rows: string[] = [];
  rows.push(
    `<tr><td style="padding:4px 8px;color:${DARK_BLUE};font-weight:bold">${esc(t(lang, "digestRag"))}</td>` +
      `<td style="padding:4px 8px;color:${RAG_HEX[model.rag]};font-weight:bold">${esc(ragLabel(lang, model.rag))}</td></tr>`,
  );
  rows.push(
    `<tr><td style="padding:4px 8px">${esc(t(lang, "digestOverdue"))}</td>` +
      `<td style="padding:4px 8px">${model.overdue.count}</td></tr>`,
  );
  rows.push(
    `<tr><td style="padding:4px 8px">${esc(t(lang, "digestOpenRaid"))}</td>` +
      `<td style="padding:4px 8px">${model.openRaid.count} (${model.openRaid.high} ${esc(t(lang, "digestHigh"))})</td></tr>`,
  );
  const ms = model.milestonesDueSoon
    .map((m) => `<li>${esc(m.name)} — ${esc(m.date)}</li>`)
    .join("");
  const narrative = model.narrative
    ? `<p style="margin:0 0 12px 0">${esc(model.narrative)}</p>`
    : "";
  return (
    `<div style="font-family:Arial,sans-serif;color:#222;max-width:600px">` +
    `<h2 style="color:${DARK_BLUE};margin:0 0 12px 0">${esc(t(lang, "digestTitle"))}</h2>` +
    narrative +
    `<table style="border-collapse:collapse;margin-bottom:12px">${rows.join("")}</table>` +
    (ms
      ? `<h3 style="color:${DARK_BLUE};margin:0 0 4px 0">${esc(t(lang, "digestMilestonesDueSoon"))}</h3><ul style="margin:0 0 12px 18px;padding:0">${ms}</ul>`
      : "") +
    `</div>`
  );
}
```

- [ ] **Step 4: Add the i18n keys used above (EN)**

Add to `src/app/i18n.ts` (English dict), keeping alpha-ish grouping near other `digest*`/`health*` keys. If `healthRed`/`healthAmber`/`healthGreen` already exist, reuse them — check first with `grep -n "healthRed" src/app/i18n.ts`; only add the ones missing.

```ts
  digestTitle: "Weekly status digest",
  digestEmailSubject: "Weekly status digest — {0}",
  digestRag: "Overall status",
  digestOverdue: "Overdue tasks",
  digestOpenRaid: "Open RAID",
  digestHigh: "high",
  digestMilestonesDueSoon: "Milestones due soon",
```

(If `healthRed`/`healthAmber`/`healthGreen` are absent, add: `healthRed: "Red"`, `healthAmber: "Amber"`, `healthGreen: "Green"`.)

- [ ] **Step 5: Add the same keys to DE via node utf8 write (CRLF-safe, real umlauts)**

`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts — patch via node. Run:

```bash
node -e '
const fs=require("fs");const p="src/app/i18n.de.ts";let s=fs.readFileSync(p,"utf8");
const anchor="\r\n};\r\n";
const add=[
  "  digestTitle: \"Wöchentliche Statuszusammenfassung\",",
  "  digestEmailSubject: \"Wöchentliche Statuszusammenfassung — {0}\",",
  "  digestRag: \"Gesamtstatus\",",
  "  digestOverdue: \"Überfällige Aufgaben\",",
  "  digestOpenRaid: \"Offene RAID\",",
  "  digestHigh: \"hoch\",",
  "  digestMilestonesDueSoon: \"Bald fällige Meilensteine\",",
].join("\r\n")+"\r\n";
const i=s.lastIndexOf(anchor);
s=s.slice(0,i)+"\r\n"+add+s.slice(i+2);
fs.writeFileSync(p,s);
'
```

Then verify: `grep -c "digestTitle" src/app/i18n.de.ts` → `1`; `npm run test:run -- i18n-encoding` passes (bans ASCII umlaut subs). Adjust the anchor if `lastIndexOf("\r\n};\r\n")` doesn't land at the dict close — inspect with `grep -n "^};" src/app/i18n.de.ts`.

- [ ] **Step 6: Run tests**

Run: `npm run test:run -- src/app/digest/digest-email.test.ts` and `npx tsc --noEmit` (i18n EN/DE parity enforced).
Expected: PASS. If tsc reports a missing DE key, add it via the node script above.

- [ ] **Step 7: Commit**

```bash
git add src/app/digest/digest-email.ts src/app/digest/digest-email.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(digest): brand HTML + subject builder for the Graph digest email"
```

---

## Task 4: `settings.digest` config + sanitizer

**Files:**
- Modify: `src/app/settings-types.ts` (add `digest?` to the settings type + `defaultSettings`)
- Modify: `src/app/use-settings.ts` (sanitize on the load merge, ~line 267 alongside `dashboardDensity`)
- Test: `src/app/use-settings.test.ts` (add a digest sanitize case) — if that file doesn't exist, create `src/app/digest/digest-config.test.ts` testing an exported `sanitizeDigestConfig`.

To keep the sanitizer pure and testable, put the clamp in a small exported helper.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/digest/digest-config.test.ts
import { describe, it, expect } from "vitest";
import { sanitizeDigestConfig, DEFAULT_DIGEST_CONFIG } from "./digest-config";

describe("sanitizeDigestConfig", () => {
  it("defaults to disabled, 7-day cadence", () => {
    expect(sanitizeDigestConfig(undefined)).toEqual(DEFAULT_DIGEST_CONFIG);
    expect(DEFAULT_DIGEST_CONFIG).toEqual({ enabled: false, cadenceDays: 7 });
  });
  it("enabled only when strictly true; cadence clamped int 1..90", () => {
    expect(sanitizeDigestConfig({ enabled: true, cadenceDays: 14 })).toEqual({ enabled: true, cadenceDays: 14 });
    expect(sanitizeDigestConfig({ enabled: "yes", cadenceDays: 0 })).toEqual({ enabled: false, cadenceDays: 7 });
    expect(sanitizeDigestConfig({ enabled: true, cadenceDays: 999 })).toEqual({ enabled: true, cadenceDays: 90 });
    expect(sanitizeDigestConfig({ enabled: true, cadenceDays: 3.7 })).toEqual({ enabled: true, cadenceDays: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/digest/digest-config.test.ts`
Expected: FAIL — "Cannot find module './digest-config'".

- [ ] **Step 3: Create the config helper**

```ts
// src/app/digest/digest-config.ts
// Pure per-device digest config sanitizer. Rides the writeSettings spread (no
// allowlist edit), mirrors dashboardDensity/tasksViewMode.
export interface DigestConfig {
  enabled: boolean;
  cadenceDays: number;
}

export const DEFAULT_DIGEST_CONFIG: DigestConfig = { enabled: false, cadenceDays: 7 };

const MIN_CADENCE = 1;
const MAX_CADENCE = 90;

export function sanitizeDigestConfig(v: unknown): DigestConfig {
  if (typeof v !== "object" || v === null) return { ...DEFAULT_DIGEST_CONFIG };
  const o = v as Record<string, unknown>;
  const enabled = o.enabled === true;
  const raw = typeof o.cadenceDays === "number" && Number.isFinite(o.cadenceDays) ? Math.trunc(o.cadenceDays) : 7;
  const cadenceDays = Math.min(MAX_CADENCE, Math.max(MIN_CADENCE, raw));
  return { enabled, cadenceDays };
}
```

- [ ] **Step 4: Wire into settings type + defaults + load merge**

In `src/app/settings-types.ts`, add to the settings interface (near `dashboardDensity?`):

```ts
  digest?: import("./digest/digest-config").DigestConfig;
```

and to `defaultSettings` (near `dashboardDensity: "comfortable",`):

```ts
  digest: { enabled: false, cadenceDays: 7 },
```

In `src/app/use-settings.ts` load-merge block (where `dashboardDensity` is sanitized, ~line 267), add:

```ts
            digest: sanitizeDigestConfig((parsed as Record<string, unknown>).digest),
```

and import at the top of `use-settings.ts`:

```ts
import { sanitizeDigestConfig } from "./digest/digest-config";
```

- [ ] **Step 5: Run test + typecheck**

Run: `npm run test:run -- src/app/digest/digest-config.test.ts` then `npx tsc --noEmit`.
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/digest/digest-config.ts src/app/digest/digest-config.test.ts src/app/settings-types.ts src/app/use-settings.ts
git commit -m "feat(digest): per-device digest config (enabled + cadenceDays) with sanitizer"
```

---

## Task 5: `digest-narrative.ts` — optional AI narrative (forced-tool)

**Files:**
- Create: `src/app/digest/digest-narrative.ts`
- Test: `src/app/digest/digest-narrative.test.ts`

Mirror `scheduled-job-analysis.ts` security EXACTLY: never log/echo apiKey or body; thrown errors carry only HTTP-status digits or `"parse"`. Read `src/app/scheduled-job-analysis.ts` in full first and copy its `callClaude` usage + error shape.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/digest/digest-narrative.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildDigestNarrativePrompt, parseDigestNarrative } from "./digest-narrative";
import type { DigestModel } from "./digest-model";

const MODEL: DigestModel = {
  rag: "R", ragPrev: "A",
  overdue: { count: 2, delta: 1 },
  milestonesDueSoon: [{ id: 1, name: "M1", date: "2026-07-15" }],
  openRaid: { count: 4, high: 2, delta: 3 },
  generatedAt: "2026-07-10T09:00:00.000Z",
};

describe("digest narrative", () => {
  it("prompt summarizes the facts without leaking a key", () => {
    const p = buildDigestNarrativePrompt(MODEL, "en-US");
    expect(p).toContain("Red");
    expect(p).toContain("2"); // overdue
    expect(p).not.toMatch(/sk-ant/);
  });

  it("parseDigestNarrative strips control chars and caps length", () => {
    expect(parseDigestNarrative("Project slipped.\u0000\u0007")).toBe("Project slipped.");
    const long = "x".repeat(5000);
    expect(parseDigestNarrative(long).length).toBeLessThanOrEqual(2000);
  });

  it("parseDigestNarrative returns '' for non-string", () => {
    expect(parseDigestNarrative(undefined as unknown as string)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/digest/digest-narrative.test.ts`
Expected: FAIL — "Cannot find module './digest-narrative'".

- [ ] **Step 3: Implement (pure helpers + the call)**

```ts
// src/app/digest/digest-narrative.ts
// Optional AI narrative for the weekly digest. ONE forced-tool Anthropic call
// (no agentic loop), mirroring scheduled-job-analysis.ts. NEVER logs/echoes the
// key or response body; thrown errors carry only status digits or "parse".
import { callClaude, type SystemBlock } from "../chat-api";
import { t, type Lang } from "../i18n";
import type { DigestModel } from "./digest-model";

// Shared control-char scrub (hex escapes — never literal control bytes).
const CONTROL_CHARS = /[\x00-\x1f]/g;
const MAX_NARRATIVE = 2000;

export function buildDigestNarrativePrompt(model: DigestModel, lang: Lang): string {
  const rag = model.rag === "R" ? "Red" : model.rag === "A" ? "Amber" : "Green";
  const ms = model.milestonesDueSoon.map((m) => `${m.name} (${m.date})`).join(", ") || "none";
  return (
    `Write ONE short paragraph (max 3 sentences) summarizing this project's weekly status for a PM. ` +
    `Language: ${lang === "de" ? "German" : "English"}. Facts:\n` +
    `- Overall RAG: ${rag}\n` +
    `- Overdue tasks: ${model.overdue.count}\n` +
    `- Open RAID: ${model.openRaid.count} (${model.openRaid.high} high)\n` +
    `- Milestones due soon: ${ms}\n` +
    `Return prose only, no headings or lists.`
  );
}

/** Sanitize untrusted model text before render/email. */
export function parseDigestNarrative(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.replace(CONTROL_CHARS, "").trim().slice(0, MAX_NARRATIVE);
}

export interface DigestNarrativeCtx {
  apiKey: string;
  model: string;
  lang: Lang;
}

/** Returns a sanitized narrative paragraph, or throws with status-only info.
 *  Caller catches → "". */
export async function runDigestNarrative(digest: DigestModel, ctx: DigestNarrativeCtx): Promise<string> {
  const system: SystemBlock[] = [{ type: "text", text: "You are a concise project-status writer." }];
  const prompt = buildDigestNarrativePrompt(digest, ctx.lang);
  const res = await callClaude({
    apiKey: ctx.apiKey,
    model: ctx.model,
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 300,
  });
  // callClaude returns display items; take the first text block (mirror
  // scheduled-job-analysis.ts extraction — adjust field to the real shape).
  const first = res.find((b) => b.type === "text");
  return parseDigestNarrative(first && "text" in first ? first.text : "");
}
```

> **Implementer note:** the `callClaude` argument + return shapes MUST match `chat-api.ts` exactly — read `scheduled-job-analysis.ts` and copy its call/extraction verbatim, adjusting only the prompt. If `callClaude`'s signature differs (e.g. positional args, a different return type), conform to it; the pure `buildDigestNarrativePrompt`/`parseDigestNarrative` are the tested surface and stay as above.

- [ ] **Step 4: Run test + typecheck**

Run: `npm run test:run -- src/app/digest/digest-narrative.test.ts` then `npx tsc --noEmit`.
Expected: PASS (pure helpers); tsc clean once `callClaude` usage conforms.

- [ ] **Step 5: Commit**

```bash
git add src/app/digest/digest-narrative.ts src/app/digest/digest-narrative.test.ts
git commit -m "feat(digest): optional AI narrative (forced-tool, fail-soft)"
```

---

## Task 6: `use-digest.ts` — cadence + manual + delivery hook

**Files:**
- Create: `src/app/use-digest.ts`
- Test: `src/app/use-digest.test.tsx`
- Modify: `vitest.config.ts` (add `src/app/use-digest.ts` to `coverage.exclude` — render-scope UI glue, like other Phase-3 `use*` glue hooks)

The hook takes a typed `deps` object of live render-scope values and returns non-memoized handlers, called unconditionally before the consumer's single return.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/use-digest.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDigest, type UseDigestDeps } from "./use-digest";
import { advanceDigestState } from "./digest/digest-state";
import type { DashboardModel } from "./dashboard";

function model(rag: "R" | "A" | "G" = "A"): DashboardModel {
  return {
    overall: { computed: rag, effective: rag, overridden: false },
    overdue: [], dueSoonMilestones: [], overdueMilestones: [], openRaidCount: 0,
  } as unknown as DashboardModel;
}

function deps(over: Partial<UseDigestDeps> = {}): UseDigestDeps {
  return {
    projectId: "p1",
    isPopout: false,
    lang: "en-US",
    now: () => "2026-07-10T09:00:00.000Z",
    today: "2026-07-10",
    getModel: () => model(),
    getRaid: () => [],
    config: { enabled: false, cadenceDays: 7 },
    aiKey: null,
    aiModel: "claude-sonnet-5",
    m365Configured: false,
    acquireToken: vi.fn(),
    sendDigestMail: vi.fn(),
    fireNotification: vi.fn(),
    showToast: vi.fn(),
    runNarrative: vi.fn(),
    ...over,
  };
}

beforeEach(() => localStorage.clear());

describe("useDigest", () => {
  it("generateNow builds a digest and advances state even when disabled", async () => {
    const { result } = renderHook(() => useDigest(deps({ config: { enabled: false, cadenceDays: 7 } })));
    await act(async () => { await result.current.generateNow(); });
    expect(result.current.digest?.rag).toBe("A");
    // state advanced → nextDueAt set
    const raw = JSON.parse(localStorage.getItem("lop-app:digest-state") || "{}");
    expect(raw.p1?.nextDueAt).toBe("2026-07-17T09:00:00.000Z");
  });

  it("does NOT auto-fire when disabled and not due", () => {
    const fire = vi.fn();
    renderHook(() => useDigest(deps({ config: { enabled: false, cadenceDays: 7 }, fireNotification: fire })));
    expect(fire).not.toHaveBeenCalled();
  });

  it("auto-fires + notifies on mount when enabled and due", async () => {
    // prior run 8 days ago → due
    advanceDigestState("p1", { now: "2026-07-02T09:00:00.000Z", cadenceDays: 7, rag: "G", metrics: { overdue: 0, openRaid: 0 } });
    const fire = vi.fn();
    await act(async () => {
      renderHook(() => useDigest(deps({ config: { enabled: true, cadenceDays: 7 }, fireNotification: fire })));
    });
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("popout is read-only: no advance, no send, no notify", async () => {
    const fire = vi.fn();
    const { result } = renderHook(() => useDigest(deps({ isPopout: true, fireNotification: fire })));
    await act(async () => { await result.current.generateNow(); });
    expect(fire).not.toHaveBeenCalled();
    expect(localStorage.getItem("lop-app:digest-state")).toBeNull();
  });

  it("emailDigest sends via Graph when m365 configured", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDigest(deps({ m365Configured: true, sendDigestMail: send })));
    await act(async () => { await result.current.generateNow(); });
    await act(async () => { await result.current.emailDigest(); });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("AI-off → no narrative on the digest", async () => {
    const runNarrative = vi.fn();
    const { result } = renderHook(() => useDigest(deps({ aiKey: null, runNarrative })));
    await act(async () => { await result.current.generateNow(); });
    expect(runNarrative).not.toHaveBeenCalled();
    expect(result.current.digest?.narrative).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/use-digest.test.tsx`
Expected: FAIL — "Cannot find module './use-digest'".

- [ ] **Step 3: Implement the hook**

```ts
// src/app/use-digest.ts
// Render-scope glue for the weekly status digest: cadence check (mount +
// visibility), manual generate, optional AI narrative, and the three delivery
// dispatches (card = returned state, Graph email, desktop notification). Reads
// live scope each render → NON-memoized handlers, called unconditionally.
// Coverage-excluded UI glue (see vitest.config.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "./i18n";
import type { DashboardModel } from "./dashboard";
import type { RaidItem } from "./types";
import { buildDigest, type DigestModel } from "./digest/digest-model";
import {
  loadDigestState, advanceDigestState, isDigestDue,
} from "./digest/digest-state";
import { buildDigestEmailHtml, buildDigestEmailSubject } from "./digest/digest-email";
import { runDigestNarrative, parseDigestNarrative } from "./digest/digest-narrative";
import type { DigestConfig } from "./digest/digest-config";

export interface UseDigestDeps {
  projectId: string;
  isPopout: boolean;
  lang: Lang;
  /** Full ISO instant supplier (never new Date() in render). */
  now: () => string;
  today: string;
  getModel: () => DashboardModel;
  getRaid: () => readonly RaidItem[];
  config: DigestConfig;
  aiKey: string | null;
  aiModel: string;
  m365Configured: boolean;
  acquireToken: (scopes: readonly string[], opts?: { interactive?: boolean }) => Promise<string | null>;
  sendDigestMail: (token: string, subject: string, html: string) => Promise<void>;
  fireNotification: (title: string, body: string) => void;
  showToast: (msg: string, kind: "error" | "info") => void;
  runNarrative?: typeof runDigestNarrative;
}

export interface UseDigestApi {
  digest: DigestModel | null;
  generateNow: () => Promise<void>;
  emailDigest: () => Promise<void>;
  busy: boolean;
}

export function useDigest(deps: UseDigestDeps): UseDigestApi {
  const [digest, setDigest] = useState<DigestModel | null>(null);
  const [busy, setBusy] = useState(false);
  const autoHandled = useRef(false);

  // Core generation (shared by manual + cadence). `notify` fires the desktop
  // notification (cadence path only). Advances state on success.
  const generate = useCallback(
    async (notify: boolean): Promise<DigestModel | null> => {
      if (deps.isPopout) return null;
      setBusy(true);
      try {
        const model = deps.getModel();
        const prior = loadDigestState(deps.projectId);
        const now = deps.now();
        let d = buildDigest(
          { model, raid: deps.getRaid(), prior: prior ? { rag: prior.priorRag, overdue: prior.priorMetrics.overdue, openRaid: prior.priorMetrics.openRaid } : null },
          deps.today,
          now,
        );
        if (deps.aiKey) {
          try {
            const runner = deps.runNarrative ?? runDigestNarrative;
            const text = await runner(d, { apiKey: deps.aiKey, model: deps.aiModel, lang: deps.lang });
            const narrative = parseDigestNarrative(text);
            if (narrative) d = { ...d, narrative };
          } catch {
            /* AI fail-soft: deterministic digest stands */
          }
        }
        setDigest(d);
        advanceDigestState(deps.projectId, {
          now,
          cadenceDays: deps.config.cadenceDays,
          rag: d.rag,
          metrics: { overdue: d.overdue.count, openRaid: d.openRaid.count },
        });
        if (notify) deps.fireNotification("digest", `${d.rag}`);
        return d;
      } finally {
        setBusy(false);
      }
    },
    [deps],
  );

  // Cadence auto-fire on mount when enabled & due (render-time nonce guard, not
  // set-state-in-effect for the decision; the async work runs in the effect).
  useEffect(() => {
    if (deps.isPopout || !deps.config.enabled || autoHandled.current) return;
    autoHandled.current = true;
    const state = loadDigestState(deps.projectId);
    const due = state ? isDigestDue(state, deps.now()) : true; // never run → due
    if (due) void generate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.projectId, deps.config.enabled]);

  const generateNow = useCallback(async () => {
    await generate(false);
  }, [generate]);

  const emailDigest = useCallback(async () => {
    if (deps.isPopout || !deps.m365Configured) return;
    const d = digest ?? (await generate(false));
    if (!d) return;
    try {
      const token = await deps.acquireToken(["Mail.Send"], { interactive: true });
      if (!token) return;
      await deps.sendDigestMail(token, buildDigestEmailSubject(d, deps.lang), buildDigestEmailHtml(d, deps.lang));
    } catch (err) {
      deps.showToast(String((err as Error)?.message ?? "error"), "error");
    }
  }, [deps, digest, generate]);

  return { digest, generateNow, emailDigest, busy };
}
```

> **Implementer note:** wire the real primitives at the task-manager call site (Task 7): `acquireToken` = `useMsAuth().acquireToken`; `sendDigestMail` = `(token, subject, html) => sendMail(token, buildGraphMessage(userEmail, subject, html))` from `graph-mail.ts` (recipient = signed-in user's email); `fireNotification` = the guarded `new Notification(t(lang,"digestNotifyTitle"), { body, tag: "lop-digest" })` block copied from `use-action-notifications.ts:94`; `showToast` = `useToastContext()`; `now` = `() => new Date().toISOString()` (a callback, not a render read). Replace the placeholder `fireNotification("digest", rag)` args with translated strings there.

- [ ] **Step 4: Add coverage exclude**

In `vitest.config.ts`, add `"src/app/use-digest.ts"` to the `coverage.exclude` array (next to the other `use-*.ts` glue hooks).

- [ ] **Step 5: Run test + typecheck + lint**

Run: `npm run test:run -- src/app/use-digest.test.tsx`, then `npx tsc --noEmit`, then `npm run lint`.
Expected: PASS; tsc clean; lint clean (watch the exhaustive-deps disable comment — keep it targeted).

- [ ] **Step 6: Commit**

```bash
git add src/app/use-digest.ts src/app/use-digest.test.tsx vitest.config.ts
git commit -m "feat(digest): cadence + manual + delivery hook (use-digest)"
```

---

## Task 7: `digest-card.tsx` + Dashboard wiring

**Files:**
- Create: `src/app/dashboard-sections/digest-card.tsx`
- Test: `src/app/dashboard-sections/digest-card.test.tsx`
- Modify: `src/app/dashboard-panel.tsx` (render the card in the headline zone; thread a `digest?` prop group)
- Modify: `src/app/task-manager.tsx` (instantiate `useDigest` above the view; pass its api + `onEmail`/`onGenerate` down through `DashboardPanelProps`)

Follow the existing coaching/tip card pattern for the headline slot + self-hide.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/dashboard-sections/digest-card.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DigestCard } from "./digest-card";
import { densityClasses } from "../dashboard-density";
import type { DigestModel } from "../digest/digest-model";

const dc = densityClasses("comfortable");
const MODEL: DigestModel = {
  rag: "R", ragPrev: "A",
  overdue: { count: 2, delta: 1 },
  milestonesDueSoon: [{ id: 1, name: "M1", date: "2026-07-15" }],
  openRaid: { count: 4, high: 2, delta: 3 },
  generatedAt: "2026-07-10T09:00:00.000Z",
};

describe("DigestCard", () => {
  it("returns null when there is no digest", () => {
    const { container } = render(
      <DigestCard lang="en-US" digest={null} dc={dc} m365Configured={false} busy={false} onGenerate={vi.fn()} onEmail={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders facts + a labeled Generate button", () => {
    render(
      <DigestCard lang="en-US" digest={MODEL} dc={dc} m365Configured={false} busy={false} onGenerate={vi.fn()} onEmail={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it("hides the Email button when M365 is not configured", () => {
    render(
      <DigestCard lang="en-US" digest={MODEL} dc={dc} m365Configured={false} busy={false} onGenerate={vi.fn()} onEmail={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /email/i })).toBeNull();
  });

  it("shows the Email button when M365 is configured", () => {
    render(
      <DigestCard lang="en-US" digest={MODEL} dc={dc} m365Configured busy={false} onGenerate={vi.fn()} onEmail={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /email/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/dashboard-sections/digest-card.test.tsx`
Expected: FAIL — "Cannot find module './digest-card'".

- [ ] **Step 3: Implement the card**

```tsx
// src/app/dashboard-sections/digest-card.tsx
// Presentational Dashboard headline card for the weekly status digest. Same
// slot family as DashboardCoachingCard/TipCard; self-hides when no digest.
import { t, type Lang } from "../i18n";
import { INTERACTIVE } from "../interaction-styles";
import { healthDot } from "../health";
import type { DensityClasses } from "../dashboard-density";
import type { DigestModel } from "../digest/digest-model";

export interface DigestCardProps {
  lang: Lang;
  digest: DigestModel | null;
  dc: DensityClasses;
  m365Configured: boolean;
  busy: boolean;
  onGenerate: () => void;
  onEmail: () => void;
}

export function DigestCard({ lang, digest, dc, m365Configured, busy, onGenerate, onEmail }: DigestCardProps) {
  if (!digest) return null;
  return (
    <div className={`rounded-xl border border-line ${dc.cardPad}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-AIPM-dark-blue">{t(lang, "digestTitle")}</h3>
        <span className={`inline-block h-3 w-3 rounded-full ${healthDot(digest.rag)}`} role="img" aria-label={t(lang, digest.rag === "R" ? "healthRed" : digest.rag === "A" ? "healthAmber" : "healthGreen")} />
      </div>
      {digest.narrative ? <p className="mt-2 text-sm text-muted-foreground">{digest.narrative}</p> : null}
      <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
        <dt>{t(lang, "digestOverdue")}</dt><dd>{digest.overdue.count}</dd>
        <dt>{t(lang, "digestOpenRaid")}</dt><dd>{digest.openRaid.count} ({digest.openRaid.high} {t(lang, "digestHigh")})</dd>
        <dt>{t(lang, "digestMilestonesDueSoon")}</dt><dd>{digest.milestonesDueSoon.length}</dd>
      </dl>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onGenerate} disabled={busy} className={`rounded-md border border-line px-3 py-1 text-sm ${INTERACTIVE}`}>
          {t(lang, "digestGenerateNow")}
        </button>
        {m365Configured ? (
          <button type="button" onClick={onEmail} disabled={busy} className={`rounded-md border border-line px-3 py-1 text-sm ${INTERACTIVE}`}>
            {t(lang, "digestEmail")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the card i18n keys (EN then DE via node script)**

EN in `src/app/i18n.ts`: `digestGenerateNow: "Generate now"`, `digestEmail: "Email digest"`, `digestNotifyTitle: "Weekly digest ready"`, `digestEmailFailed: "Couldn't send the digest email."`.

DE via node (append with the Task 3 script pattern): `digestGenerateNow: "Jetzt erstellen"`, `digestEmail: "Zusammenfassung per E-Mail"`, `digestNotifyTitle: "Wöchentliche Zusammenfassung bereit"`, `digestEmailFailed: "Zusammenfassung konnte nicht per E-Mail gesendet werden."`.

- [ ] **Step 5: Verify `healthDot`/`DensityClasses` names**

Run: `grep -n "export function healthDot\|export type DensityClasses\|export interface DensityClasses" src/app/health.ts src/app/dashboard-density.ts`. If `DensityClasses` is exported under another name (e.g. the return type of `densityClasses`), import that exact name; if `healthDot` takes different args, conform. Fix imports before running tests.

- [ ] **Step 6: Wire into dashboard-panel + task-manager**

In `src/app/dashboard-panel.tsx`, add optional props to `DashboardPanelProps`:

```ts
  digest?: DigestModel | null;
  digestBusy?: boolean;
  onGenerateDigest?: () => void;
  onEmailDigest?: () => void;
  m365Configured?: boolean;
```

and render in the headline zone (after `DashboardCoachingCard`), gated so absent props = no card:

```tsx
{props.onGenerateDigest ? (
  <DigestCard
    lang={lang}
    digest={props.digest ?? null}
    dc={dc}
    m365Configured={props.m365Configured ?? false}
    busy={props.digestBusy ?? false}
    onGenerate={props.onGenerateDigest}
    onEmail={props.onEmailDigest ?? (() => {})}
  />
) : null}
```

In `src/app/task-manager.tsx`, instantiate `useDigest(...)` above the view (next to the other above-view hooks like the AI action analysis), wiring the real primitives per the Task 6 implementer note, and pass `digest`/`digestBusy`/`onGenerateDigest`/`onEmailDigest`/`m365Configured` into the `DashboardPanel` render. Gate the whole group `isPopout ? undefined` so popouts stay read-only.

- [ ] **Step 7: Run tests + tsc + lint + size**

Run: `npm run test:run -- src/app/dashboard-sections/digest-card.test.tsx`, `npx tsc --noEmit`, `npm run lint`, `npm run size:check`.
Expected: PASS; if `size:check` flags `dashboard-panel.tsx`/`task-manager.tsx` growth over the ratchet, run `node scripts/check-file-sizes.mjs --update` (legit growth) and re-commit the baseline.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard-sections/digest-card.tsx src/app/dashboard-sections/digest-card.test.tsx src/app/dashboard-panel.tsx src/app/task-manager.tsx src/app/i18n.ts src/app/i18n.de.ts docs/baselines/file-sizes.json
git commit -m "feat(digest): dashboard digest card + task-manager wiring"
```

---

## Task 8: Settings control (enable + cadence)

**Files:**
- Modify: `src/app/settings-sections/integrations-section.tsx` (add a digest enable toggle + cadence `<select>` beside the notifications opt-in)
- Test: extend `src/app/settings-sections/integrations-section.test.tsx` if present, else add a focused render test.

- [ ] **Step 1: Write the failing test**

```tsx
// add to integrations-section test (or a new src/app/settings-sections/digest-settings.test.tsx)
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntegrationsSection } from "./integrations-section";
// build minimal props per the section's existing test fixtures...

describe("digest settings", () => {
  it("renders a labeled digest enable toggle", () => {
    // render IntegrationsSection with settings.digest = { enabled:false, cadenceDays:7 }
    // expect a control with an accessible name matching /digest/i
    expect(true).toBe(true); // replace with a real assertion against the rendered control
  });
});
```

> Replace the placeholder assertion with a real one once you've read `integrations-section.tsx` and its existing test's fixture builder. The control MUST have an `aria-label`/`<label>` (Integrations IS axe-scanned) and change `settings.digest` via the section's existing `onChangeSettings` spread.

- [ ] **Step 2: Run test to verify it fails / drives the work**

Run: `npm run test:run -- src/app/settings-sections/integrations-section.test.tsx`
Expected: FAIL until the control is added.

- [ ] **Step 3: Add the control**

In `integrations-section.tsx`, near the notifications opt-in, add (using the section's existing settings + change handler):

```tsx
<label className="flex items-center gap-2">
  <input
    type="checkbox"
    checked={settings.digest?.enabled ?? false}
    aria-label={t(lang, "digestEnableLabel")}
    onChange={(e) =>
      onChangeSettings({ ...settings, digest: { enabled: e.target.checked, cadenceDays: settings.digest?.cadenceDays ?? 7 } })
    }
  />
  <span>{t(lang, "digestEnableLabel")}</span>
</label>
<label className="flex items-center gap-2">
  <span>{t(lang, "digestCadenceLabel")}</span>
  <select
    className={`${FOCUS_RING} ${TRANSITION} rounded-md border border-line px-2 py-1`}
    aria-label={t(lang, "digestCadenceLabel")}
    value={settings.digest?.cadenceDays ?? 7}
    onChange={(e) =>
      onChangeSettings({ ...settings, digest: { enabled: settings.digest?.enabled ?? false, cadenceDays: Number(e.target.value) } })
    }
  >
    <option value={7}>{t(lang, "digestCadenceWeekly")}</option>
    <option value={14}>{t(lang, "digestCadenceBiweekly")}</option>
    <option value={30}>{t(lang, "digestCadenceMonthly")}</option>
  </select>
</label>
```

- [ ] **Step 4: Add i18n (EN + DE via node)**

EN: `digestEnableLabel: "Weekly status digest"`, `digestCadenceLabel: "Digest cadence"`, `digestCadenceWeekly: "Weekly"`, `digestCadenceBiweekly: "Every 2 weeks"`, `digestCadenceMonthly: "Monthly"`.
DE: `digestEnableLabel: "Wöchentliche Statuszusammenfassung"`, `digestCadenceLabel: "Häufigkeit der Zusammenfassung"`, `digestCadenceWeekly: "Wöchentlich"`, `digestCadenceBiweekly: "Alle 2 Wochen"`, `digestCadenceMonthly: "Monatlich"`.

- [ ] **Step 5: Run tests + axe + tsc**

Run: `npm run test:run -- src/app/settings-sections/`, `npx tsc --noEmit`, then `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Integrations"` (webServer auto-starts) — verify no axe regression from the new controls.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-sections/integrations-section.tsx src/app/settings-sections/*digest*.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(digest): settings control (enable + cadence)"
```

---

## Task 9: `clearAppConfig` sweep coverage + full verification

**Files:**
- Verify: `src/app/app-reset.ts` already wipes all `lop-app:*` keys → `lop-app:digest-state` is swept automatically (no code change, but confirm with a test).
- Test: `src/app/app-reset.test.ts` (add a case that `digest-state` is cleared).

- [ ] **Step 1: Add the sweep test**

```ts
// add to src/app/app-reset.test.ts
it("clears the digest-state store", () => {
  localStorage.setItem("lop-app:digest-state", JSON.stringify({ p1: {} }));
  clearAppConfig();
  expect(localStorage.getItem("lop-app:digest-state")).toBeNull();
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:run -- src/app/app-reset.test.ts`
Expected: PASS (the `lop-app:*` sweep already covers it; no source change).

- [ ] **Step 3: Full gate run**

```bash
npx tsc --noEmit
npm run lint
npm run test:run
npm run size:check
npm run dup:check
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"
```
Expected: all green. Fix any dup:check hit by reusing existing helpers (no copy of dashboard/graph/notification logic). If a11y Dashboard flags the new card, add missing labels.

- [ ] **Step 4: Commit**

```bash
git add src/app/app-reset.test.ts
git commit -m "test(digest): confirm digest-state is swept by clearAppConfig"
```

---

## Task 10: Release prep (0.172.0) — ONLY on user "release"

Do NOT run this task until the user explicitly says "release". Then:

- [ ] Bump `src/app/version.ts`: `APP_VERSION = "0.172.0"`, new `APP_MILESTONE` codename (next sci-fi/fantasy author, e.g. "Le Guin" is taken — pick an unused one), `APP_BUILD_DATE` comment describing the digest, append `"versionHighlightStatusDigest"` to `APP_HIGHLIGHT_KEYS`.
- [ ] `package.json` version → `0.172.0`.
- [ ] `CHANGELOG.md`: new `[0.172.0]` entry above the latest.
- [ ] i18n `versionHighlightStatusDigest` EN + DE (DE via node script).
- [ ] `npx tsc --noEmit` (highlight-key parity) + `npm run test:run -- i18n-encoding`.
- [ ] Commit `chore(release): 0.172.0 "<codename>" — weekly status digest`.

---

## Self-review notes (author)

- **Spec coverage:** delivery (card Task 7 · email Task 3+6 · notification Task 6) ✓; composition deterministic Task 1 + optional AI Task 5 ✓; cadence standalone Task 2 + manual Task 6 ✓; per-project scope (projectId keyed) ✓; gating (M365 email, AI narrative, notif opt-in, popout) Task 6/7 ✓; settings config Task 4 + control Task 8 ✓; per-device stores + clearAppConfig sweep Task 9 ✓; error handling (fail-soft AI, email toast, malformed-load default) Tasks 5/6/2 ✓; i18n EN+DE Tasks 3/7/8 ✓; release Task 10 ✓. SP2 portfolio explicitly deferred (not planned) ✓.
- **Type consistency:** `DigestModel`/`DigestInput`/`DigestPrior`/`DigestConfig`/`DigestState`/`UseDigestDeps` used identically across tasks; `buildDigest(input, today, generatedAt)` signature stable; `Health` = `"R"|"A"|"G"` throughout.
- **Known conform-points (flagged in-task, not placeholders):** `callClaude` call/return shape (Task 5 — copy from `scheduled-job-analysis.ts`); `healthDot`/`DensityClasses` exact export names (Task 7 Step 5); the i18n `lastIndexOf` anchor for DE (Task 3 Step 5). Each has a verify-first grep.
