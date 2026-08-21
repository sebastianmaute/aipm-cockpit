# Insights → Action Loop — SP1: Insight Record + Lifecycle (Foundation)

**Status:** approved design (2026-07-20)
**Feature #6B.** Slice 1 of 4. Build order SP1 → SP2 → SP3 → SP4; each its own spec → plan → ship.

## Goal

Give the app a persistent, deduped **insight record** with a lifecycle
(`surfaced → acknowledged / acted / dismissed → resolved`), populated by
deterministic detectors that reuse existing engines, surfaced on the Dashboard
and in a dedicated view, exportable, and fed into the AI chat context. This is
the foundation the later slices build on:

- **SP2** — proactive AI recommendations write executable, tracked proposals into this log.
- **SP3** — outcome feedback measures whether the metric moved after an action.
- **SP4** — a periodic insight digest synthesizes the log into a briefing.

Out of scope for SP1: AI-generated insights, outcome measurement, digest.

## Architecture overview

```
detectors (pure, i18n-free)  ──►  reconcile (pure)  ──►  Workspace.insights (blob, 6 paths)
   reuse existing engines            upsert by key            travels with project
        │                                                          │
        └── input assembled in task-manager                       ├─► Dashboard Insights card
            (mirrors buildActionInput / buildDashboardInput)      ├─► dedicated `insights` AppView
                                                                  └─► AI chat system prompt (volatile block)
```

Everything deterministic. No AI, no new backend write path beyond the blob.
Degrades cleanly with AI off and on file/IDB backends (history detectors read
the activity log / snapshots opportunistically, exactly like completion-trend).

## Data model

New persisted field `Workspace.insights?: readonly Insight[]` (JSON blob;
mirrors `knowledgeItems` — exportable, gated by a new `insights`
`ExportSectionKey`, default OFF; empty ⇒ byte-stable, no golden regen).

```ts
type InsightType =
  | "milestoneSlip" | "overdueTrend" | "stalledWork" | "budgetVariance" | "raidAging";
type InsightSeverity = "high" | "medium" | "low";
type InsightStatus =
  | "active" | "acknowledged" | "acted" | "dismissed" | "resolved";

interface Insight {
  id: number;                 // nextEntityId(max+1)
  key: string;                // STABLE dedup id, e.g. "milestoneSlip:12", "overdueTrend"
  type: InsightType;
  severity: InsightSeverity;
  entityRef?: { view: AppView; id: number }; // deep-link target (optional)
  data: Readonly<Record<string, string | number>>; // structured FACTS, not prose
  status: InsightStatus;
  firstSeenAt: string;        // ISO
  lastSeenAt: string;         // ISO — bumped on every re-detection
  occurrences: number;        // times detected
  acknowledgedAt?: string;
  actedAt?: string;
  dismissedAt?: string;
  resolvedAt?: string;
  dismissReason?: string;     // capped free text
  metricAtAction?: Readonly<Record<string, number>>; // RESERVED for SP3 (unused SP1)
}
```

**Text is rendered via i18n from `type` + `data`** (exactly like next-actions
render their reasons) — the blob stays language-neutral and i18n-free.
`data` carries only primitives the renderer interpolates (counts, dates, deltas,
entity names resolved live at render, not stored).

### `key` (dedup identity)

Stable per detector + entity so a recurring condition updates ONE record instead
of spawning duplicates each session:

| type | key |
|---|---|
| milestoneSlip | `milestoneSlip:<milestoneId>` |
| overdueTrend | `overdueTrend` (project-level singleton) |
| stalledWork | `stalledWork` (project-level cluster singleton) |
| budgetVariance | `budgetVariance:<bucketKey>` or `budgetVariance` |
| raidAging | `raidAging:<raidId>` |

## Detection (pure, i18n-free)

`insights/detect.ts` `detectInsights(input: InsightInput, today: string): DetectedInsight[]`
— `today` passed IN (no `Date.now()`/`new Date()` in the engine, react-hooks
purity + testability). `DetectedInsight` = `{ key, type, severity, entityRef?, data }`
(no lifecycle/timestamps — reconcile owns those).

Detectors (each a small pure fn, reusing an existing engine — NO new domain logic):

1. **milestoneSlip** — milestone rebaselined ≥N times OR now overdue vs baseline.
   Reuses milestone + baseline data (`milestones.ts`, gantt baseline).
2. **overdueTrend** — overdue task count rising vs prior snapshot/last-visit.
   Reuses the dashboard KPI trend inputs + activity log / snapshot history.
3. **stalledWork** — cluster of stale(≥14d) / blocked / dep-blocked active tasks
   over a threshold. Reuses the `task-attention` next-actions provider output.
4. **budgetVariance** — a bucket's actual-vs-plan variance crosses a threshold.
   Reuses `budget-report` / EVM engine (only when a real plan exists).
5. **raidAging** — active RAID item past `targetDate` with no update in ≥N days.
   Reuses `raid-review` (`isRaidActiveForReview`).

Thresholds are named constants (magic-number rule). Each detector is
independently unit-tested with fixtures. `InsightInput` is assembled in
task-manager from live entities + history (mirrors `buildActionInput` /
`buildDashboardInput`), with `?? []` defaults; callers gate feature-off entities
(e.g. pass `[]` budgets when no plan).

## Reconcile (pure, i18n-free)

`insights/reconcile.ts` `reconcileInsights(stored, detected, today): Insight[]`:

