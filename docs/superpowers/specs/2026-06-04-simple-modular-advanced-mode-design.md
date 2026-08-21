# Simple / Modular / Advanced Mode — Design (v0.54.0 "Herbert")

**Date:** 2026-06-04
**Status:** Approved (pending written-spec review)
**Release:** v0.54.0 "Herbert" (continues Le Guin → Sanderson → Pratchett → Scalzi → Asimov)

## Goal

Let the user pare the app down to a **Simple** mode that exposes only the always-on
core (Tasks, Chat, Reports), turn individual feature-modules back on to reach a
**Modular** mode, and automatically return to **Advanced** (the default, everything on)
once every module is enabled. Disabling a module **retains its data**, records no new
data for it, and **pauses any cross-module automation** that touches it. Mode/module
configuration lives in Settings, uses checkboxes, and requires an **explicit Save that
triggers a reload**.

No storage schema change — this is settings + UI gating only. Existing workspace data is
never deleted.

## Context

The app has a single source of truth for the current view: `activeTab` (from
`useWorkspaceTab`). Both the modern sidebar (`SidebarNav` over `NAV_GROUPS`) and the
classic tab strip / sub-tabs call `setActiveTab`. Settings live in the `Settings` type
(`settings-types.ts`), are auto-saved live by `useSettings`, and are edited in the
full-page `SettingsView` (a left RAIL of sections). Cross-module automation already
exists: due/RAID-review alerts (`use-due-alerts`), dashboard RAG/EVM aggregation,
snapshot/trends capture (`use-snapshots`), RAID→mitigation-task creation, RACI↔milestones,
and the addable-reports registry.

All work obeys the AIPM 9-colour palette (no gradients/shadows/off-palette; the one allowed
amber is `bg-amber-500/20 text-AIPM-purple`), the ASCII-only `i18n.de.ts` rule (byte-patch
via Node, CRLF-aware — never the Edit tool), and the `--max-warnings=0` lint gate.

## Decisions (locked during brainstorming)

1. **Module split:** 9 toggleable modules; `activity` stays core. Simple mode keeps
   Tasks + Chat + Reports + Activity + Settings.
2. **Off-data:** a disabled module is **hidden everywhere** (nav, dashboard tiles,
   addable report, alerts, new snapshots) until re-enabled. Data is retained in storage
   and reappears intact.
3. **Reports linkage:** enabling a module unlocks its addable report; the in-Reports
   add/remove control stays **live** (no reload). Only the module toggles use save+reload.

## Model: the module registry

New file `src/app/feature-modules.ts` is the single source of truth.

```typescript
import type { AppView } from "./nav-config";
import type { AddableReportId } from "./addable-reports";
import type { TranslationKey } from "./i18n";

export type FeatureModuleId =
  | "dashboard" | "trends" | "gantt" | "milestones" | "resources"
  | "budget" | "raid" | "changes" | "stakeholders";

export interface FeatureModule {
  id: FeatureModuleId;
  labelKey: TranslationKey;       // reuse existing nav labels
  /** Parent view + every child view this module owns. */
  views: AppView[];
  /** The addable report this module unlocks, if any. */
  report?: AddableReportId;
}

export const FEATURE_MODULES: readonly FeatureModule[] = [
  { id: "dashboard",    labelKey: "navDashboard",   views: ["dashboard"] },
  { id: "trends",       labelKey: "navTrends",      views: ["trends"] },
  { id: "gantt",        labelKey: "tabGantt",       views: ["gantt"] },
  { id: "milestones",   labelKey: "navMilestones",  views: ["milestones"] },
  { id: "resources",    labelKey: "tabResources",
      views: ["resources", "directory", "workload", "calendar", "planning", "manage-roles"],
      report: "resource-report" },
  { id: "budget",       labelKey: "tabBudget",      views: ["budget", "budget-report"], report: "budget-report" },
  { id: "raid",         labelKey: "tabRaid",        views: ["raid", "raid-report"], report: "raid-report" },
  { id: "changes",      labelKey: "navChanges",     views: ["changes", "change-report"] },
  { id: "stakeholders", labelKey: "navStakeholders",
      views: ["stakeholders", "raci", "stakeholder-map"], report: "stakeholder-report" },
] as const;

/** Views that are always present regardless of mode. */
export const CORE_VIEWS: readonly AppView[] =
  ["open-points", "chat", "reports", "activity", "settings", "edit"] as const;

export const ALL_MODULE_IDS: readonly FeatureModuleId[] =
  FEATURE_MODULES.map((m) => m.id);

export type AppMode = "simple" | "modular" | "advanced";
```

Helper functions (all pure, all unit-tested):

- `sanitizeFeatures(raw: unknown): FeatureModuleId[]` — keep only valid ids, unique, in
  registry order. **`undefined` (legacy, no key) → all module ids** (preserves current
  Advanced behavior). An explicit array (including `[]`) is honoured as-is.
- `deriveMode(features: FeatureModuleId[]): AppMode` — `length === 9` → `"advanced"`;
  `length === 0` → `"simple"`; else `"modular"`.
