# Insights → Action Loop SP1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, deduped `Workspace.insights` record with a lifecycle (surfaced → acknowledged / acted / dismissed → resolved), populated by 5 deterministic detectors, surfaced on the Dashboard + a dedicated view, exportable, and fed into the AI chat context.

**Architecture:** Pure i18n-free engines (`insights/detect.ts`, `insights/reconcile.ts`, `insights/sanitize-insights.ts`) produce/merge structured `Insight` records; a Workspace JSON blob persists them across all 6 backends (mirroring `knowledgeItems`); React surfaces render text via i18n and drive the lifecycle.

**Tech Stack:** Forked Next.js 16 / React 19 / TS / Tailwind v4 / Vitest 4 / Playwright. Package manager: npm.

**Spec:** `docs/superpowers/specs/2026-07-20-insights-action-loop-sp1-design.md`

**Global rules for every task:**
- After ANY edit: `npx tsc --noEmit` (exit 0) — trust it over IDE squiggles.
- Lint is `--max-warnings=0`: no unused imports/vars; hoist `obj.member` out of `useMemo`/exhaustive-deps arrays into scalar locals.
- react-hooks purity: NO `Date.now()`/`new Date()`/`Math.random()` in render bodies or the pure engines — `today` is passed in.
- No `set-state-in-effect`: use render-time reconcile where a prop drives state.
- Commit after each task with a conventional-commit message (no attribution trailer).
- DE i18n (`i18n.de.ts`) MUST be patched via a node utf8 write (Edit corrupts umlauts; file is CRLF — match `\r\n`); real umlauts only (i18n-encoding test bans `fuer`/`ueber`); no `\uXXXX` escapes.

---

### Task 1: Insight types + sanitizer

**Files:**
- Create: `src/app/insights/insight.ts` (types + consts)
- Create: `src/app/insights/sanitize-insights.ts` (`sanitizeInsights`)
- Test: `src/app/insights/sanitize-insights.test.ts`

- [ ] **Step 1: Write the types module** `src/app/insights/insight.ts`

```ts
// Pure, i18n-free. The persisted insight record + its enums. Text is rendered
// from `type` + `data` by the React surfaces (never stored as prose), so this
// module is language-neutral.
import type { AppView } from "../nav-config";

export const INSIGHT_TYPES = [
  "milestoneSlip",
  "overdueTrend",
  "stalledWork",
  "budgetVariance",
  "raidAging",
] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];

export const INSIGHT_SEVERITIES = ["high", "medium", "low"] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

export const INSIGHT_STATUSES = [
  "active",
  "acknowledged",
  "acted",
  "dismissed",
  "resolved",
] as const;
export type InsightStatus = (typeof INSIGHT_STATUSES)[number];

export interface InsightEntityRef {
  readonly view: AppView;
  readonly id: number;
}

export interface Insight {
  readonly id: number;
  readonly key: string;
  readonly type: InsightType;
  readonly severity: InsightSeverity;
  readonly entityRef?: InsightEntityRef;
  readonly data: Readonly<Record<string, string | number>>;
  readonly status: InsightStatus;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly occurrences: number;
  readonly acknowledgedAt?: string;
  readonly actedAt?: string;
  readonly dismissedAt?: string;
  readonly resolvedAt?: string;
  readonly dismissReason?: string;
  /** RESERVED for SP3 outcome feedback; unused in SP1. */
  readonly metricAtAction?: Readonly<Record<string, number>>;
}

/** A fresh detection (no lifecycle/timestamps — reconcile owns those). */
export interface DetectedInsight {
  readonly key: string;
  readonly type: InsightType;
  readonly severity: InsightSeverity;
  readonly entityRef?: InsightEntityRef;
  readonly data: Readonly<Record<string, string | number>>;
}

export const MAX_INSIGHTS = 200;
export const INSIGHT_DISMISS_REASON_MAX = 500;
export const INSIGHT_DATA_VALUE_MAX = 200;
export const INSIGHT_SEVERITY_RANK: Record<InsightSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
```