- **Upsert by `key`**: a detection matching a stored record bumps `lastSeenAt`,
  increments `occurrences`, refreshes `severity`/`data`/`entityRef`; keeps status
  + all lifecycle timestamps. A new detection → new `active` record
  (`firstSeenAt=lastSeenAt=today`, `occurrences=1`, id = max+1).
- **Clear**: a stored record whose `key` is NOT in the current detection set flips
  to `resolved` (`resolvedAt=today`) — UNLESS already dismissed (dismissed stays
  dismissed). A record that reaches `resolved`/`dismissed` AND never had a
  lifecycle event (never acked/acted/dismissed by the user) is PRUNED (avoids a
  graveyard of auto-resolved noise); one that HAD user interaction is KEPT (that's
  the history SP3/SP4 consume).
- **Re-fire**: a `dismissed`/`resolved` record whose condition fires again → back
  to `active` (new `lastSeenAt`, bumped occurrences), so a genuinely recurring
  problem re-surfaces.
- Pure: `today` in, no clock; stable ordering (severity desc, then lastSeenAt).

Runs on load + debounced on workspace change (like next-actions), writing back
via a functional `setInsights(prev => reconcileInsights(prev, detected, today))`.

## Lifecycle actions

`active → acknowledge | act | dismiss`; auto `resolved` on clear.

- **Acknowledge** — "seen, not acting yet"; drops severity weighting, stays in log.
- **Act** — reuses `action-cta` `pickPrimaryCta` when the insight maps to a CTA
  (milestoneSlip → rebaseline, stalledWork → open-points, raidAging → raid…);
  else deep-links `entityRef` via `requestOpen(view,id)`. Sets `actedAt`.
- **Dismiss** — optional capped reason; suppressed until condition clears + re-fires.

Handlers live in task-manager (functional `setInsights(prev => …)`), threaded to
the dashboard section + the view. Popout = read-only (no lifecycle writes).

## UI (Both)

### Dashboard Insights section
Masonry card (`dashboard-sections/insights-card.tsx`), placed by priority in the
flow; top-N active insights by severity, each: severity dot + i18n title/detail +
deep-link + inline ack/act/dismiss. Self-hides when no active insights (blank
project). Uses `dc.*` density classes. Presentational; data + handlers as props.

### Dedicated `insights` AppView
New `AppView "insights"` in the Overview nav group (sub-child of dashboard, like
`actions`/`trends`). `insights-panel.tsx` (lazy) = full log with status + type
filters, lifecycle controls, and a resolved/history toggle. Standard resizable
content-pane shell + PrintButton. Adding the AppView forces the exhaustive-map
edits: `CORE_VIEWS`, `LABEL_KEYS` + `navLabelKey`, `ICON_PATHS`, i18n `navInsights`.
Add to axe `A11Y_VIEWS` (it's reachable in file mode via the seed) — controls need
row-unique accessible names.

### AI-aware
`buildInsightsPromptBlock(insights, lang?)` → a compact active-insights summary
appended to the chat system prompt as a **volatile** block (AFTER the cached
prefix + its `cache_control` breakpoint, with today/counts — never inside the
cached instructions, or caching never hits). Read-only context; NO new AI tool.

## Persistence — the six-write-path checklist (exportable blob)

Mirror `knowledgeItems` exactly:
1. `types.ts` / `document-link.ts`-equivalent: `Insight*` types + `sanitizeInsights`
   (never throws, per-field coercers, enum guards, caps: `MAX_INSIGHTS`,
   `dismissReason` length, `data` value caps).
2. `workspace.ts` — JSON in/out.
3. CSV — `# INSIGHTS` section (`csv-codecs-config` encode + `-decode`).
4. Markdown — `## Insights` fenced JSON block (`markdown-codecs-core` + `-decode`).
5. Turso single meta row + tenant meta row keyed `insights`.
6. IDB KV slot `insights` (`browser-backend.ts`).
7. Export: new `insights` `ExportSectionKey` (default OFF) + `buildExportSections`
   PDF builder.
8. App wiring: `workspace-context` (`insights`/`setInsights`), set on load in
   `use-storage-backend.applyWorkspace` AND task-manager restore effect, INCLUDED
   in the three `backend.save({…})` literals + `currentWorkspace()` **AND the
   autosave-effect DEPS array** (the #6A/knowledge HIGH — a field-only edit is
   lost on reload if it's only in the save literal).
9. `version-diff` singleton entry.
10. Guard test `insights-persistence.test.ts` (round-trip all backends).

Empty `insights` ⇒ byte-stable; no golden regen needed until sample data seeds one.

## Testing

- `insights/detect.test.ts` — each detector, per-fixture, incl. threshold boundaries.
- `insights/reconcile.test.ts` — upsert / clear-to-resolved / prune-vs-keep /
  re-fire / dismissed-sticky / ordering.
- `sanitizeInsights` unit + property (enum coercion, caps, never-throws).
- `insights-persistence.test.ts` — 6-path round-trip + export gating.
- Dashboard card + panel: render, self-hide, lifecycle handler wiring, deep-link.
- AI block: volatile placement (after cache breakpoint), empty ⇒ omitted.

## Release

New `Workspace` field → CHANGELOG + `version.ts` bump + `versionHighlightInsights`
(EN/DE) + `APP_HIGHLIGHT_KEYS`. New AppView + nav. AGENTS.md architecture bullet.
Gates: tsc (i18n parity), lint, size, dup, i18n-encoding, unit floors, Insights +
Dashboard axe (5 combos), full suite. Review-before-release.
