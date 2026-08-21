# Help Expansion SP4 — Themed Guided Tours

**Date:** 2026-06-29
**Part of:** the 4-part "expand Help for PM novices" roadmap (SP1 backbone+Help-view · SP2 contextual per-view callouts · SP3 interactive relations map · **SP4 themed guided tours**). SP4 is the final sub-project; it builds on the existing single-tour engine (`app-tour.ts` / `use-tour.ts` / `tour-overlay.tsx`, shipped earlier as "SP-F").

## Goal

Turn the single linear onboarding tour into a **catalog of themed guided tours** a PM-novice can pick from by goal ("Getting started", "Managing risks", "Reporting", "Planning", "Stakeholders & communication", "AI assistant"). The existing onboarding tour becomes the `getting-started` entry; its content and first-run behavior are unchanged. EN + DE.

## Audience / success

A novice opens Help, sees a "Guided tours" section with one card per theme, and can launch a focused walkthrough of just the area they care about — RAID, reporting, planning, etc. Completed tours show a ✓ badge so progress is visible. Success: a user can self-serve a topic-specific guided walkthrough without reading the whole feature reference.

## Approved design decisions (forks)

1. **Catalog surface = a "Guided tours" section inside the Help view** (a `<details open>` section above the SP3 relations map, mirroring its disclosure pattern). NO new picker modal. HelpMenu "Take the tour" keeps launching `getting-started` directly; first-run auto-launch is unchanged.
2. **Per-tour completion tracking** = a persisted `completedTours` string-id set (per-device, rides the `writeSettings` spread like `tourSeen`). The catalog renders a "✓ Done" badge per finished tour. `tourSeen` still gates the first-run auto-launch separately.
3. **Richer set = 6 themed tours v1:** getting-started · raid · reporting · planning · stakeholders · ai. Each tour's steps are module-gated per the existing `visibleSteps` logic.

## Architecture

### Engine — `app-tour.ts` (pure, i18n-free; keys only, no React/Date)

Add a catalog layer on top of the existing `TourStep` model (unchanged):

```ts
export interface TourDefinition {
  id: string;              // stable, e.g. "getting-started", "raid"
  titleKey: TranslationKey;
  descKey: TranslationKey; // one-line catalog blurb
  steps: readonly TourStep[];
}

export const TOURS: readonly TourDefinition[];   // the 6 tours, in catalog order
export const TOUR_STEPS: readonly TourStep[];     // KEPT export = the getting-started tour's steps (back-compat: tour-overlay.test imports it)
export function findTour(id: string): TourDefinition | undefined;
```

- The current flat `TOUR_STEPS` array becomes the `getting-started` tour's `steps` **verbatim** (zero change to onboarding content/order). `TOUR_STEPS` is re-exported as `TOURS[0].steps` so `tour-overlay.test.tsx` (which imports `TOUR_STEPS`) is unaffected.
- `visibleSteps` generalizes from `visibleSteps(features)` to **`visibleSteps(steps, features)`** — filters any tour's steps, dropping a step whose deep-link `view` belongs to a disabled feature module (`isViewEnabled`); steps without a `view` always survive. Its sole caller (`use-tour.ts`) is updated to pass `activeTour.steps`.
- `TOUR_ANCHORS` stays as-is (the getting-started spotlight anchors). New themed tours use `kind: "modal"` steps with a `view` deep-link (no new anchors required); a themed step MAY reuse an existing anchor if useful, but v1 themed tours are modal-only for simplicity.
- 5 new `TourDefinition`s, each with its own `TourStep[]` (3–5 steps), `view`-deep-linked:
  - **raid** — RAID register, the risk matrix, RAID review reminders.
  - **reporting** — Dashboard cockpit, Reports view, earned-value/EVM.
  - **planning** — Milestones, the Gantt timeline, critical path.
  - **stakeholders** — Stakeholder register, RACI, stakeholder communication.
  - **ai** — Ask-Claude chat, AI action analysis, (advisory-only framing).

### State — `use-tour.ts`