- [ ] **Step 2: Write the failing sanitizer test** `src/app/insights/sanitize-insights.test.ts`

```ts
import { describe, test, expect } from "vitest";
import { sanitizeInsights } from "./sanitize-insights";

describe("sanitizeInsights", () => {
  test("returns [] for non-array input, never throws", () => {
    expect(sanitizeInsights(undefined)).toEqual([]);
    expect(sanitizeInsights(null)).toEqual([]);
    expect(sanitizeInsights("nope" as unknown)).toEqual([]);
    expect(sanitizeInsights(42 as unknown)).toEqual([]);
  });

  test("drops records with an invalid type/severity/status", () => {
    const out = sanitizeInsights([
      { id: 1, key: "k", type: "bogus", severity: "high", status: "active",
        data: {}, firstSeenAt: "2026-01-01", lastSeenAt: "2026-01-01", occurrences: 1 },
      { id: 2, key: "k2", type: "overdueTrend", severity: "nope", status: "active",
        data: {}, firstSeenAt: "2026-01-01", lastSeenAt: "2026-01-01", occurrences: 1 },
    ]);
    expect(out).toEqual([]);
  });

  test("keeps a valid record and coerces occurrences to a positive int", () => {
    const out = sanitizeInsights([
      { id: 5, key: "milestoneSlip:12", type: "milestoneSlip", severity: "high",
        status: "acted", data: { count: 3, name: "M12" },
        entityRef: { view: "milestones", id: 12 },
        firstSeenAt: "2026-01-01", lastSeenAt: "2026-02-01", occurrences: 3.9,
        actedAt: "2026-02-02" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 5, key: "milestoneSlip:12", type: "milestoneSlip", severity: "high",
      status: "acted", occurrences: 3, entityRef: { view: "milestones", id: 12 },
    });
  });

  test("caps the list at MAX_INSIGHTS and truncates dismissReason", () => {
    const many = Array.from({ length: 260 }, (_, i) => ({
      id: i + 1, key: `k${i}`, type: "overdueTrend", severity: "low",
      status: "active", data: {}, firstSeenAt: "2026-01-01",
      lastSeenAt: "2026-01-01", occurrences: 1,
    }));
    expect(sanitizeInsights(many)).toHaveLength(200);
    const [one] = sanitizeInsights([
      { id: 1, key: "k", type: "overdueTrend", severity: "low", status: "dismissed",
        data: {}, firstSeenAt: "2026-01-01", lastSeenAt: "2026-01-01",
        occurrences: 1, dismissReason: "x".repeat(9999) },
    ]);
    expect(one.dismissReason?.length).toBe(500);
  });

  test("drops non-primitive data values and caps string values", () => {
    const [one] = sanitizeInsights([
      { id: 1, key: "k", type: "overdueTrend", severity: "low", status: "active",
        data: { good: 3, big: "y".repeat(9999), bad: { nested: 1 } },
        firstSeenAt: "2026-01-01", lastSeenAt: "2026-01-01", occurrences: 1 },
    ]);
    expect(one.data.good).toBe(3);
    expect((one.data.big as string).length).toBe(200);
    expect(one.data).not.toHaveProperty("bad");
  });
});
```

