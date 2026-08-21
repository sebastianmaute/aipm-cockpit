# Release 3 — Dashboard — design

**Date:** 2026-07-25
**Status:** Approved (design)
**Scope:** 3 slices from the multi-surface roadmap (reqs 12, 14, 17). No new persisted `Workspace` field; no golden-fixture regeneration.

---

## Grounded facts (verified against current code, 2026-07-25)

These correct the roadmap spec, which was written from AGENTS.md:

- **No new context channel is needed for 3.1.** Providers nest `FiltersProvider > WorkspaceProvider > WorkspaceTabProvider` (`task-manager.tsx:2887`). `TaskManagerInner` consumes BOTH `useFilters()` and `useWorkspaceTab()`, and already owns `openAction` (`task-manager.tsx:952`) — the single choke point every action surface routes through (Dashboard top-actions, the `actions` view rows, desktop notifications). The roadmap's proposed `workspace-tab-context` filter channel would be a second path to the same state.
- **The overdue signal is the `workload` provider's `overload` alert** (`next-actions/providers/workload.ts`), fired by `buildWorkloadAlerts` when a managed resource has `overdueCount >= 3` (`next-actions-workload.ts`). Its CTA today is `{kind:"open", view:"workload", id:resourceId}`.
- **The assignee filter matches the resource's live display name.** `uniqueAssignees` is built from `effectiveAssignee(task, resourcesById)` (`workspace-context.tsx:179`); the alert carries `resourceDisplayName(resource)` — the same name family, so the values agree.
- **Burndown renders on TWO surfaces**, not one: `dashboard-panel.tsx:427` (via `DashboardModel.burndown`, computed in `dashboard.ts:312`) and `budget-report-panel.tsx:147`. Both call the same pure `computeBurndownSeries`.
- **The burndown x-axis is the RESOURCE PLAN range today** (`generatePeriods(plan.startDate, plan.endDate, plan.granularity)`), unrelated to bucket dates.
- **`successorId` has exactly one consumer today:** `computeSpillover` (`budget-report.ts:465`), a SINGLE-HOP closed-bucket transfer. There is no chain walk in the codebase — 3.2 writes the first one.
- **`bucketActivePeriods` returns plan periods only** (`budget-report.ts:19`) — a bucket's periods are always a subset of the plan's, EXCEPT when the bucket has no `startDate`/`endDate`, in which case it claims all of them.
- **The narrative is a plain string on `ProjectStatus`** (`types.ts:390`), persisted through the config blob (`csv-codecs-config.ts:70`) and as a single markdown list item (`markdown-codecs-core.ts:191`). `sanitizeProjectStatus` (`workspace.ts:460`) passes it through with no cap and no HTML handling. **No AI prompt, export, or digest reads it** — `DashboardModel.narrative` (`dashboard.ts:350`) has no consumer beyond the panel, and the digest's `narrative` is a different, AI-generated field.
- `sanitizeNoteHtml` and `plainToHtml` already exist in `sanitize-html.ts`.

---

## 3.1 — Overdue action opens the person's tasks (req 12)

### What

Clicking **Open** on a "resource is overloaded with overdue work" action lands on Open Points, filtered to that person's at-risk rows — instead of the Resources → Workload view.

### Design

**New `ActionCta` arm** (`next-actions/types.ts`):

```ts
export type ActionCta =
  | { kind: "open"; view: AppView; id: string | number }
  | { kind: "open-tasks-for"; resourceId: number; resourceName: string }
  | { kind: "snooze"; actionId: string };
```

Data-only, serializable — the engine stays i18n-free and side-effect-free; the surface executes it. `resourceName` rides along because the filter is keyed by name, and the engine already has it (`al.resourceName`); re-deriving it in the surface would mean threading `resources` into a handler that has no other use for them.

**A separate `kind`, not an extra field on the `open` arm.** Reusing `{kind:"open", view:"open-points", id:-1, …}` would keep every existing predicate working for free, but it would also make `onPoints` true — and that gates the task-specific CTAs (mark-done, reschedule, clear-blocker, assign) in `use-action-center-handlers.ts`, all of which do `Number(action.cta.id)` and would then act on a sentinel id. A distinct kind keeps those CTAs off a row that has no task.

★★ **tsc will NOT flag the consumers.** Every one of them is an `a.cta.kind === "open"` guard, not an exhaustive switch, so the new arm compiles everywhere and silently degrades to "does nothing". `grep -rn "cta\.kind"` is the discovery mechanism, not the compiler. The complete site list, and what each must do:

| Site | Required change |
|---|---|
| `next-actions/providers/workload.ts` | Emit the new arm for `reason === "overload"` only. `over-allocated` keeps `{view:"workload"}` — utilization is a workload-view concern. |
| `next-actions/action-cta.ts` (`isOpen`, line 34) | **No change — and that is the point.** `pickPrimaryCta` falls through to `"open"` for any unmatched action, and `ActionPrimaryCta` always renders the Open button (it calls `handlers.onOpen(action)`), so the row keeps its Open verb for free. Leaving `isOpen`/`onPoints` false is exactly what keeps assign / reschedule / mark-done / clear-blocker off a row that has no task id. A regression test pins both halves. |
| `next-actions/group.ts` (line 27) | Must return `workload:${resourceId}` for the new kind. Today both workload alerts for one resource key to `workload:<id>` and MERGE into one group (extra reasons); a fall-through to `a.id` would split them into two rows — a silent regression. |
| `action-chips.tsx` (line 14) | Filters by `cta.view`; the new arm has none. Treat it as `open-points` so the chip surfaces on the Open Points strip. Deliberate move — it used to appear on the workload strip, which is no longer where the CTA goes. |
| `use-action-notifications.ts` (line 100) | A click would only `window.focus()`. Change the hook's `requestOpen` prop to `onOpenAction: (a: SuggestedAction) => void` and pass `openAction`, so the notification and the row run the same code instead of two copies of `Number(cta.id)`. |
| `escalate-popover.tsx`, `rebaseline-popover.tsx` | No change — already fall back to `-1`, and neither CTA is offered on a workload row. |
| `use-action-center-handlers.ts` | No change — every handler gates on `cta.view === "open-points"`, so the new arm correctly no-ops. |
| `task-manager.tsx:923` | No change — gated on `source === "stakeholder-comms"`. |

A unit test asserts the workload overload action still yields a primary Open CTA and still groups with that resource's over-allocated action.

`task-manager.tsx` `openAction` executes the arm (below).

**Execution** (`task-manager.tsx`, inside `openAction`):

```
resetFilters();                       // FiltersProvider: search, priority, assignee,
                                      // group, label, health, sort, raidFilterTaskId
setAssigneeFilter(cta.resourceName);
setHealthFilter("red");
setActiveTab("open-points");
```

`resetFilters` runs FIRST so a stale search/group/label filter can never intersect the new one to zero rows. It is `useCallback([])`-stable and already exported by `useFilters()`.

No hash write and no `requestOpen`: there is no entity id to deep-link, and `requestOpen` would push `#open-points/<id>`. This mirrors `requestChat`, which also navigates without an id.

### Notes / accepted limitations

- **`health="red"` is not exactly "overdue".** `computeTaskHealth` returns R for overdue OR non-empty `blockers` OR a manual `healthOverride:"R"`, and an overdue task with `healthOverride:"G"` is Green. So the filtered count can differ from the "N overdue" the row announced. Accepted: red is the existing user-facing "needs attention" filter, and adding an overdue-only filter value would widen `HealthFilter` for one caller.
- `settings.hideFinishedTasks` is a persisted per-device setting, NOT part of `resetFilters()`. Left untouched — finished tasks are never overdue, so it cannot hide the target rows, and silently flipping a persisted preference from a deep-link would be worse.
- If the resource's tasks are all hidden (e.g. an external resource under `hideExternalTasks`), `resolveEffectiveFilters` resolves the now-orphaned assignee value to `FILTER_ALL` and the table reads unfiltered rather than empty — the existing self-healing behaviour, no special case needed.
- Popouts: `openAction` already only runs on surfaces that render actions; no new popout guard (no mutation).

### Acceptance

- The overload action's Open lands on Open Points with the assignee filter set to that resource and health set to red; the Resources view is not visited.
- A pre-existing search/group/label filter does not survive the jump.
- The `over-allocated` action still opens the workload view, and still groups with the same resource's overload action into one row.
- Same behaviour from the Dashboard top-actions card, the `actions` view rows, and a desktop notification click.
- The row still renders a primary Open button (not a bare row with only the ⋮ overflow).

---

## 3.2 — Burndown follows the bucket successor chain (req 14)

### What

When the budget buckets form one connected `successorId` chain, the burndown x-axis spans the chain (first bucket's `startDate` → terminal bucket's `endDate`) instead of the whole resource-plan range. When they don't, the chart keeps today's plan span and a warning names the problem.

