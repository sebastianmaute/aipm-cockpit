# Per-Project Setting Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project carry its own values for next-actions ranking, notifications, timezone display, and appearance/view — overriding the per-device defaults — with the AI reasoning over the effective per-project config.

**Architecture:** Split storage. **Policy** overrides (nextActions/notifications/timezone) live in a new storage-only `Workspace.settingsOverrides` blob mirroring `steeringCommittee` across all 6 write paths (travels with the project, excluded from user export). **Appearance/view** overrides live in a per-device-per-project local store `project-appearance-prefs.ts` (mirrors `landing-state`, never travels). A pure `resolveEffectiveSettings(device, policy, appearance)` merges them; every overridable-setting consumer + the AI snapshot reads the effective value. UI: a "This project" settings rail with four per-group override toggles that reuse the existing section components.

**Tech Stack:** Next.js 16 / React 19 / TypeScript 5 / Tailwind v4 / Vitest 4. Follow `AGENTS.md`. Reference siblings: `steeringCommittee` (blob 6-path), `landing-state.ts` (per-device-per-project store), `document-link.ts` + `knowledge-items-persistence.test.ts` (the just-landed knowledge feature — same blob + save-wiring lesson), `NEXT_ACTIONS_FIELD_COERCE` (settings-types.ts).

**Conventions:** TDD (RED→GREEN→refactor). Commit after each task. Run `npx tsc --noEmit` after any `.ts`/`.tsx` edit and after ANY test edit (test-only type errors fail CI, not vitest). i18n.de.ts must be patched via a node UTF-8 write (Edit corrupts it); keep EN/DE key parity (tsc-enforced). Empty override blob MUST stay byte-stable (golden fixtures unchanged) — verify with `npx vitest run src/app/golden-workspace.test.ts` after codec work.

---

## Phase 1 — Policy overrides model + sanitizer (no persistence yet)

### Task 1.1: `SettingsOverrides` type

**Files:**
- Modify: `src/app/settings-types.ts` (export the shape near `NextActionsConfig`)
- Modify: `src/app/workspace.ts` (add the optional `Workspace` field + import)

- [ ] **Step 1: Add the type** to `settings-types.ts`:

```ts
/** Per-project POLICY overrides that travel WITH the project (storage-only blob,
 *  excluded from user exports). Each sub-object is a PARTIAL of the corresponding
 *  device-settings shape; an absent sub-key means "no override for that group". */
export interface SettingsOverrides {
  nextActions?: Partial<NextActionsConfig>;
  notifications?: Partial<NotificationSettings>; // use the ACTUAL notifications type name in settings-types
  timezone?: { timezone?: string; additionalTimezones?: string[] };
}
```
Before writing, grep `settings-types.ts` for the real notification settings type name (e.g. `NotificationSettings`/`NotificationConfig`) and use it verbatim.

- [ ] **Step 2: Add the Workspace field** in `workspace.ts` after `timelogLinks?`:

```ts
/** Per-project policy overrides (next-actions/notifications/timezone). Optional
 *  & additive: undefined/empty serializes to nothing (byte-stable). */
settingsOverrides?: Readonly<SettingsOverrides>;
```
Import `SettingsOverrides` from `./settings-types`.

- [ ] **Step 3:** `npx tsc --noEmit` → expect 0. Commit `feat: SettingsOverrides type + Workspace field`.

### Task 1.2: `sanitizeSettingsOverrides`

**Files:**
- Create: `src/app/settings-overrides.ts`
- Test: `src/app/settings-overrides.test.ts`

- [ ] **Step 1: Failing test** (`settings-overrides.test.ts`): a garbage input → `{}`-ish (all sub-keys dropped); a valid nextActions partial with an out-of-bounds weight → clamped via the existing coercer; an invalid timezone string dropped via `isValidTimeZone`; a valid partial round-trips. Assert `sanitizeSettingsOverrides` NEVER throws (fuzz a few junk shapes).

- [ ] **Step 2:** Run → FAIL (module missing).