- [ ] **Step 3: Run test — verify it fails** — Run: `npx vitest run src/app/insights/sanitize-insights.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 4: Write `src/app/insights/sanitize-insights.ts`**

```ts
// Pure, i18n-free. The SINGLE validator for the persisted insight list. Never
// throws — bad records are dropped, bad fields coerced/dropped. Mirrors the
// defensive posture of sanitizeKnowledgeItems.
import {
  INSIGHT_TYPES, INSIGHT_SEVERITIES, INSIGHT_STATUSES,
  MAX_INSIGHTS, INSIGHT_DISMISS_REASON_MAX, INSIGHT_DATA_VALUE_MAX,
  type Insight, type InsightType, type InsightSeverity, type InsightStatus,
  type InsightEntityRef,
} from "./insight";

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}
function posInt(v: unknown): number {
  const n = typeof v === "number" ? Math.floor(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function isoOr(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : fallback;
}
function sanitizeData(v: unknown): Record<string, string | number> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string | number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
    else if (typeof val === "string") out[k] = val.slice(0, INSIGHT_DATA_VALUE_MAX);
  }
  return out;
}
function sanitizeRef(v: unknown): InsightEntityRef | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === "number" && Number.isFinite(o.id) ? o.id : undefined;
  const view = typeof o.view === "string" ? o.view : undefined;
  if (id === undefined || view === undefined) return undefined;
  return { view: view as InsightEntityRef["view"], id };
}