### Design

**New pure leaf `budget-bucket-chain.ts`** (i18n-free, no React, no `Date` reads):

```ts
export type BucketRef = { id: number; name: string };

export type BucketChain =
  | { kind: "chain"; start: string; end: string; order: readonly number[] }
  | { kind: "broken"; reason: BucketChainBreak; offenders: readonly BucketRef[] };

export type BucketChainBreak = "multiple-roots" | "cycle" | "unreachable" | "missing-dates";

export function resolveBucketChain(buckets: readonly BudgetBucket[]): BucketChain;
```

Rules, in order:

1. `buckets.length === 0` → `broken` / `"unreachable"` (caller already renders no chart).
2. Every bucket must carry a non-empty `startDate` AND `endDate`, else `"missing-dates"`. This guard is load-bearing: a dateless bucket claims ALL plan periods (`bucketActivePeriods` line 21), so trimming the axis would drop its hours from the chart while the report still counts them.
3. Roots = buckets that are no other bucket's `successorId`. Exactly one root required, else `"multiple-roots"` (`offenders` = the roots). Zero roots means every bucket is someone's successor, which is only possible in a cycle → `"cycle"`.
4. Walk `successorId` from the root, tracking visited ids. A revisit → `"cycle"`. A `successorId` pointing at a missing id, or a self-reference, is treated as the end of the walk (matching `computeSpillover`'s tolerance) — the unreached buckets then surface as `"unreachable"`.
5. Walk must reach every bucket, else `"unreachable"` with `offenders` = the unreached ones.

`offenders` carries `{id, name}` pairs so the warning component stays presentational and needs no bucket list of its own.
6. Success → `start` = min `startDate` over the chain, `end` = max `endDate`. Min/max rather than "first/last in walk order" because a bucket's dates need not be monotonic along the chain, and an axis that excluded real bucket periods would drop hours.

Status is deliberately ignored — a chain of open buckets is still a chain. `computeSpillover`'s closed-only rule is untouched.

**`computeBurndownSeries` gains an optional trailing `span?: { start: string; end: string }`.** It generates the plan periods exactly as today, then **slices** them to `p.start >= span.start && p.start <= span.end`. It never re-generates periods from the chain dates: re-generation could produce keys that don't align with `bucketActivePeriods`' plan-derived keys, and every bucket contribution is looked up through `indexByKey`. Slicing keeps the keys identical and only narrows the window.

With rule 2 enforced, every bucket's active periods lie inside `[chain.start, chain.end]`, so `totalBudgetHours` / `totalBudgetValue` are unchanged by the slice — the chart is trimmed, not re-scoped. `todayIndex` is recomputed over the sliced periods by the existing loop (it becomes `-1` when today precedes the chain, which the chart already handles).

**Call sites** pass the span only when `resolveBucketChain` returns `kind:"chain"`:

- `dashboard.ts:312` — `computeDashboard` resolves the chain once and passes the span; the resolved `BucketChain` is also exposed on `DashboardModel` (new field `bucketChain: BucketChain | null`, null when there are no buckets) so the panel can render the warning without re-resolving.
- `budget-report-panel.tsx:74` — resolves in the existing `useMemo` and passes the span.

**Warning UI** — new presentational `budget-chain-warning.tsx` (`BurndownChainWarning`), props `{ lang, chain }`, renders `null` unless `kind === "broken"`. Uses the shared `Banner` primitive (severity → live-region role is derived by the primitive). Copy is per-`reason`, naming the offending buckets by name (ids resolved by the caller passing `buckets`, so the component stays presentational):

- `multiple-roots` — "N budget buckets are not linked into one chain: A, B. The burn-down covers the whole plan period until each bucket sets its successor."
- `unreachable` — same shape, naming the orphans.
- `cycle` — "Budget buckets form a loop: A → B → A."
- `missing-dates` — "Some buckets have no start or end date: A, B."

Mounted above the chart in BOTH `dashboard-panel.tsx` (inside the existing burndown card) and `budget-report-panel.tsx` (inside the `budgetBurndownTitle` section).

### Notes

- Both surfaces are axe-scanned (Dashboard and Budget report) — the banner is text-only, palette-safe, with no colour-only meaning.
- Single-bucket workspaces are trivially a valid chain (one root, walk reaches it) — the axis narrows to that bucket's dates. This is the common case and the main visible win.
- i18n EN + DE for the four warning strings + a chart caption noting the span source is NOT added (the axis labels already show the dates).

### Acceptance

- One connected chain → the chart's first and last period match the chain's start/end; hour and value totals are identical to the un-sliced chart.
- Two unconnected buckets → the chart spans the plan range exactly as before AND the warning names both buckets, on both surfaces.
- A cycle or a dateless bucket → warning, no chart change, no crash.
- `computeBurndownSeries` called without `span` is byte-identical to today (existing tests unchanged).

---

## 3.3 — Lean rich-text status narrative (req 17)

### What

The Dashboard status narrative becomes rich text (bold/italic/lists/link) using the existing lean editor.

### Design

- `NarrativeEditor` (`dashboard-sections/dashboard-narrative.tsx`) swaps `<Textarea autoGrow>` for `<RichTextEditor variant="lean" lang={lang} label={…} value={draft} onChange={setDraft} />`. **No `commitOnEnter`** — Enter must split paragraphs in a multi-paragraph status. The Save / Clear buttons and the blur commit stay exactly as they are, so the existing tests keep their meaning.
- The render-time reconcile (`prevStoredNarrative`) is unchanged.
- `NarrativeSummary` renders `dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(html) }}` inside the existing `Card`, replacing `whitespace-pre-wrap` plain text. Empty (after strip) still returns `null`.
- **Legacy upgrade on read**, in one shared helper in the same file: if the stored value does not start with a block tag (`/^\s*<(p|ul|ol|h\d|blockquote)\b/i`), run `plainToHtml` on it. Applies at BOTH the summary render and the editor seed. Nothing is rewritten on disk until the user saves — an untouched project's bytes are unchanged.
- **Commit normalises newlines out**: `html.replace(/[\r\n]+/g, " ")` before `setStatus`. Load-bearing — the markdown codec writes `- narrative: <value>` on one line and decodes with `^- (\w+):\s*(.*)$` (`markdown-codecs-core.ts:203`), so an embedded newline would silently truncate the narrative on a markdown round-trip.
- **Sanitize at the SINK only.** Do NOT add `sanitizeNoteHtml` to `sanitizeProjectStatus` — that runs in the codec layer, which executes under bare node in the sample/fixture scripts where DOMPurify has no DOM (the known `jsonToWorkspace`-returns-empty landmine). Sink-only mirrors `NoteBody`'s defence.
- `RichTextEditor` is imported statically here (like `notes-window.tsx` and `task-form-fields.tsx`), not via `dynamic()`: the dashboard is the landing view and the editor sits inside a closed `<details>`, so a lazy chunk would only add a load hop on first expand. If bundle size regresses measurably, switch to the `dynamic(ssr:false)` form used by `meeting-report-panel.tsx`.
- The editor keeps an accessible name via the `label` prop (the lean variant's `aria-label`) — not a placeholder.

### Notes

- No schema change, no new persisted field, no six-write-path chore, no golden regeneration (the sample workspace's narrative, if any, stays plain text and upgrades on render only).
- `sanitizeProjectStatus` has no length cap today; this slice does not add one (out of scope, unchanged risk profile).
- Dashboard is axe-scanned — run the axe gate on a fresh isolated server after the change.

### Acceptance

- Formatting applied in the editor persists across a reload and renders formatted in the read-only summary.
- A pre-existing plain-text narrative renders unchanged (escaped, paragraph-wrapped) and is editable without corruption.
- A `<script>` pasted into the editor never executes — it is stripped at render.
- Saving a multi-paragraph narrative and round-tripping through the markdown backend preserves every paragraph.
- Clearing still empties the field and hides the summary card.

---

## Cross-cutting

- i18n EN + DE parity for all new strings (the 3.2 warnings). DE umlauts via node utf8 write, never the Edit tool.
- Palette: `Banner` primitive only; no off-palette fill, shadow or gradient.
- Open Points, Dashboard and Budget report are all axe-scanned — run `e2e/a11y.spec.ts` for those views on a fresh `PORT=3100` server before pushing.
- Tests: pure engines (`budget-bucket-chain.ts`, the sliced `computeBurndownSeries`) get unit tests; `openAction`'s new arm gets a task-manager-level test asserting reset-then-set ordering; the narrative helper gets a legacy-upgrade + newline-normalisation test.
- Release: bump `src/app/version.ts` (APP_VERSION + milestone), `CHANGELOG.md` entry, `APP_HIGHLIGHT_KEYS` + EN/DE highlight strings. Codename must be grep-verified unused in `CHANGELOG.md`.