- [ ] **Step 3: Implement** `settings-overrides.ts`:
  - `sanitizeSettingsOverrides(raw: unknown): SettingsOverrides` — object-guard; for `nextActions` run each provided key through `NEXT_ACTIONS_FIELD_COERCE[key](v, defaultNextActionsConfig[key])` (drop unknown keys); for `notifications` reuse the existing notifications sanitizer (partial-aware — only keep provided valid fields); for `timezone` validate via `isValidTimeZone` (from `timezone.ts`) and cap/validate `additionalTimezones`. Emit a sub-key ONLY when it has ≥1 valid field (so empty stays byte-minimal). Return `{}` when nothing valid.
  - Also export `hasAnyOverride(o?: SettingsOverrides): boolean` (true if any sub-key present) — used by the serializers' emptiness gate.

- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit` → 0. Commit `feat: sanitizeSettingsOverrides`.

### Task 1.3: JSON round-trip

**Files:** Modify `src/app/workspace.ts`. Test: extend `settings-overrides.test.ts` (or a new `settings-overrides-persistence.test.ts` — create it now, JSON only, extend later).

- [ ] **Step 1: Failing test** (`settings-overrides-persistence.test.ts`, mirror `knowledge-items-persistence.test.ts`): `wsWithOverrides()` → `jsonToWorkspace(workspaceToJson(ws))` preserves `settingsOverrides`; an override-less workspace's JSON does NOT contain `"settingsOverrides"`.

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** in `workspace.ts`: add `...(hasAnyOverride(ws.settingsOverrides) ? { settingsOverrides: ws.settingsOverrides } : {})` in `workspaceToJson` (next to `timelogLinks`); in `jsonToWorkspace` add `if (p.settingsOverrides !== undefined) { const o = sanitizeSettingsOverrides(p.settingsOverrides); if (hasAnyOverride(o)) raw.settingsOverrides = o; }`.

- [ ] **Step 4:** Run → PASS. tsc 0. Commit `feat: settingsOverrides JSON round-trip`.

## Phase 2 — Policy overrides: remaining 5 storage paths

> Each task mirrors the `timelogLinks`/`steeringCommittee` sibling EXACTLY with renamed identifiers. After the whole phase, run `golden-workspace.test.ts` to confirm byte-stability.

### Task 2.1: CSV
**Files:** `csv-codecs-core.ts` (const), `csv-codecs-config.ts` (encoder + emit), `csv-codecs-decode.ts` (splitter + assembler). Test: extend persistence test with CSV.
- [ ] Add `CSV_SECTION_SETTINGS_OVERRIDES = "# SETTINGS OVERRIDES"` (core), `settingsOverridesToCsv`/`csvToSettingsOverrides` (config, JSON-in-`config,<json>` row like `timelogLinksToCsv`), emit `if (config === undefined && hasAnyOverride(ws.settingsOverrides)) csvPush(...)` (storage-only). Decode: add the mode to the splitter union + buffer + marker + collect + return field, and assemble in `csvToWorkspace`. Follow the knowledge/ timelog edits in `csv-codecs-decode.ts` line-for-line. Extend the persistence test (CSV round-trip + no `# SETTINGS OVERRIDES` when empty). RED→GREEN→commit.

### Task 2.2: Markdown
**Files:** `markdown-codecs-core.ts` (encoder `settingsOverridesToMarkdown` `## Settings Overrides` fenced JSON + emit, storage-only) + `markdown-codecs-decode.ts` (`markdownToSettingsOverrides` + assembler). Extend persistence test (MD). RED→GREEN→commit.

### Task 2.3: Turso single + tenant
**Files:** `turso-schema.ts` (read `settings_overrides` meta row + dirty-track `if (prev.settingsOverrides !== next.settingsOverrides) dirty.add("meta")` + write inside the meta gate, gated on `hasAnyOverride`), `turso-tenant-schema.ts` (tenant meta write; read reuses `rowsToWorkspace`). Mirror the `knowledge_items` edits exactly. tsc + existing turso schema tests. Commit.

