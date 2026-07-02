# Tech-Debt Register Inputs (Phase 1 → migrated into the living register in Phase 4)

> Scratchpad for items parked during Phase 1. Phase 4 Task 7 migrates these into `docs/tech-debt-register.md` and deletes this file.

## Deferred major dependency upgrades (Phase 4 Task 4 — one MR each)

Recorded from `npm outdated` on 2026-07-02. Order: security-relevant → tooling → runtime.

| Package | Current | Latest major | Notes |
|---|---|---|---|
| `@azure/msal-browser` | 4.30.0 | 5.16.0 | auth lib — review changelog for breaking token-cache/API changes; test M365 flows |
| `eslint` | 9.39.4 | 10.6.0 | pairs with `eslint-config-next` support for v10; check flat-config compat |
| `typescript` | 5.9.3 | 6.0.3 | run full `tsc --noEmit` + build; watch for stricter checks |
| `jsdom` | 25.0.1 | 29.1.1 | test env — verify the layout-stub landmines still hold |
| `@vitejs/plugin-react` | 4.7.0 | 6.0.3 | vitest transform — verify property suites |
| `@types/node` | 20.19.41 | 26.1.0 | align with the Node runtime (CI is node:20 image; a v26 types on node 20 may over-declare APIs — bump with the runtime, not before) |

## Held — CI-image lockstep (NOT a major, but paired)

| Package | Current | Wanted | Why held |
|---|---|---|---|
| `@playwright/test` | 1.60.0 | 1.61.1 | CI e2e image is pinned `mcr.microsoft.com/playwright:v1.60.0-jammy`. Bumping the client without the image tag drifts them (documented lockstep, AGENTS.md). Bump both together in one MR. |
| `@axe-core/playwright` | 4.11.3 | 4.12.1 | peers on `@playwright/test`; bump alongside the playwright pair to avoid peer drift. |
| `@tiptap/react` + `@tiptap/starter-kit` | 3.26.1 | 3.27.1 | bumping to 3.27 skews the tiptap sub-packages → `tsc` error TS2769 in `rich-text-editor.tsx` (`Extension<StarterKitOptions>` not assignable to `AnyExtension`). Needs a coordinated bump of the whole `@tiptap/*` set; reverted in Phase 1. |

## Range-pinned (no action — semver range holds them)

`next` (forked, A7 — never auto-bump), `eslint-config-next`, `react`, `react-dom` — all report `Wanted == Current`; the latest is outside the pinned range by design.

## Phase 3 residual — `task-manager.tsx` size (documented, not force-split)

Phase 3 (decomposition) extracted the five clearly-separable clusters from
`task-manager.tsx` behind the Phase 2 characterization net, all move-only:

| Extraction | Module | Kind |
|---|---|---|
| Outlook calendar push/pull/auto-sync (milestones + committee + task/raid/change/absence) | `use-calendar-integrations.ts` | hook factory |
| Action-Center CTA handlers (assign/create/mark-done/clear-blocker/draft/escalate/rebaseline/reschedule) | `use-action-center-handlers.ts` | hook factory |
| AI advisory orchestration (analyze + weight-suggestion ctx + scheduled-job runner) | `use-ai-orchestration.ts` | hook factory |
| Dual-header assembly (classic AppHeader + modern topBarMenus) | `shell-chrome.tsx` (`buildShellChrome`) | render builder |
| Four two-way calendar pull-summary modals | `calendar-summary-modals.tsx` | props-only component |

Result: `task-manager.tsx` **2,841 → ~2,246 lines** (−595, ~21%).

**The ≤800-line target is NOT met and is deliberately not pursued further.** The
residual is genuine root-orchestrator glue: workspace state + ~40 hook mounts,
the load/save/broadcast effects and their refs, view routing, and the
classic/modern/popout render trees. Any further split would produce
pass-through modules with no independent cohesion (thread N deps in, return N
values out) — a YAGNI violation that trades one large cohesive file for several
coupled ones without improving testability. The five extractions above removed
everything that had a real seam; what remains is the orchestrator by definition.

Phase 4 note: if the root is revisited, the higher-leverage move is reducing the
number of top-level hooks/effects (consolidating related state), not slicing the
render tree. Do not re-open this as a line-count task.

## Phase 3 Tasks 6–11 — outcomes + scope decisions

Tasks 6–11 (panel splits, prop-bag + toolbar dedup, persistence guard, proxy
security) all landed move-only behind the characterization net. Notable outcomes
and deliberate deviations from the plan sketch:

| Task | Outcome |
|---|---|
| T6 | `workspace-section.tsx` 1009→849; tab-strip chrome → `workspace-section-chrome.tsx`. |
| T7 | `raid-panel.tsx` 905→517; toolbar → `raid-panel-toolbar.tsx`, table → `raid-panel-rows.tsx`, cols → `raid-panel-columns.ts` (gantt pattern). |
| T8 | 18 flat calendar props (raid/change/absence) → 3 `EntityCalendarProps` bags on the pane contract; milestone stays flat (manual-only). Consolidated at the WorkspaceSectionProps boundary — panes keep their uniform flat interface, so leaf panes + their tests were untouched. |
| T9 | Shared `CalendarSyncControls` replaces the calendar toggle/push/pull block duplicated verbatim in the RAID/Change/Absence toolbars. |
| T10 | `entity-persistence-registry.test.ts` guards `outlookEventId` across CSV+MD (+Turso via CSV cols) for all 5 calendar-synced entities. |
| T11 | Byte-identical SSRF classifier (`isPrivateHost`/`mappedIpv4ToDotted`) → `api/_shared/proxy-ssrf.ts`, shared by jira+timelog. |

**Deliberate scope calls (YAGNI / risk-over-reward):**
- **T10 `makeEntityCrudHandlers` factory — NOT done.** The save/delete handlers
  the plan assumed were an inline task-manager cluster already live in cohesive
  per-entity hooks (`useResourcePlanner` / `useChangeLog` / `useStakeholders`).
  Forcing them through a uniform factory would add risk without cohesion; each
  hook already encapsulates its entity's divergent behavior. The high-value half
  (the persistence-registry guard test) was done.
- **T11 full `ProxyConfig` factory — NOT done.** Only the byte-identical SSRF
  primitives were shared. The provider-specific normalize/auth/URL chains
  (Atlassian full-URL vs Timelog host+tenant, Basic vs Bearer, path allowlist)
  genuinely diverge; parameterizing divergent *security* guards into one factory
  adds config surface where a mistake silently weakens a guard. The route tests
  (jira 21 + timelog 18 SSRF cases) pinned behavior across the change.

**dup:check gate NOT met (documented, not a defect).** Exit target was ≤50% of
the Phase 1 baseline (3.065% → ≤1.53%). That is a *repo-wide* halving of all
clones, not something the toolbar/prop dedup in this phase can deliver. T8+T9
moved the needle 2.85%→2.82% (3 calendar-block copies → 1 component). Remaining
duplication is spread across edit-modals and unrelated panels; a repo-wide dedup
is its own future effort, not a Phase 3 line item.

**task-manager characterization pins retained.** The plan's Task 5 optionally
replaced the characterization pins with per-hook unit tests; the pins were kept
(and updated for the Task 8 bag rename) — they are a cheap, coarse routing/prop
tripwire that still adds value, and deleting them to add narrower tests is churn
without benefit here.
