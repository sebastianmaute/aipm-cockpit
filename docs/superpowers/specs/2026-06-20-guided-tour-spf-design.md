# SP-F - Guided Tour + Demo Showcase - Design

**Date:** 2026-06-20
**Status:** Approved (design)
**Target release:** v0.112.0

> Sixth and FINAL slice of the 6-part roadmap ([[task-status-kanban-roadmap]]). Onboarding:
> a guided tour of the app plus a one-click demo-data load so first-run users land in a
> populated project. Reuses the existing nav/deep-link channel (`requestOpen`/`setActiveTab`),
> the file-load apply path, the per-device settings store, and the bundled
> `sample-workspace-small.json`.

## Goal

Help a first-run user understand the app: auto-launch a short guided tour (modern shell only),
let them load a demo project in one click so the tour has real data to point at, and leave a
"Take the tour" entry in the Help menu to replay later.

## Non-goals (SP-F)

- No tour in the classic shell or popouts (modern layout only).
- No DOM-anchored tour in classic/popout; no cross-shell anchoring.
- No analytics/telemetry of tour progress.
- No server state - the "seen" flag is a per-device setting.
- No new persisted Workspace field. Demo load reuses the existing file-load apply path.
- No new external hosts / CSP changes. The demo source is a bundled JSON, lazily imported.

## Decisions (locked during brainstorming)

1. **Modern shell only.** The tour never renders or auto-launches in the classic shell or popouts.
2. **Hybrid mechanism.** A centered showcase modal is the spine; a SUBSET (~3-4) of steps are
   anchored "spotlight" steps over real modern-shell controls. An anchor that is missing
   (gated/unmounted) falls back to a centered modal - never points at nothing.
3. **One-click demo load.** An empty-state CTA loads `sample-workspace-small` then launches the
   tour. Shown ONLY in the empty state, so it never clobbers an existing project.
4. **Auto first-run + Help re-launch.** Auto-launch once (per-device `tourSeen` flag); a Help-menu
   entry replays it anytime (over whatever data is loaded; no demo write on replay).
5. **Broad depth (~10-12 steps).**

## Architecture

### A. Pure tour engine (`app-tour.ts`, i18n-free)
```ts
export type TourStepKind = "modal" | "spotlight";
export interface TourStep {
  id: string;                 // stable id, used in tests + progress
  kind: TourStepKind;
  titleKey: TranslationKey;   // i18n keys only - engine stays i18n-free
  bodyKey: TranslationKey;
  view?: AppView;             // deep-link target ("Show me" navigates here)
  anchorId?: string;          // data-tour-id of the spotlight target (kind==="spotlight")
  requiresModule?: FeatureModuleId; // step dropped if the module is disabled
}
export const TOUR_STEPS: readonly TourStep[];           // the ordered ~10-12 steps (keys only)
export function visibleSteps(features: readonly FeatureModuleId[]): TourStep[]; // drop gated steps
export function clampStep(index: number, total: number): number; // bound to [0, total-1]
```
- Pure, total, no React/`Date`. `visibleSteps` filters any step whose `requiresModule` is disabled
  OR whose `view`'s module is disabled (reuse `moduleForView`/`isModuleEnabled`) so the tour never
  navigates to a hidden view. Order is deterministic.
- The step list (broad, ~10-12): welcome; create/import a project; tasks (Table/Board toggle);
  Action Center; AI assistant (Ask Claude); reports/dashboard; RAID; milestones/Gantt;
  stakeholders; steering committee; settings/storage; finish. Trim to the modules that exist.

### B. Tour overlay (`tour-overlay.tsx`, modern-only)
Renders the current step. Props: `{ lang, steps, index, onBack, onNext, onSkip, onDone }`.
- **Modal step** (`kind:"modal"`): a centered `role="dialog"` `aria-modal="true"` card with the
  title/body, progress dots (`index+1 / total`), and Back / Skip / Next (or Done on the last).
  Focus-trapped; Escape = Skip. AIPM tokens only.
- **Spotlight step** (`kind:"spotlight"`): a dimmed full-screen overlay with a "hole" + a tooltip
  positioned next to the `[data-tour-id={anchorId}]` element via `getBoundingClientRect`. Same
  controls. **If the anchor element is not found (view not mounted / gated), render the step as a
  centered modal instead** (no spotlight) so it never points at nothing.
- A "Show me" affordance on steps with a `view`: calls the deep-link nav (host wires it) and keeps
  the overlay open.
- The overlay is mounted ABOVE the shell (in `task-manager`), so deep-link navigation between
  views does not unmount it.

### C. Tour state hook (`use-tour.ts`, lives in `task-manager`)
- Open state + current index. `start()` opens at step 0; `next/back` clamp; `skip/done` close and
  set `tourSeen`.