### Task 2.4: IndexedDB
**Files:** `browser-backend.ts` — `KV_SETTINGS_OVERRIDES_KEY = "settingsOverrides"`, add to the parallel read + destructure, sanitize (`hasAnyOverride ? o : undefined`), assign to `raw`, and delete-on-absent write. Mirror `knowledgeItems`. Existing `browser-backend.test.ts` green. Commit.

### Task 2.5: version-diff + registry guard
- [ ] `version-diff.ts`: add `{ key: "settingsOverrides", label: "Project overrides", kind: "singleton" }`.
- [ ] Add a row to `entity-persistence-registry.test.ts` for `settingsOverrides`.
- [ ] Run `npx vitest run src/app/golden-workspace.test.ts` → PASS (empty override ⇒ byte-stable; NO golden regen). If it fails, the emptiness gate is wrong — fix, do not regen. Commit.

## Phase 3 — App save/load wiring (the knowledge-items lesson)

**Files:** `workspace-context.tsx`, `task-manager.tsx`, `use-storage-backend.ts`.

- [ ] **3.1** `workspace-context.tsx`: add `settingsOverrides`/`setSettingsOverrides` to the interface, `useState`, the memo value, and the memo deps array (mirror `timelogLinks`). Import `SettingsOverrides`.
- [ ] **3.2** `task-manager.tsx`: destructure `setSettingsOverrides`; call `setSettingsOverrides(w.settingsOverrides)` in the restore effect; add `setSettingsOverrides` to that effect's deps.
- [ ] **3.3** `use-storage-backend.ts`: destructure `settingsOverrides, setSettingsOverrides` from `useWorkspace()`; `setSettingsOverrides(workspace.settingsOverrides)` in `applyWorkspace`; **add `settingsOverrides` to the 3 `backend.save({…})` literals + `currentWorkspace()` AND to the autosave effect's deps array (~line 359).** ★ This dep is the F1-HIGH lesson from the knowledge review — without it a policy-only edit is lost on reload.
- [ ] tsc 0. Add/extend a test proving a `setSettingsOverrides`-only change is included in the saved workspace if feasible (else rely on the dep + literal). Commit `feat: settingsOverrides save/load wiring`.

## Phase 4 — Per-device appearance store + effective resolver

### Task 4.1: `project-appearance-prefs.ts`
**Files:** Create `src/app/project-appearance-prefs.ts` (+ `.test.ts`) on `device-store.ts`.
- [ ] RED test: `loadProjectAppearance(id)` → `{}` when absent; `saveProjectAppearance(id, pref)` round-trips; junk load → `{}`; cap at 50 projects (oldest dropped); invalid enum values dropped.
- [ ] Implement using `readDeviceJson`/`writeDeviceJson` (key `aipm-cockpit:project-appearance`), `ProjectAppearanceMap`/`ProjectAppearancePref` types, validated + capped like `landing-state.ts`. GREEN. Commit.

### Task 4.2: `resolveEffectiveSettings`
**Files:** Create `src/app/settings-effective.ts` (+ `.test.ts`).
- [ ] RED test — precedence matrix: device-only (identity), policy nextActions partial merges onto device (only overridden fields change), notifications partial merge, timezone whole-replace, appearance whole-replace per field, both sources present, immutability (device object unchanged).
- [ ] Implement `resolveEffectiveSettings(device: Settings, policy: SettingsOverrides | undefined, appearance: ProjectAppearancePref | undefined): Settings` — spread device, merge `nextActions`/`notifications` partials (`{...device.nextActions, ...policy.nextActions}`), replace `timezone`/`additionalTimezones` when set, replace each appearance field when set. Pure, returns new object. GREEN. tsc 0. Commit.

### Task 4.3: `useEffectiveSettings` hook
**Files:** Create `src/app/use-effective-settings.ts`.
- [ ] `useEffectiveSettings(): Settings` = `resolveEffectiveSettings(useSettings().settings, useWorkspace().settingsOverrides, loadProjectAppearance(currentProjectId))`. Get `currentProjectId` the same way workspace-section derives it for landing-state. Memoize on the inputs. (No test — thin glue; covered via consumers.) tsc 0. Commit.