export function sanitizeInsights(input: unknown): Insight[] {
  if (!Array.isArray(input)) return [];
  const out: Insight[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const type = o.type as InsightType;
    const severity = o.severity as InsightSeverity;
    const status = o.status as InsightStatus;
    if (!INSIGHT_TYPES.includes(type)) continue;
    if (!INSIGHT_SEVERITIES.includes(severity)) continue;
    if (!INSIGHT_STATUSES.includes(status)) continue;
    const key = str(o.key, 200);
    const id = typeof o.id === "number" && Number.isFinite(o.id) ? o.id : undefined;
    if (!key || id === undefined) continue;
    const firstSeenAt = isoOr(o.firstSeenAt, "");
    if (!firstSeenAt) continue;
    const insight: Insight = {
      id, key, type, severity, status,
      data: sanitizeData(o.data),
      firstSeenAt,
      lastSeenAt: isoOr(o.lastSeenAt, firstSeenAt),
      occurrences: posInt(o.occurrences),
      ...(sanitizeRef(o.entityRef) ? { entityRef: sanitizeRef(o.entityRef) } : {}),
      ...(str(o.acknowledgedAt, 40) ? { acknowledgedAt: str(o.acknowledgedAt, 40) } : {}),
      ...(str(o.actedAt, 40) ? { actedAt: str(o.actedAt, 40) } : {}),
      ...(str(o.dismissedAt, 40) ? { dismissedAt: str(o.dismissedAt, 40) } : {}),
      ...(str(o.resolvedAt, 40) ? { resolvedAt: str(o.resolvedAt, 40) } : {}),
      ...(str(o.dismissReason, INSIGHT_DISMISS_REASON_MAX)
        ? { dismissReason: str(o.dismissReason, INSIGHT_DISMISS_REASON_MAX) } : {}),
    };
    out.push(insight);
  }
  return out.slice(0, MAX_INSIGHTS);
}
```

- [ ] **Step 5: Run test — verify it passes** — Run: `npx vitest run src/app/insights/sanitize-insights.test.ts` then `npx tsc --noEmit` — Expected: PASS, tsc exit 0.

- [ ] **Step 6: Commit** — `git add src/app/insights && git commit -m "feat(insights): Insight types + sanitizeInsights (SP1 task 1)"`

---

### Task 2: Detection engine

**Files:**
- Create: `src/app/insights/detect.ts`
- Test: `src/app/insights/detect.test.ts`

**Context:** `detectInsights` is pure — `today` passed in, no clock. `InsightInput` mirrors the shape task-manager already assembles for `buildActionInput`/`buildDashboardInput`. Reuse existing engines; do NOT re-derive domain logic. Look at `src/app/next-actions/providers/task-attention.ts` for the stale/blocked predicates, `src/app/milestones.ts` for milestone helpers, `src/app/raid-review.ts` for `isRaidActiveForReview`, `src/app/budget-report.ts` for variance. Thresholds are named constants.

- [ ] **Step 1: Write the failing test** `src/app/insights/detect.test.ts` with one `describe` per detector. Cover: milestoneSlip fires on ≥`MILESTONE_SLIP_MIN_REBASELINES` or overdue; overdueTrend fires when current overdue > prior; stalledWork fires when stale+blocked count ≥ `STALLED_WORK_MIN`; budgetVariance fires when |variance| ≥ `BUDGET_VARIANCE_PCT`; raidAging fires when an active RAID is past target + stale ≥ `RAID_AGING_DAYS`; each NON-firing case returns no insight of that type; empty input → `[]`. Use minimal fixtures. (Write concrete assertions per the signatures below — no placeholder `it.todo`.)

Signatures the test drives:
```ts
export interface InsightInput {
  readonly tasks: readonly Task[];
  readonly milestones: readonly Milestone[];
  readonly raid: readonly RaidItem[];
  readonly budgets: readonly Budget[];       // [] when no real plan
  readonly plan: Plan | null;
  readonly priorOverdueCount: number | null; // from snapshot/last-visit; null = unknown
  readonly holidaySet: ReadonlySet<string>;
}
export function detectInsights(input: InsightInput, today: string): DetectedInsight[];
```

- [ ] **Step 2: Run test — verify it fails** — Run: `npx vitest run src/app/insights/detect.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/app/insights/detect.ts`** — one small pure fn per detector returning `DetectedInsight | null` (or `DetectedInsight[]` for per-entity ones), composed by `detectInsights`. Named-constant thresholds at top:

```ts
export const MILESTONE_SLIP_MIN_REBASELINES = 2;
export const STALLED_WORK_MIN = 3;
export const BUDGET_VARIANCE_PCT = 10;
export const RAID_AGING_DAYS = 7;
export const STALE_DAYS = 14; // reuse the task-attention constant if exported
```

Each detector reuses the existing engine's derivation. `overdueTrend` returns `null` when `priorOverdueCount === null` (unknown history) or `current <= prior`. `budgetVariance` returns `[]` when `plan === null`. `entityRef` set for per-entity insights (milestoneSlip→`{view:"milestones",id}`, raidAging→`{view:"raid",id}`), omitted for the singletons. `data` carries only primitives (counts, ISO dates, deltas, entity name for render). Ordering: severity desc then key.

- [ ] **Step 4: Run test — verify it passes** — Run: `npx vitest run src/app/insights/detect.test.ts` + `npx tsc --noEmit` — Expected: PASS, tsc 0.

- [ ] **Step 5: Commit** — `git commit -am "feat(insights): deterministic detect engine (SP1 task 2)"`

---

### Task 3: Reconcile engine

**Files:**
- Create: `src/app/insights/reconcile.ts`
- Test: `src/app/insights/reconcile.test.ts`

- [ ] **Step 1: Write the failing test** covering: new detection → new `active` record (`firstSeenAt=lastSeenAt=today`, `occurrences=1`, id=max+1); re-detection of an existing key → bumps `lastSeenAt`+`occurrences`, refreshes severity/data, keeps status+timestamps; a stored `active` key NOT in detections → `resolved` (`resolvedAt=today`) **only if** it had a user lifecycle event, else PRUNED; a stored `dismissed` key not detected → stays `dismissed` (not pruned, not resolved); a `dismissed`/`resolved` key that re-fires → back to `active` with bumped occurrences; output ordered severity desc then `lastSeenAt` desc; never exceeds `MAX_INSIGHTS`.

```ts
export function reconcileInsights(
  stored: readonly Insight[],
  detected: readonly DetectedInsight[],
  today: string,
): Insight[];
```

- [ ] **Step 2: Run — verify fails.** `npx vitest run src/app/insights/reconcile.test.ts`

- [ ] **Step 3: Implement `reconcile.ts`.** Build a `Map<key, Insight>` from `stored`; `nextId = max(id)+1`. For each detection: upsert. After the loop, walk stored keys not in the detection set → resolve-or-prune (a record has a "lifecycle event" if any of `acknowledgedAt/actedAt/dismissedAt` set). Helper `hadUserAction(i)`. Sort; cap `MAX_INSIGHTS`. Pure — `today` in.

- [ ] **Step 4: Run — verify passes** + `npx tsc --noEmit`.

- [ ] **Step 5: Commit** — `git commit -am "feat(insights): reconcile engine (SP1 task 3)"`

---

### Task 4: Persistence (6 write paths + export)

**Files (mirror `knowledgeItems` at every site — grep `knowledgeItems` to find them all):**
- Modify: `src/app/workspace.ts` (field on `Workspace` + JSON in/out)
- Modify: `src/app/csv-codecs-config.ts` (encode `# INSIGHTS`) + `src/app/csv-codecs-decode.ts` (decode)
- Modify: `src/app/markdown-codecs-core.ts` (encode `## Insights` fenced JSON) + `src/app/markdown-codecs-decode.ts` (decode)
- Modify: `src/app/turso-schema.ts` + `src/app/turso-tenant-schema.ts` (meta row `insights`)
- Modify: `src/app/browser-backend.ts` (IDB KV `insights`)
- Modify: `src/app/export-sections.ts` (new `insights` `ExportSectionKey`, default off + `buildExportSections` builder) + wherever `EXPORT_SECTION_KEYS` lives
- Modify: `src/app/version-diff.ts` (singleton entry)
- Test: `src/app/insights-persistence.test.ts`