- `tourSeen` is `settings.tourSeen` (per-device). Persist via the settings setter -> `writeSettings`
  (NEVER raw `setItem`). Marking seen on skip/done.
- **Auto-launch:** when `layout==="modern" && !isPopout && !settings.tourSeen`, open the tour. Use
  the render-time reconcile pattern (a `lastHandled` ref/nonce), NOT a `useEffect` setState
  (`react-hooks/set-state-in-effect` is banned). Never auto-launch in classic/popout.

### D. Demo data load
- `project-empty-state.tsx` gains `onLoadDemo?: () => void` and a CTA "Explore a demo project"
  (shown only when `onLoadDemo` is provided - i.e. the empty state).
- `task-manager` `loadDemo()`: `const mod = await import("../../sample-workspace-small.json")` (lazy
  - code-split, off the main bundle), `jsonToWorkspace(JSON.stringify(mod.default ?? mod))`, then
  apply via the SAME path the file-load uses (the entity setters + persist; reuse
  `loadProjectFromFile`'s apply helper / the load-reset effect's setters). Then `start()` the tour.
- Because the CTA is empty-state-only, demo load never overwrites a real project. The Help
  re-launch runs the tour over whatever is loaded and writes NO demo data.
- Errors: a failed import/parse -> toast (`tourDemoError`); the tour still opens (over the empty
  project) so the user is not stuck.

### E. Triggers / entry points
- Auto first-run (modern, non-popout, unseen) -> open at step 0.
- Help menu (modern `topBarMenus`) "Take the tour" item -> `start()`. The item needs an accessible
  name (top bar is axe-scanned in every view). The classic `AppHeader` Help menu MAY show it, but
  clicking it in classic is a no-op/with a note - simplest: only add it to the modern Help menu.

## Error handling
- Demo import/parse failure -> sanitized toast; tour still launches.
- Missing spotlight anchor -> centered-modal fallback for that step.
- `visibleSteps` empty (everything gated - shouldn't happen, welcome/finish are core) -> tour
  no-ops gracefully (don't open).
- Escape / Skip always closes and marks `tourSeen`.
- Overlay never throws on a bad index (`clampStep`).

## Testing (TDD)
Pure first:
- `visibleSteps` - drops steps whose `requiresModule` / `view`-module is disabled; keeps core.
- `clampStep` - bounds at 0 and total-1.
Then:
- `tour-overlay` - renders a modal step (title/body/dots); Back/Skip/Next call handlers; Done on
  last step; Escape = Skip; focus trap; a `spotlight` step with a MISSING anchor renders as a modal
  (fallback). (jsdom has no layout - `getBoundingClientRect` is 0; test the pure engine + the modal
  path + the fallback; spotlight positioning is eye-verified.)
- `use-tour` / demo-load - `loadDemo` parses the sample, applies it (entity counts > 0), launches
  the tour; the CTA is absent when `onLoadDemo` is not provided; skip/done sets `tourSeen` via the
  settings setter (not raw setItem).
- auto-launch: modern + unseen -> opens; classic or popout or seen -> does NOT open.
- `npx tsc --noEmit` (EN/DE parity) after editing tests; the overlay is NOT in `A11Y_VIEWS` (verify;
  eye-check labels + focus). EN+DE i18n (DE via node UTF-8 write, real umlauts).

## i18n / release
- New EN+DE keys: ~10-12 step `tourStep<X>Title` / `tourStep<X>Body`, "Explore a demo project"
  (`tourLoadDemo`), "Take the tour" (`tourLaunch`), Back/Skip/Next/Done if not already shared,
  the "Show me" label, `tourDemoError`, and `versionHighlightTour`.
- Bump `version.ts` (0.112.0 + codename), append `versionHighlightTour` to `APP_HIGHLIGHT_KEYS`
  (+ EN/DE), add a `CHANGELOG.md` entry. No CSP change (demo JSON is a bundled import).

## File map
- `app-tour.ts` (NEW pure) - `TourStep`, `TOUR_STEPS`, `visibleSteps`, `clampStep`.
- `tour-overlay.tsx` (NEW, modern-only) - the modal + spotlight overlay.
- `use-tour.ts` (NEW) - open state + `tourSeen` + auto-launch (render-time reconcile).
- `project-empty-state.tsx` - `onLoadDemo` CTA.
- `task-manager.tsx` - mount overlay, `loadDemo` (lazy sample import + apply + start), Help-menu
  entry, auto-launch wiring, ~4 `data-tour-id` attributes on anchored controls.
- `settings-types.ts` - `tourSeen?: boolean`.
- `i18n.ts` / `i18n.de.ts`, `version.ts`, `CHANGELOG.md`.