- Add `activeTourId` state (string). `start(tourId?: string)` defaults to `"getting-started"` so the existing auto-launch and HelpMenu "Take the tour" call sites keep launching the onboarding tour with no change.
- `const activeTour = findTour(activeTourId) ?? TOURS[0];`
- `steps = useMemo(() => visibleSteps(activeTour.steps, features), [activeTourId, features])` — hoist `activeTour.steps` reference to a local if needed to satisfy exhaustive-deps (depend on `activeTourId`+`features`, not `activeTour.steps`).
- `done()` → close + mark `tourSeen:true` + add `activeTourId` to `completedTours` (deduped) via a single functional `setSettings(s => ({ ...s, tourSeen: true, completedTours: dedupe([...(s.completedTours ?? []), activeTourId]) }))`.
- `skip()` → close + `tourSeen:true` (no completion badge).
- Render-time auto-launch is **unchanged**: eligibility `hydrated && layout==="modern" && !isPopout && !tourSeen && steps.length>0`, launches the default (`getting-started`) tour. (When `start` is called with no arg the default activeTourId is already `getting-started`.)
- New exposed values: `catalogTours: ReadonlyArray<{ id: string; titleKey: TranslationKey; descKey: TranslationKey }>` — `TOURS` filtered to those whose `visibleSteps(t.steps, features).length > 0` (a fully module-gated-out tour is dropped); and `completedTours: readonly string[]` (`settings.completedTours ?? []`).
- `start` updated to `(tourId?: string) => { setActiveTourId(tourId ?? "getting-started"); setIndex(0); setIsOpen(true); }`.

### Settings — `settings-types.ts`

- New optional field `completedTours?: readonly string[]` — per-device, rides the `writeSettings` spread (NO allowlist edit; mirrors `tourSeen`/`dashboardDensity`). `sanitizeSettings`/load accepts an array of strings (drop non-strings, dedupe, cap to a sane max e.g. 50); absent → treated as `[]`. Not in exports/Turso (it is a device-local UI flag, like `tourSeen`).

### Catalog UI

- New presentational **`tour-catalog.tsx`**:
  ```ts
  export function TourCatalog({ lang, tours, completedTours, onStartTour }: {
    lang: Lang;
    tours: ReadonlyArray<{ id: string; titleKey: TranslationKey; descKey: TranslationKey }>;
    completedTours: readonly string[];
    onStartTour: (id: string) => void;
  }): JSX.Element
  ```
  - Responsive card grid: `grid grid-cols-1 gap-2 sm:grid-cols-2` (carries a mobile base per the responsive-grid convention).
  - Each card = a real `<button>` (whole card clickable → `onStartTour(t.id)`): title (`t(lang, t.titleKey)`), desc blurb (`t(lang, t.descKey)`), and a `✓ <tourDoneBadge>` chip when `completedTours.includes(t.id)`. Palette tokens only; `INTERACTIVE` atom appended; the ✓ glyph is `aria-hidden` (label-bleed rule) with the badge text as the accessible part.
  - Props-only (no `useWorkspaceTab`/context) so it can be unit-tested standalone, matching `view-callout.tsx`/`relations-map.tsx`.
- **`help-view.tsx`**: new optional props
  ```ts
  onStartTour?: (id: string) => void;
  catalogTours?: ReadonlyArray<{ id: string; titleKey: TranslationKey; descKey: TranslationKey }>;
  completedTours?: readonly string[];
  ```
  - When `onStartTour` is present, render a `<details open className="mb-2 shrink-0 print:hidden">` **"Guided tours"** section (summary `helpGuidedToursTitle`, intro `helpGuidedToursIntro`) containing `<TourCatalog tours={catalogTours ?? []} completedTours={completedTours ?? []} onStartTour={onStartTour} />`, placed directly ABOVE the SP3 relations-map `<details>`.
  - **The whole section is gated on `onStartTour` presence** (mirrors the existing `onTakeTour` gate) — the standalone `help-view.test.tsx` (no provider), classic shell, and popouts don't render it, so tours stay modern-only and the existing tests are unaffected.

### Wiring

- **`task-manager.tsx`**: `useTour` now also returns `catalogTours` + `completedTours`, and `tour.start` takes an optional id. Thread into `HelpView` (via `workspace-section`):
  - `onStartTour={settings.layout === "modern" && !isPopout ? tour.start : undefined}`
  - `catalogTours={tour.catalogTours}`
  - `completedTours={tour.completedTours}`
  - `startTour` (HelpMenu `onTakeTour`) is unchanged (`tour.start` with no arg → getting-started).
  - `TourOverlay` render gains `tourTitleKey={findTour(/* active */)?.titleKey}` — see below.
- **`workspace-section.tsx`** + **`workspace-section-types.ts`**: 3 new OPTIONAL `WorkspaceSectionProps` fields (`onStartTour?`, `catalogTours?`, `completedTours?`) threaded straight to `<HelpView>`. Optional ⇒ the ~30 caller/test sites are unaffected.

### Overlay — `tour-overlay.tsx`