- [ ] **Step 1: Write the failing round-trip test** `insights-persistence.test.ts` — build a `Workspace` with 2 insights, assert it survives: JSON `workspaceToJson`→`jsonToWorkspace`; CSV `workspaceToCsv`→`csvToWorkspace`; MD `workspaceToMarkdown`→`markdownToWorkspace`; and that an EMPTY `insights` produces byte-identical CSV/MD to a workspace without the field (byte-stability). Use `sanitizeInsights`-valid records.

- [ ] **Step 2: Run — verify fails.**

- [ ] **Step 3: Add the field to `Workspace`** in `workspace.ts` (`readonly insights?: readonly Insight[]`) + JSON in/out (pass-through + `sanitizeInsights` on read).

- [ ] **Step 4: CSV** — add `# INSIGHTS` `config,<json>` section in `csv-codecs-config.ts` encoder (gated `insights?.length`) + decode in `csv-codecs-decode.ts` (JSON.parse → `sanitizeInsights`). Empty ⇒ section omitted (byte-stable).

- [ ] **Step 5: Markdown** — add `## Insights` fenced JSON block in `markdown-codecs-core.ts` + decode in `markdown-codecs-decode.ts`.

- [ ] **Step 6: Turso** — single + tenant meta row keyed `insights` (mirror `knowledge_items` meta handling; NOT a `TABLE_NAMES` entry).

- [ ] **Step 7: IDB** — KV slot `insights` in `browser-backend.ts`.

- [ ] **Step 8: Export** — new `insights` `ExportSectionKey` (default OFF) + a `buildExportSections` PDF builder rendering type+data via i18n (English in export builder, consistent with existing builders).

- [ ] **Step 9: version-diff** — singleton entry.

- [ ] **Step 10: Run the round-trip test + `npx tsc --noEmit` + `npm run test:run -- golden-workspace`** — golden must stay green (empty insights = byte-stable). If golden fails, the encoder is emitting a section for an empty list — fix the gate.

- [ ] **Step 11: Commit** — `git commit -am "feat(insights): persist Workspace.insights across 6 paths + export (SP1 task 4)"`

---

### Task 5: App state wiring + detection runner + lifecycle handlers

**Files:**
- Modify: `src/app/workspace-context.tsx` (`insights`/`setInsights` state + value + deps)
- Modify: `src/app/use-storage-backend.ts` (`applyWorkspace` set; the THREE `backend.save({…})` literals + `currentWorkspace()`; **the autosave-effect DEPS array**)
- Modify: `src/app/task-manager.tsx` (restore effect; `buildInsightInput`; the reconcile runner; lifecycle handlers `onAcknowledgeInsight`/`onActInsight`/`onDismissInsight`)