- `isModuleEnabled(id, features): boolean`.
- `isViewEnabled(view: AppView, features): boolean` — core views always `true`; otherwise
  true iff the owning module is enabled.
- `moduleForView(view: AppView): FeatureModuleId | null`.
- `enabledNavViews(features): AppView[]`.
- `visibleReports(extra: AddableReportId[], features): AddableReportId[]` — filter the
  stored extra-reports list to those whose module is enabled (stored value untouched).

`Settings` (in `settings-types.ts`) gains:

```typescript
features: FeatureModuleId[];   // the enabled set
```

with `defaultSettings.features = [...ALL_MODULE_IDS]`. `useSettings` merges via
`sanitizeFeatures(parsed.features)` on load (legacy → all-on).

## Settings UI: the Mode section

New `src/app/settings-sections/mode-section.tsx`, added to `SettingsView`'s RAIL as the
first entry (`{ id: "mode", labelKey: "settingsSectionMode" }`).

Behaviour — **draft + explicit save** (unique among sections, which auto-save live):

- Local state `draft: FeatureModuleId[]`, seeded from `settings.features`.
- A **mode badge** showing `deriveMode(draft)` → localized Simple / Modular / Advanced.
- Two preset buttons: **Simple** (sets draft `[]`) and **Advanced** (sets draft to all).
- **9 checkboxes**, one per `FEATURE_MODULES` entry, labelled with the module's `labelKey`.
  Toggling a box edits the draft; the badge updates live (ticking the last → Advanced,
  unticking all → Simple).
- **Save** button: enabled only when `draft` differs from `settings.features` (order-
  insensitive compare). On click it calls a new prop `onCommitFeatures(next)` which:
  1. writes the merged settings to `localStorage["lop-app:settings"]` synchronously
     (merge into the existing persisted object so no live state is lost), then
  2. calls `window.location.reload()`.
  This guarantees the new feature set is durable before the reload re-initialises nav,
  dynamic imports, and automation hooks. (We do NOT rely on the `useSettings` persist
  effect, which may not flush before reload.)
- **Discard** button: resets `draft` to `settings.features` (enabled only when dirty).
- Inline note shown whenever `draft` drops a module vs saved: *"Existing data is kept and
  reappears when you re-enable a module."* (No blocking confirm — nothing is destroyed.)

`SettingsView` receives a new prop `onCommitFeatures: (features: FeatureModuleId[]) => void`,
threaded from the settings host (`task-manager.tsx`), which performs the localStorage
merge-write + reload. Tests stub `window.location.reload` and assert the merge-write.

## Navigation & active-view gating

- `nav-config.ts` gains `filterNavGroups(features): NavGroup[]` — returns `NAV_GROUPS`
  with disabled items and children removed, and groups that become empty dropped. Core
  items (chat, reports, activity, settings, open-points) always survive.
- `subTabsFor(view, features?)` filters children to enabled ones when `features` supplied
  (back-compatible: omitting `features` keeps current behavior for any non-gated caller).
- Consumers updated to pass `settings.features`:
  - Modern sidebar (`sidebar-nav.tsx` via `sidebar.tsx` / `modern-shell.tsx`) renders
    `filterNavGroups(features)`.
  - Classic tab strip in `workspace-section.tsx` renders each top tab only when its module
    is enabled (Chat / Reports / Activity always; Gantt / RAID / Resources / Budget gated;
    Dashboard/Trends/Milestones/Changes/Stakeholders reachable via the gated sub-tab row,
    which also filters).
- **Active-view redirect** (`task-manager.tsx`): on mount/after reload, if `activeTab` is
  not `isViewEnabled(activeTab, features)`, redirect to **`dashboard` if enabled, else
  `open-points`**. Folds into the existing layout-redirect effect (lines ~103–113).

## Chain handling (the five rules)

| Rule | Effect |
|------|--------|
| **Producer** | An entity is creatable/editable only if its module is on (enforced by hiding its views — the only edit entry points). |
| **Consumer** | A surface shows another module's contribution only if that module is on; else hidden (retained, not deleted). |
| **Automation** | Background automation runs only for enabled modules. |
| **Retention** | Disabling never deletes; data and stored sub-settings (e.g. `reports.extra`) are preserved and reappear on re-enable. |
| **Always-valid targets** | Tasks/Chat/Reports are always on, so chains that write into tasks (RAID→mitigation task, chat→task) always have a valid target. |

Per-chain application:

- **`use-due-alerts.ts`** — gate the RAID-review block by `isModuleEnabled("raid", features)`.
  Task due-alerts stay unconditional (tasks are core). Pass a `raidEnabled: boolean` (or
  the `features` array) through `UseDueAlertsArgs`. Keep `raid` in the effect deps.
- **`dashboard-panel.tsx`** — gate each section/tile by its module: Budget RAG + EVM
  SPI/CPI only when `budget` on; milestone health only when `milestones` on; RAID counts
  only when `raid` on; Changes counts only when `changes` on. The Dashboard panel receives
  a `features` (or per-flag) prop. When the whole `dashboard` module is off the view is
  simply unreachable.
