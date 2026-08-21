# Per-Project Setting Overrides — Design

**Status:** approved (2026-07-19). Feature #6A of the "per-project overrides / insights→action loop" pair; #6B (insights→action loop) is a separate later spec.

**Goal:** let a project carry its own values for selected settings that are otherwise per-device, so different engagements can run different policy without re-configuring the app, and the AI reasons over the *effective* per-project config.

## Scope — four overridable groups

| Group | Settings covered | Nature |
|-------|------------------|--------|
| Next-actions ranking | `settings.nextActions` (the `NextActionsConfig` weights + thresholds) | policy (travels) |
| Notifications & reminders | `settings.notifications` (lead times, per-channel banner/toast/popup flags, RAID-review interval) | policy (travels) |
| Timezone display | `settings.timezone` (display override) + `settings.additionalTimezones` | policy (travels) |
| Appearance & view | `dashboardDensity`, theme (`aipm-cockpit-theme`), active scheme id, `showViewHints`, `tasksViewMode` | ergonomic (per-device-per-project) |

Already per-project (NOT in scope, untouched): feature modules, PM mode (derived), `ProjectMeta.operatingTimezone`.

## Storage — split by nature

### 1. Policy overrides — travel WITH the project
New optional workspace-level field:

```ts
// types/workspace shape
interface SettingsOverrides {
  nextActions?: Partial<NextActionsConfig>;
  notifications?: Partial<NotificationSettings>;
  timezone?: { timezone?: string; additionalTimezones?: string[] };
}
// Workspace
settingsOverrides?: Readonly<SettingsOverrides>;
```

- **Persistence mirrors `steeringCommittee` EXACTLY** (the storage-only config-blob pattern): all SIX write paths —
  - JSON: additive key in `workspaceToJson` / sanitize in `jsonToWorkspace` (`workspace.ts`), length/emptiness-gated so absent stays byte-identical.
  - CSV: `CSV_SECTION_SETTINGS_OVERRIDES = "# SETTINGS OVERRIDES"` (`csv-codecs-core.ts`) + `settingsOverridesToCsv`/`csvToSettingsOverrides` (`csv-codecs-config.ts`/`-decode.ts`), emitted **only on the storage path** (`config === undefined && ws.settingsOverrides`).
  - MD: `## Settings Overrides` fenced-JSON block (`markdown-codecs-core.ts` encode + `-decode.ts` assembler), same storage-only gate.
  - Turso single + tenant: `meta` row keyed `settings_overrides` (read in `rowsToWorkspace`, dirty-track in `dirtyWorkspaceTables`, write in both schema writers).
  - IndexedDB: KV key `settingsOverrides` in `browser-backend.ts` (parallel read + delete-on-absent write).
  - App save/load wiring: `workspace-context` value+setter (`settingsOverrides`/`setSettingsOverrides`), set on load in `use-storage-backend.applyWorkspace` + task-manager restore, **and included in the 3 `backend.save({…})` literals + `currentWorkspace()` + the autosave-effect DEPS array** (the knowledge-items lesson: literal-inclusion + a matching dep, or it silently drops on reload).
- **Excluded from user exports** (config, like steering/timelog): the export codecs' `config`-gated path never emits it.
- `sanitizeSettingsOverrides(raw)` — never throws; each sub-object validated by the EXISTING validators (`resolveNextActionsConfig` field coercers for nextActions; the notifications sanitizer; `isValidTimeZone` for tz). Absent/empty sub-keys dropped so an empty override is byte-minimal.
- `version-diff.ts`: one `{ key: "settingsOverrides", kind: "singleton" }` entry.
- **guarded by `entity-persistence-registry.test.ts` + a new `settings-overrides-persistence.test.ts`.**

### 2. Appearance/view overrides — per-device-per-project (local only)
New store `project-appearance-prefs.ts` on `device-store.ts` (the shared SSR-guarded JSON envelope):

```ts
// key "aipm-cockpit:project-appearance"
type ProjectAppearanceMap = { [projectId: string]: ProjectAppearancePref };
interface ProjectAppearancePref {
  dashboardDensity?: "comfortable" | "compact";
  theme?: "light" | "dark" | "system";
  activeSchemeId?: string;
  showViewHints?: boolean;
  tasksViewMode?: "table" | "board";
}
```
- Capped (~50 most-recent projects, mirror `landing-state`). OUT of exports/Turso. Swept by `clearAppConfig`'s `aipm-cockpit:*` sweep. Validated on load.
- Keyed off the current `projectId` (`?? "default"`), same source workspace-section uses for landing-state.