- [ ] **Step 1 (guard first): Write the autosave-persistence characterization test** — extend `insights-persistence.test.ts` (or a new `insights-autosave.test.ts`) asserting that a workspace loaded with insights, then re-saved, retains them — the regression that the #6A/knowledge HIGH was about (field in save literal but missing from the autosave DEPS array). If a lighter guard exists (`entity-persistence-registry.test.ts` style), add a row there.

- [ ] **Step 2: Wire `workspace-context.tsx`** — add `insights: readonly Insight[]` + `setInsights` (mirror `knowledgeItems` exactly: state, restore setter, context value, memo deps).

- [ ] **Step 3: Wire `use-storage-backend.ts`** — add `insights` to `applyWorkspace`, all three `backend.save({…})` literals, `currentWorkspace()`, AND the autosave-effect deps array. (Grep `knowledgeItems` in this file — match every occurrence.)

- [ ] **Step 4: `buildInsightInput` in task-manager** — assemble `InsightInput` from live entities + history. `priorOverdueCount` from the landing-state metric snapshot (reuse `use-landing-delta`'s prior, or `loadPrior`); `today` = the effective `todayISO()`. Gate feature-off entities (`[]` budgets when no plan). Hoist `?.length`/member exprs to scalars for deps.

- [ ] **Step 5: Reconcile runner** — a debounced effect (like the next-actions recompute) that runs `detectInsights` → `reconcileInsights(prev, detected, today)` via functional `setInsights`. Popout = no-op (read-only). Guard: only when hydrated + not popout. NO set-state-in-effect violation — this is a side-effect writing workspace state via the setter (allowed, like the calendar auto-sync), not a render-phase setState; debounce + a content-key guard so it doesn't loop (exclude lifecycle-only fields from the key).

- [ ] **Step 6: Lifecycle handlers** — `onAcknowledgeInsight(id)`, `onActInsight(id)` (also fire the mapped `action-cta` / `requestOpen`), `onDismissInsight(id, reason?)` — each a functional `setInsights(prev => prev.map(...))` stamping the timestamp + status. Thread down to the dashboard + view.

- [ ] **Step 7: Run `npx tsc --noEmit` + the guard test + `npm run test:run -- task-manager.characterization`.** Fix contract drift.

- [ ] **Step 8: Commit** — `git commit -am "feat(insights): workspace state + detection runner + lifecycle handlers (SP1 task 5)"`

---

### Task 6: Dashboard Insights card

**Files:**
- Create: `src/app/dashboard-sections/insights-card.tsx`
- Test: `src/app/dashboard-sections/insights-card.test.tsx`
- Modify: `src/app/dashboard-panel.tsx` (render the card in the masonry flow; thread props)
- Modify: `src/app/i18n.ts` + `src/app/i18n.de.ts` (title/detail templates per type + action labels)

- [ ] **Step 1: Write the failing card test** — renders top-N active insights sorted by severity; each row shows i18n title + severity dot + ack/act/dismiss buttons with row-UNIQUE accessible names + a deep-link; returns null when no active insights; resolved/dismissed excluded from the card.

- [ ] **Step 2: Run — verify fails.**

- [ ] **Step 3: Implement `insights-card.tsx`** — presentational (`insights`, `lang`, `dc`, `onAcknowledge`/`onAct`/`onDismiss`/`onOpen`, `isPopout`). Text via a pure `insightTitle(insight, lang)` / `insightDetail(insight, lang)` renderer (new `src/app/insights/insight-text.ts`, reads `type`+`data`). Severity via `--rag-*` DOT (non-text, AA-exempt) — never tinted small text. `dc.*` density classes. Buttons carry row-unique `aria-label`. Deep-link the `entityRef`.

- [ ] **Step 4: Wire into `dashboard-panel.tsx`** — a `break-inside-avoid` masonry card gated on active-insight count (no dead margin when empty). Thread the lifecycle handlers from task-manager → DashboardPanel props (optional, back-compat with existing test sites).

- [ ] **Step 5: i18n** — EN + DE title/detail templates per `InsightType` (positional `{0}` placeholders) + `insightAcknowledge`/`insightAct`/`insightDismiss`/`insightsCardTitle`. DE via node write.

- [ ] **Step 6: Run card test + `npx tsc --noEmit` (i18n parity)** — PASS.

- [ ] **Step 7: Commit** — `git commit -am "feat(insights): dashboard insights card (SP1 task 6)"`

---

### Task 7: Dedicated `insights` AppView

**Files:**
- Create: `src/app/insights-panel.tsx` (+ lazy export in `src/app/workspace-panels.tsx`)
- Test: `src/app/insights-panel.test.tsx`
- Modify: `src/app/nav-config.ts` (`AppView` union + `LABEL_KEYS` + `navLabelKey` + Overview sub-child of dashboard) · `src/app/feature-modules.ts` (`CORE_VIEWS`) · `src/app/nav-icons.tsx` (`ICON_PATHS` exhaustive `Record<AppView>`) · `src/app/workspace-section.tsx` (route the tabpanel) · `src/app/workspace-section-types.ts` (thread insights + handlers) · `e2e/a11y.spec.ts` (`A11Y_VIEWS` + hash-nav) · `src/app/i18n.ts`/`i18n.de.ts` (`navInsights`)

- [ ] **Step 1: Add `"insights"` to the `AppView` union** and satisfy the tsc-forced exhaustive maps (CORE_VIEWS, LABEL_KEYS, navLabelKey, ICON_PATHS, navInsights i18n). Run `npx tsc --noEmit` — it will list every missing map entry; fill them.

- [ ] **Step 2: Write the failing panel test** — renders the full log with status + type filters, lifecycle controls (row-unique labels), a resolved/history toggle; filtering by status hides non-matching; popout hides lifecycle writes.

- [ ] **Step 3: Implement `insights-panel.tsx`** — standard resizable content-pane shell (`VIEW_PANE_RESIZABLE_CLASS` + `useResizable("aipm-cockpit:insights-size")` + `ResetSizeButton` + `PrintButton`, `print-root`). Consumes `useWorkspace().insights` + handlers threaded via `workspace-section-types`. Row-unique accessible names (`${t(lang,"insightAct")} – ${title}`). Reuse `insight-text.ts` renderer + `EmptyState`/add-first patterns as appropriate (read-only → `EmptyState`, no add).

- [ ] **Step 4: Lazy-register** in `workspace-panels.tsx` (`dynamic(ssr:false)` + `PanelSkeleton` fallback) and route in `workspace-section.tsx`. Thread `insights` + handlers through `workspace-section-types.ts`.

- [ ] **Step 5: Nav** — add as an Overview sub-child of `dashboard` (mirror `actions`). It's file-mode-reachable (not Turso-gated) → NOT in `TURSO_ONLY_VIEWS`.

- [ ] **Step 6: axe** — add `insights` to `A11Y_VIEWS` + its hash-nav in `e2e/a11y.spec.ts`. Run `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Insights"` — 5 combos PASS.

- [ ] **Step 7: Run panel test + `npx tsc --noEmit` + `npm run test:run -- workspace-section.characterization`.**

- [ ] **Step 8: Commit** — `git commit -am "feat(insights): dedicated insights view + nav + axe (SP1 task 7)"`

---

### Task 8: AI-aware chat context

**Files:**
- Create: `src/app/insights/insight-prompt.ts` (`buildInsightsPromptBlock`)
- Test: `src/app/insights/insight-prompt.test.ts`
- Modify: `src/app/chat-api.ts` (`buildSystemPrompt` — append the volatile block AFTER the cached prefix breakpoint)

- [ ] **Step 1: Write the failing test** — `buildInsightsPromptBlock([], "en-US")` returns `""` (omitted when empty); with active insights returns a compact English summary listing type + key facts; excludes dismissed/resolved; caps to top-N by severity.

- [ ] **Step 2: Run — verify fails.**

- [ ] **Step 3: Implement `insight-prompt.ts`** — pure, English, `today`/counts allowed (it's the volatile block). Compact lines: `- [high] Milestone "M12" slipped 3×; overdue by 5d`.

- [ ] **Step 4: Wire into `buildSystemPrompt`** — append as a SystemBlock AFTER the `cache_control:{type:"ephemeral"}` breakpoint (volatile — never inside the cached instructions, or prompt caching never hits; see the AGENTS "prompt caching is PREFIX-based" note). Gated on active insights present.

- [ ] **Step 5: Run test + `npx tsc --noEmit` + `npm run test:run -- chat-api`** — PASS (verify no cache-prefix regression in existing chat-api tests).

- [ ] **Step 6: Commit** — `git commit -am "feat(insights): feed active insights into AI chat context (SP1 task 8)"`

---

### Task 9: Release scaffolding

**Files:** `src/app/version.ts` (APP_VERSION bump + `versionHighlightInsights` in `APP_HIGHLIGHT_KEYS`) · `package.json` · `src/app/i18n.ts`/`i18n.de.ts` (`versionHighlightInsights` EN/DE) · `CHANGELOG.md` · `AGENTS.md` (architecture bullet) · `docs/baselines/file-sizes.json` (if ratchet trips)

- [ ] **Step 1: Bump `version.ts`** — next patch after the current `APP_VERSION`; append `versionHighlightInsights` to `APP_HIGHLIGHT_KEYS`; update `APP_BUILD_DATE` comment.
- [ ] **Step 2: `package.json` version** to match.
- [ ] **Step 3: i18n `versionHighlightInsights` EN (i18n.ts) + DE (node write, umlauts).**
- [ ] **Step 4: `CHANGELOG.md`** entry (Added: insights → action loop SP1).
- [ ] **Step 5: `AGENTS.md`** architecture bullet (the `insights/` engines + Workspace blob + 6-path persistence + AI-aware + the two UI surfaces + landmines).
- [ ] **Step 6: Gates** — `npx tsc --noEmit` · `npm run lint` · `npm run size:check` (update baseline if a baselined file legitimately grew) · `npm run dup:check` · `npm run test:run` (full) · Insights + Dashboard axe.
- [ ] **Step 7: Commit** — `git commit -am "chore(release): <version> — insights → action loop SP1"`

---

## Self-review notes (author)

- **Spec coverage:** model (T1) · detect (T2) · reconcile (T3) · 6-path+export persistence (T4) · state+runner+lifecycle (T5) · dashboard card (T6) · dedicated view+nav+axe (T7) · AI-aware (T8) · release (T9). All spec sections mapped.
- **Type consistency:** `Insight`/`DetectedInsight`/`InsightInput`/`reconcileInsights`/`detectInsights` signatures identical across tasks. `entityRef {view,id}` uses `AppView` from `nav-config` (T7 adds `"insights"` to that union — the map is set before the view consumes it).
- **Landmine coverage:** autosave-DEPS HIGH (T5 step1 guard) · byte-stable empty blob (T4 step10 golden) · exhaustive AppView maps (T7 step1) · prompt-cache prefix (T8 step4) · DE umlaut node-write (global rule) · severity on DOT not text (T6 step3) · axe row-unique names (T6/T7).
- **No placeholders:** engine tasks carry full code; the mechanical persistence/wiring tasks (T4/T5/T7) reference the exact `knowledgeItems` precedent at named sites + the blob shape — the reuse IS the instruction (DRY), each with a run+verify gate.