## Phase 5 — Route effective config into consumers (incl. AI)

> One task per consumer. Each: swap the raw `settings.<field>` read for the effective value, keep behavior identical when no override exists (regression tests already cover the no-override path). Commit per consumer.

- [ ] **5.1 AI snapshot** — `use-chat-dispatcher.ts` `getSnapshot()` (+ any `buildActionInput`/AI context) reads effective `nextActions`/timezone/etc. so the assistant is aware. Verify `chat-tools.test.ts` still green.
- [ ] **5.2 Next-actions** — the `resolveNextActionsConfig(settings.nextActions)` call sites (dashboard, task-manager `buildActionInput`, next-actions settings) read effective.
- [ ] **5.3 Notifications/reminders** — reminder lead-time + channel + RAID-review-interval reads use effective.
- [ ] **5.4 Timezone** — `resolveTimezone(effective.timezone, project.operatingTimezone)` at the central `todayISO`/display sites + world-clock + display switcher.
- [ ] **5.5 Appearance** — density (dashboard), `showViewHints`, `tasksViewMode` read effective; theme (`use-theme`) + active scheme (`use-style`) apply the per-project appearance pref on project load (device default when absent). ★ Phase this: do density/hints/tasksViewMode first (trivial); theme/scheme LAST (they apply one frame post-load — documented, acceptable). If the settle-frame is undesirable, drop theme/scheme per the spec's phasing note.
- [ ] After each: `npx tsc --noEmit` + the relevant suite. Full `npm run test:run` at the end of Phase 5.

## Phase 6 — "This project" settings UI

**Files:** Create `src/app/settings-sections/project-overrides-section.tsx` (+ `.test.tsx`); modify `settings-view.tsx` (rail entry + `SectionId`), i18n EN/DE.

- [ ] **6.1** Add `SectionId` `"projectOverrides"` + rail entry "This project" in `settings-view.tsx` (hidden in popout / when no project). i18n key `settingsProjectOverrides` EN+DE (node write for DE).
- [ ] **6.2** RED test (`project-overrides-section.test.tsx`): rendering with no overrides shows 4 groups each "Use device default"; toggling a group ON seeds from the effective value and reveals its controls; toggling OFF clears; a policy toggle calls `setSettingsOverrides`, an appearance toggle calls `saveProjectAppearance`.
- [ ] **6.3** Implement `ProjectOverridesSection`: four rows, each a `SegmentedControl`("Use device default"|"Override for this project") + an "Overridden" badge; ON renders the EXISTING section component (`NextActionsSection` / notifications section / timezone section / `AppearanceSection`) fed the override value + an onChange writing to the right store; OFF clears. `ariaLabel`s on the toggles (Settings is axe-scanned). New i18n keys EN+DE (node for DE). GREEN. tsc 0.
- [ ] **6.4** `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"` → PASS (new toggles labeled). Commit.

## Phase 7 — Release scaffolding (only on explicit "release")

- [ ] Bump `version.ts` + `APP_HIGHLIGHT_KEYS` (`versionHighlightProjectOverrides`) + EN/DE strings; `package.json`; `CHANGELOG.md`; `AGENTS.md` architecture bullet (new `settingsOverrides` field + the split-storage model + effective-config resolver). Full gate: tsc · lint · `npm run test:run` · `size:check` · `dup:check` · axe Settings. Superpowers code review. THEN (on "release") push→MR→merge-on-green.

## Self-review notes
- Every policy-blob task mirrors a NAMED sibling (`timelogLinks`/`knowledgeItems`) — the implementer copies that function with the renamed identifiers listed here.
- The single highest-risk line is the **autosave-effect dep in Phase 3.3** — call it out in review.
- Byte-stability gate (`golden-workspace.test.ts`) is the guard that the emptiness gate is correct; never regen golden to make it pass.
