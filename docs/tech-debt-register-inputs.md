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