## Resolution — the core

Pure `settings-effective.ts`:
```ts
resolveEffectiveSettings(
  device: Settings,
  policy: SettingsOverrides | undefined,
  appearance: ProjectAppearancePref | undefined,
): Settings
```
Precedence: **override value ?? device value**, per field. `nextActions`/`notifications` merge the partial onto the device object (so a partial override only replaces the fields it sets); `timezone`/`additionalTimezones` and each appearance field are whole-value replace. Returns a new `Settings` (immutable).

Hook `use-effective-settings.ts` `useEffectiveSettings()` = `resolveEffectiveSettings(useSettings().settings, ws.settingsOverrides, loadProjectAppearance(projectId))`. **Every consumer of an overridable setting reads the effective value:**
- Next-actions input builder (`buildActionInput` / `resolveNextActionsConfig` call sites)
- Notifications/reminders engine (lead-time + channel + RAID-review-interval reads)
- Timezone: `resolveTimezone(effective.timezone, project.operatingTimezone)` + the display switcher + calendar world-clock
- Appearance: density (dashboard), theme (`use-theme`), active scheme (`use-style`/`use-color-schemes`), `showViewHints`, `tasksViewMode`
- **AI snapshot** (`get_app_state` / `use-chat-dispatcher` getSnapshot + any AI context builder) → so the assistant is aware of the effective per-project config.

Theme/scheme are special: they are applied via boot keys + `use-theme`/`use-style`, not the settings blob. The per-project appearance pref, when present, drives those hooks on project load (a project switch re-applies the project's theme/scheme, else the device default). Boot-paint stays the device default (pre-project); the project pref applies on mount after the workspace + projectId are known (documented one-frame settle, acceptable).

## UX — "This project" settings area

New `settings-sections/project-overrides-section.tsx`, a rail entry "This project" (only meaningful with a loaded project; hidden in pop-outs). Four rows, one per group:
- A `SegmentedControl`/toggle "Use device default | Override for this project".
- ON → seed the override from the current EFFECTIVE value (so nothing visibly changes) and reveal that group's EXISTING section component (reuse `NextActionsSection`, the notifications section, the timezone section, `AppearanceSection`), fed the override value + an onChange that writes to the correct store (policy → `setSettingsOverrides`; appearance → `saveProjectAppearance`). An "Overridden" badge.
- OFF → clear that group's override (delete the sub-key / appearance field) → reverts to device.
- Settings is axe-scanned → the toggles carry `ariaLabel`s; reused sections keep their a11y.

## Edge cases
- Project switch: effective recomputes — policy from the newly-loaded `ws.settingsOverrides`, appearance from the local map keyed by the new projectId.
- File-mode default / no project: `projectId = "default"`; overrides still function.
- Empty override blob → emits nothing (byte-stable), no golden regen.
- `update_settings` AI tool: unchanged — still writes DEVICE settings. Writing project overrides from the AI is explicitly OUT of scope for #6A.
- Popout: read-only mirror — no "This project" section; consumers read effective (device + travelled policy) but don't write.

## Out of scope (this spec)
- #6B insights→action loop (separate spec).
- AI writing project overrides.
- Per-field (vs per-group) override granularity.
- Migrating existing per-device settings into project overrides.

## Testing
- `settings-effective.test.ts` — precedence matrix (device only / policy override / appearance override / both), partial-merge for nextActions+notifications, immutability.
- `settings-overrides-persistence.test.ts` — round-trip across JSON/CSV/MD (+ byte-stable empty), mirror of `knowledge-items-persistence.test.ts`; entity-persistence-registry row.
- `project-appearance-prefs.test.ts` — load/save/cap/validate.
- `project-overrides-section.test.tsx` — toggle on seeds from effective + reveals controls; toggle off clears; writes hit the right store.

## File-touch summary
New: `settings-effective.ts` (+test), `project-appearance-prefs.ts` (+test), `use-effective-settings.ts`, `settings-sections/project-overrides-section.tsx` (+test), `settings-overrides-persistence.test.ts`, `sanitizeSettingsOverrides` (in `sanitize-*`).
Modified: `types.ts`/`workspace.ts` (field+shape), the 6 codec/backend paths, `workspace-context.tsx`, `task-manager.tsx`, `use-storage-backend.ts`, `version-diff.ts`, `settings-view.tsx` (rail entry), and every effective-config consumer listed above (next-actions, notifications, timezone, appearance hooks, AI snapshot).