- **Snapshot capture / Trends** — capture is gated on `trends` being enabled (off ⇒ no new
  snapshots). Wire the `trends` flag into wherever `use-snapshots` capture is triggered in
  `task-manager.tsx`; the existing `snapshots.enabled` setting still applies on top.
- **Gantt** — hide milestone markers and the "Add milestone" affordance when `milestones`
  is off (gantt receives a `milestonesEnabled` flag).
- **Cross-links** — the RAID "jump to task"/filter affordances on tasks and the RAID-link
  picker inside `change-panel.tsx` are hidden when `raid` is off.
- **Stakeholders/RACI ↔ Milestones** — RACI reads whatever milestone data exists
  (retained) regardless of the milestones module; it just cannot create milestones. No
  hard dependency in either direction. No special handling beyond the producer/consumer
  rules.
- **Chat tools** — task-only today, so always safe (no gating needed now).

## Reports linkage & retention

- The addable-reports picker and the rendered extra reports in `reports.tsx` are filtered
  through `visibleReports(extra, features)` so a disabled module's report neither appears
  in the "add" picker nor renders. The stored `settings.reports.extra` is left untouched —
  re-enabling the module restores prior choices.
- The in-Reports add/remove control remains live (no reload).

## File structure

| File | Change |
|------|--------|
| `feature-modules.ts` (new) | Registry + helpers (`deriveMode`, `isViewEnabled`, `sanitizeFeatures`, `enabledNavViews`, `visibleReports`, `moduleForView`) |
| `feature-modules.test.ts` (new) | Unit tests for all helpers |
| `settings-types.ts` | Add `features` to `Settings` + default = all ids |
| `use-settings.ts` | Merge `sanitizeFeatures(parsed.features)` on load |
| `settings-sections/mode-section.tsx` (new) | Mode section: draft + checkboxes + Save→reload + Discard |
| `settings-sections/mode-section.test.tsx` (new) | Draft/badge/save/discard/dirty tests |
| `settings-view.tsx` | Add `mode` RAIL section + `onCommitFeatures` prop |
| `settings-view.test.tsx` | Section renders / wiring |
| `nav-config.ts` | `filterNavGroups(features)`; `subTabsFor(view, features?)` |
| `nav-config.test.ts` | Filtering tests |
| `sidebar-nav.tsx` / `sidebar.tsx` / `modern-shell.tsx` | Consume filtered nav |
| `workspace-section.tsx` | Gate classic tab strip + sub-tabs + dashboard wiring |
| `task-manager.tsx` | Active-view redirect; `onCommitFeatures`; pass flags to dashboard/alerts/gantt/snapshots |
| `use-due-alerts.ts` | Gate RAID-review by `raid` |
| `dashboard-panel.tsx` | Gate tiles/RAGs by module |
| `gantt` (panel) | Gate milestone overlay by `milestones` |
| `change-panel.tsx` | Gate RAID-link picker by `raid` |
| `reports.tsx` | Filter picker + extras via `visibleReports` |
| `i18n.ts` / `i18n.de.ts` | New keys (section title, mode names, presets, save/discard, retention note, version highlight) |
| `version.ts` / `package.json` / `CHANGELOG.md` / `docs/CODEMAPS/*` | Release v0.54.0 "Herbert" |

## i18n keys (EN / DE)

- `settingsSectionMode` — "Mode" / "Modus"
- `modeSimple` / `modeModular` / `modeAdvanced` — "Simple"/"Modular"/"Advanced" ·
  "Einfach"/"Modular"/"Erweitert"
- `modePresetSimple` / `modePresetAdvanced` — preset button labels
- `modeBadgeLabel` — "Current mode" / "Aktueller Modus"
- `modeModulesHeading` — "Functions" / "Funktionen"
- `modeSave` / `modeDiscard` — "Save & reload" / "Speichern & neu laden"; "Discard" / "Verwerfen"
- `modeRetentionNote` — retention note text
- `versionHighlightModes` — release highlight

(Module checkbox labels reuse existing nav keys via `FeatureModule.labelKey`.)

## Testing strategy

TDD per task. Component tests use `lang="en-US"`. Pure-helper tests cover `deriveMode`
boundaries (0 / 1–8 / 9), `sanitizeFeatures` (legacy `undefined` → all, `[]` → empty,
junk filtered), `isViewEnabled` (core always on; child follows parent), `filterNavGroups`
(empty-group drop), and `visibleReports`. The mode-section test stubs
`window.location.reload` and asserts the localStorage merge-write fires with the new
features. Dashboard/alerts/reports gating tested by toggling the relevant flag and
asserting the section is absent. Active-view redirect tested for a disabled `activeTab`.

## Out of scope

- No storage schema change; no migration of workspace entities.
- No per-entity "archive"/delete semantics — disabling only hides + pauses.
- Chat tools remain task-only (no new gating surface needed).