- Add an OPTIONAL `tourTitleKey?: TranslationKey` prop. When present, render a small muted label (`text-[11px] text-muted-foreground`) above the step `<h2>` so a themed tour reads as themed (e.g. "Managing risks"). Absent → unchanged. Existing `tour-overlay.test.tsx` calls (no `tourTitleKey`) are unaffected.
- To supply it, `use-tour` exposes the active tour's title key (e.g. via a returned `activeTourTitleKey`), threaded by task-manager into `<TourOverlay tourTitleKey={...} />`. (Engine `findTour` is pure; task-manager can also derive it directly.)

## i18n (EN `i18n.ts` Edit; DE `i18n.de.ts` node utf8 write, CRLF, `\u` umlauts; tsc enforces EN/DE parity)

- **Section + chrome:** `helpGuidedToursTitle` ("Guided tours"), `helpGuidedToursIntro` (one-line), `tourStartCta` ("Start tour"), `tourDoneBadge` ("Done").
- **Per tour (catalog):** `tour<Name>Title` + `tour<Name>Desc` for all 6 (`tourGettingStartedTitle/Desc`, `tourRaidTitle/Desc`, `tourReportingTitle/Desc`, `tourPlanningTitle/Desc`, `tourStakeholdersTitle/Desc`, `tourAiTitle/Desc`).
- **Per new-tour step:** `tourStep<Tour><Step>Title/Body` for the 5 new tours (~3–5 steps each), novice-focused (plain-language "what this is / why it matters / where to click"). The getting-started tour reuses its existing `tourStep…` keys.
- Bodies are short, plain-language; rendered as `whitespace-pre-line` like existing step bodies.

## Testing

- **`app-tour.test.ts`** (extend): every `TOURS` entry has a unique `id` and ≥1 step; every step `view` (when set) is a valid `AppView`; `findTour("getting-started")?.steps === TOUR_STEPS`; `visibleSteps(steps, features)` drops a step whose `view` is a disabled module and keeps view-less steps; `findTour("nope")` → `undefined`.
- **`use-tour.test.tsx`** (extend): `start("raid")` sets the active tour and resets index to 0 (steps become the raid tour's visible steps); `done()` appends the active id to `completedTours` via the `setSettings` updater (and sets `tourSeen`); `skip()` sets `tourSeen` only; auto-launch still launches getting-started; classic/popout/`tourSeen=true`/`!hydrated` still suppress auto-launch; `catalogTours` drops a tour gated to 0 visible steps.
- **`tour-catalog.test.tsx`** (new): renders one card per passed tour; a card shows the `✓ Done` badge when its id is in `completedTours`; clicking a card fires `onStartTour(id)`.
- **`help-view.test.tsx`** (extend): the "Guided tours" section renders when `onStartTour` is provided (and a tour title appears); it does NOT render when `onStartTour` is absent.

## Constraints / landmines honored

- **Help is NOT in the axe `A11Y_VIEWS` gate** → eye-verify the catalog (labeled buttons, palette tokens, INTERACTIVE atom, keyboard focus) on `npm run dev`; jsdom rect=0 so tests assert structure/handlers, not pixels.
- **`visibleSteps` signature change** touches only `use-tour.ts`; `TOUR_STEPS` is kept as an export so `tour-overlay.test.tsx` is unaffected.
- **A fully module-gated-out tour** (0 visible steps under current features) is dropped from `catalogTours` and is unreachable from the catalog.
- **react-hooks purity:** render-time auto-launch pattern unchanged (no `set-state-in-effect`); `completedTours` written via a single functional `setSettings`; no `Date.now()`/`Math.random()`/`new Date()` in any render body. Hoist `obj.member` out of `useMemo`/effect dep arrays (depend on `activeTourId`, not `activeTour.steps`).
- **`completedTours`** rides the `writeSettings` spread (no allowlist edit); device-local, OUT of exports/Turso (like `tourSeen`), cleared with the rest of `settings` by app reset's localStorage sweep.
- **DE edits** via node utf8 write (Edit tool corrupts umlauts/curly-quotes in CRLF `i18n.de.ts`); grep-verify after.
- **Versioning (on release):** this is a feature batch → bump `APP_VERSION` + milestone, add a `CHANGELOG.md` entry; no new `versionHighlight*` key unless we want a highlight.
- **AGENTS.md:** add an "Themed guided tours (Help SP4)" bullet under the SP3 bullet documenting `TourDefinition`/`TOURS`, the catalog section, `completedTours`, and the modern-only gating.

## Out of scope (YAGNI)

- No picker modal (catalog lives in Help view).
- No per-tour resume/bookmark (a tour always starts at step 0).
- No analytics/telemetry on tour usage.
- No tour authoring UI (tours are code-defined).
