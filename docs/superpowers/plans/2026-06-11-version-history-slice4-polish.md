# Version History — Slice 4 (Retention, Module, Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the version-history feature: a configurable retention stepper in Settings (min 50, step 10), a `history` feature-module toggle, an immediate "after restore" checkpoint, and a themed label input replacing `window.prompt`.

**Architecture:** Add `versionHistoryRetention` to Settings with a clamping sanitizer; surface it as a numeric stepper. Register `history` as a feature-module so the nav gates on it (in addition to the existing Turso gate). Wire the prune to the setting. Refactor the hook's capture into a shared helper so `restore` can capture the restored workspace immediately (timing-safe). Replace the manual-checkpoint `window.prompt` with an inline themed input.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 4 + RTL, Tailwind (AIPM palette).

**Spec:** `docs/superpowers/specs/2026-06-11-version-history-design.md`. **Branch:** `feat-version-history-slice4` (already created). Do NOT edit `eslint.config.mjs`.

**Scope of THIS slice:** retention setting + stepper UI, `history` feature-module, prune-reads-setting, immediate restore checkpoint, label-input polish, and a final cross-feature review. This completes the feature.

**Verified facts:**
- `Settings` (settings-types.ts:243) + `defaultSettings` (:260): `features: FeatureModuleId[]`, `features: [...ALL_MODULE_IDS]`. Settings are sanitized on read in `use-settings.ts:137` (`features: sanitizeFeatures((parsed as ...).features)`).
- `feature-modules.ts`: `FeatureModuleId` union (:5), `FEATURE_MODULES` array of `{ id, labelKey, views, report? }` (:25), `ALL_MODULE_IDS = FEATURE_MODULES.map(m=>m.id)` (:57), `isViewEnabled(view, features)` returns true for unowned/core views and gates module-owned views by `isModuleEnabled`. Adding `history` as a module makes `isViewEnabled("history", ...)` gate on `isModuleEnabled("history", ...)`.
- `nav-config.ts:129` `TURSO_ONLY_VIEWS = ["history"]`; `filterNavGroups` keeps a view when `isViewEnabled(view, features) && (onTurso || !TURSO_ONLY_VIEWS.includes(view))`. So once `history` is a module, the nav gate is automatically "Turso AND module enabled".
- `task-manager.tsx:574` passes `retention: DEFAULT_VERSION_RETENTION` to `useVersionHistory`. `DEFAULT_VERSION_RETENTION = 50` (version-history.ts).
- The hook `use-version-history.ts` has `writeVersion(trigger, label)` (computes payload via `getPayload()`, no-op guard for auto, summary vs `lastPayload`, append+prune+refresh) and `restore(versionId, selection, label)` (computes `restored`, `applyWorkspace?.(restored)`, `logActivity?.(...)`). `workspaceToJson` is in `./workspace`.
- Number-input precedent: `settings-sections/notifications-section.tsx:54` (`type="number"`, `min`, `onChange` clamps via `Math.max(min, Math.min(max, Math.round(Number(e.target.value) || dflt)))`).
- Feature-module toggles render in `settings-sections/mode-section.tsx`.

---

## Task 1: `versionHistoryRetention` setting + clamping sanitizer

**Files:**
- Modify: `src/app/version-history.ts` (add `sanitizeVersionRetention`)
- Modify: `src/app/settings-types.ts` (Settings field + default)
- Modify: `src/app/use-settings.ts` (sanitize on read)
- Test: `src/app/version-history.test.ts` (create if absent) or an existing settings test

- [ ] **Step 1: Write the failing sanitizer test**

Create `src/app/version-retention.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sanitizeVersionRetention, DEFAULT_VERSION_RETENTION } from "./version-history";

describe("sanitizeVersionRetention", () => {
  it("defaults to 50 for undefined/garbage", () => {
    expect(sanitizeVersionRetention(undefined)).toBe(50);
    expect(sanitizeVersionRetention("x")).toBe(50);
    expect(sanitizeVersionRetention(null)).toBe(50);
    expect(DEFAULT_VERSION_RETENTION).toBe(50);
  });
  it("clamps below the minimum up to 50", () => {
    expect(sanitizeVersionRetention(0)).toBe(50);
    expect(sanitizeVersionRetention(49)).toBe(50);
    expect(sanitizeVersionRetention(-100)).toBe(50);
  });
  it("snaps to the nearest 10", () => {
    expect(sanitizeVersionRetention(63)).toBe(60);
    expect(sanitizeVersionRetention(66)).toBe(70);
    expect(sanitizeVersionRetention(55)).toBe(60); // round half up
  });
  it("caps at 1000", () => {
    expect(sanitizeVersionRetention(9999)).toBe(1000);
    expect(sanitizeVersionRetention(1000)).toBe(1000);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/version-retention.test.ts` → FAIL (no export).

- [ ] **Step 3: Implement `sanitizeVersionRetention` in `version-history.ts`**

```ts
/** Min auto-version retention; the configurable setting cannot go below this. */
export const MIN_VERSION_RETENTION = 50;
export const MAX_VERSION_RETENTION = 1000;
export const VERSION_RETENTION_STEP = 10;

/** Clamp a retention value to [50, 1000] and snap to the nearest 10. Bad input → 50. */
export function sanitizeVersionRetention(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_VERSION_RETENTION;
  const snapped = Math.round(n / VERSION_RETENTION_STEP) * VERSION_RETENTION_STEP;
  return Math.max(MIN_VERSION_RETENTION, Math.min(MAX_VERSION_RETENTION, snapped));
}
```
(`DEFAULT_VERSION_RETENTION` already exists and equals 50; keep it.)

- [ ] **Step 4: Add the Settings field + default**

`settings-types.ts`: in `Settings`, add after `features`:
```ts
  /** Max auto-versions kept per project in version history (Turso). Min 50, step 10. */
  versionHistoryRetention?: number;
```
In `defaultSettings`, add `versionHistoryRetention: 50,`.

`use-settings.ts`: at the read/sanitize site (~line 137, alongside `features: sanitizeFeatures(...)`), add:
```ts
            versionHistoryRetention: sanitizeVersionRetention((parsed as Record<string, unknown>).versionHistoryRetention),
```
Import `sanitizeVersionRetention` from `./version-history`.

- [ ] **Step 5: Run — PASS; tsc; lint; commit**

Run: `npx vitest run src/app/version-retention.test.ts` → PASS. `npx tsc --noEmit` (0). `npm run lint` (0).
```bash
git add src/app/version-history.ts src/app/settings-types.ts src/app/use-settings.ts src/app/version-retention.test.ts
git commit -m "feat: versionHistoryRetention setting + clamping sanitizer (slice 4)"
```

---

## Task 2: Retention stepper UI in the Settings module section

**Files:**
- Modify: `src/app/settings-sections/mode-section.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/settings-sections/mode-section.test.tsx` (extend if present, else a focused render test)

- [ ] **Step 1: i18n keys**

Add to `i18n.ts`:
```ts
  versionRetentionLabel: "Version history: keep",
  versionRetentionHelp: "Maximum automatic versions kept per project (named checkpoints are always kept). Turso backend only.",
  versionRetentionUnit: "versions",
```
Add to `i18n.de.ts`:
```ts
  versionRetentionLabel: "Versionsverlauf: behalten",
  versionRetentionHelp: "Maximale Anzahl automatischer Versionen pro Projekt (benannte Checkpoints bleiben immer erhalten). Nur Turso-Backend.",
  versionRetentionUnit: "Versionen",
```
Verify ASCII quotes in `i18n.de.ts` after editing (`grep -n versionRetentionLabel src/app/i18n.de.ts`).

- [ ] **Step 2: Failing test**

Read `mode-section.tsx` to learn its props (it receives `settings` + an update callback — grep for how it patches settings, e.g. `onChange`/`patch`/`updateSettings`). Add a test that renders `ModeSection` and asserts a `versions` number input exists with `min=50 step=10`, and that changing it calls the update callback with a clamped/snapped value. Model the assertion on the section's real prop API (read a neighboring section test like `mode-section.test.tsx` or `notifications-section`).

- [ ] **Step 3: Implement the stepper in `mode-section.tsx`**

Add (below the feature-module toggles) a numeric stepper bound to `settings.versionHistoryRetention ?? 50`, mirroring `notifications-section.tsx:54` (`type="number" min={50} step={10}`), clamping on change with the imported `sanitizeVersionRetention`:
```tsx
import { sanitizeVersionRetention, MIN_VERSION_RETENTION, MAX_VERSION_RETENTION, VERSION_RETENTION_STEP } from "../version-history";
// ...
<label className="...">
  <span>{t(lang, "versionRetentionLabel")}</span>
  <input
    type="number"
    min={MIN_VERSION_RETENTION}
    max={MAX_VERSION_RETENTION}
    step={VERSION_RETENTION_STEP}
    value={settings.versionHistoryRetention ?? MIN_VERSION_RETENTION}
    onChange={(e) => onChange({ versionHistoryRetention: sanitizeVersionRetention(e.target.value) })}
    className="..."
  />
  <span className="text-xs text-muted-foreground">{t(lang, "versionRetentionUnit")}</span>
</label>
<p className="text-xs text-muted-foreground">{t(lang, "versionRetentionHelp")}</p>
```
Use the section's ACTUAL settings-update callback name + the existing input/label classes from `notifications-section.tsx`. (If the section's update API replaces the whole settings object, spread: `onChange({ ...settings, versionHistoryRetention: ... })` — match the real signature.)

- [ ] **Step 4: Run — PASS; tsc; lint; commit**

Run: `npx vitest run src/app/settings-sections/mode-section.test.tsx` → PASS. `npx tsc --noEmit` (0). `npm run lint` (0).
```bash
git add src/app/settings-sections/mode-section.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/settings-sections/mode-section.test.tsx
git commit -m "feat: version-history retention stepper in Settings (slice 4)"
```

---

## Task 3: `history` feature-module

**Files:**
- Modify: `src/app/feature-modules.ts`
- Test: `src/app/feature-modules.test.ts` (extend if present)

- [ ] **Step 1: Failing test**

Add to the feature-modules test (grep an existing one to match style):
```ts
it("registers a 'history' module gating the history view", () => {
  expect(ALL_MODULE_IDS).toContain("history");
  expect(isViewEnabled("history", [])).toBe(false);           // module off → view hidden
  expect(isViewEnabled("history", ["history"])).toBe(true);    // module on → view shown
});
```
(Import `ALL_MODULE_IDS`, `isViewEnabled` as the existing tests do.)

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/feature-modules.test.ts` → FAIL (history not a module / isViewEnabled returns true for unowned view).

- [ ] **Step 3: Implement**

`feature-modules.ts`: add `| "history"` to `FeatureModuleId`; add to `FEATURE_MODULES` (after `trends` or at the end):
```ts
  { id: "history", labelKey: "navHistory", views: ["history"] },
```
`navHistory` already exists as a TranslationKey (Slice 1). `ALL_MODULE_IDS` and `defaultSettings.features = [...ALL_MODULE_IDS]` now include `history` (default ON). `sanitizeFeatures(undefined)` → all (legacy default-on). The nav `filterNavGroups` now gates `history` on `isViewEnabled` (module) AND `TURSO_ONLY_VIEWS` (Turso) automatically — no nav-config change needed.

- [ ] **Step 4: Run — PASS; tsc; lint; commit**

Run: `npx vitest run src/app/feature-modules.test.ts src/app/nav-config.test.ts` → PASS (confirm nav tests still green). `npx tsc --noEmit` (0). `npm run lint` (0).
```bash
git add src/app/feature-modules.ts src/app/feature-modules.test.ts
git commit -m "feat: history feature-module (gates the History view) (slice 4)"
```

---

## Task 4: Prune reads the retention setting

**Files:**
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Rewire**

In `task-manager.tsx:574`, change:
```ts
    retention: DEFAULT_VERSION_RETENTION,
```
to:
```ts
    retention: settings.versionHistoryRetention ?? DEFAULT_VERSION_RETENTION,
```
(Keep the `DEFAULT_VERSION_RETENTION` import as the fallback.)

- [ ] **Step 2: Gates + commit**

Run: `npx tsc --noEmit` (0), `npm run lint` (0), `npx vitest run src/app/task-manager.test.tsx` (if present; else `npx vitest run src/app` broad). All green.
```bash
git add src/app/task-manager.tsx
git commit -m "feat: version-history prune honors the retention setting (slice 4)"
```

---

## Task 5: Immediate "after restore" checkpoint

**Files:**
- Modify: `src/app/use-version-history.ts`
- Test: `src/app/use-version-history.test.tsx` (extend)

- [ ] **Step 1: Failing test**

```tsx
it("captures an immediate version of the restored state (no stale getPayload)", async () => {
  const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
    grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
  const version = JSON.stringify({ tasks: [{ id: 1, title: "Old" }], ...base });
  vi.spyOn(store, "loadVersionPayload").mockResolvedValue(version);
  vi.spyOn(store, "pruneVersions").mockResolvedValue();
  vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
  const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
  const now = JSON.stringify({ tasks: [{ id: 1, title: "New" }], ...base });
  const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => now, applyWorkspace: vi.fn(), logActivity: vi.fn() })));
  await act(async () => { await result.current.restore("v1", { "tasks:1": ["title"] }, "Baseline"); });
  // an immediate version was appended capturing the RESTORED state (title back to "Old")
  expect(append).toHaveBeenCalledTimes(1);
  const captured = JSON.parse(append.mock.calls[0][1].payload);
  expect(captured.tasks[0].title).toBe("Old");
});
```

- [ ] **Step 2: Run — expect FAIL** (restore currently appends nothing).

Run: `npx vitest run src/app/use-version-history.test.tsx` → the new test FAILS.

- [ ] **Step 3: Refactor capture + capture restored payload immediately**

In `use-version-history.ts`: import `workspaceToJson` from `./workspace` (jsonToWorkspace already imported). Extract the append-from-an-explicit-payload core so both `writeVersion` and `restore` use it. Add:
```ts
  const capturePayload = useCallback(async (payload: string, trigger: "auto" | "manual", label: string | null) => {
    if (!active) return;
    let summary: string | null = null;
    const prev = lastPayload.current;
    if (prev && prev !== payload) {
      try { summary = summarizeDiff(diffWorkspaces(jsonToWorkspace(prev), jsonToWorkspace(payload))) || null; }
      catch { summary = null; }
    }
    const capturedAt = new Date().toISOString();
    counter.current += 1;
    const v: ProjectVersion = { id: `${capturedAt}-${counter.current}`, projectId, capturedAt, trigger, label, summary, payload };
    setBusy(true);
    try {
      await appendVersion(config, v, projectId);
      lastPayload.current = payload;
      await pruneVersions(config, projectId, retention);
      await refresh();
    } catch (err) { onError?.(err); }
    finally { setBusy(false); }
  }, [active, config, projectId, retention, refresh, onError]);
```
Rewrite `writeVersion` to delegate (keeping its auto no-op guard):
```ts
  const writeVersion = useCallback(async (trigger: "auto" | "manual", label: string | null) => {
    if (!active) return;
    const payload = getPayload();
    if (trigger === "auto" && payload === lastPayload.current) return;
    await capturePayload(payload, trigger, label);
  }, [active, getPayload, capturePayload]);
```
In `restore`, after computing `restored` and BEFORE `applyWorkspace?.(restored)`, capture the restored payload immediately (timing-safe — uses the computed workspace, not the stale `getPayload`):
```ts
      const restored = applyRestore(now, version, changes, selection);
      await capturePayload(workspaceToJson(restored), "auto", null); // immediate "after restore" version; sets lastPayload
      applyWorkspace?.(restored);
      logActivity?.("history.restore", count, versionLabel);
```
Because `capturePayload` sets `lastPayload.current` to the restored payload, the autosave-triggered idle auto-capture later sees an unchanged payload and no-ops — no duplicate version.

- [ ] **Step 4: Run — PASS; tsc; lint; commit**

Run: `npx vitest run src/app/use-version-history.test.tsx` → PASS (all, incl. the existing capture/summary/restore tests — verify none regressed). `npx tsc --noEmit` (0). `npm run lint` (0).
```bash
git add src/app/use-version-history.ts src/app/use-version-history.test.tsx
git commit -m "feat: immediate after-restore version checkpoint (slice 4)"
```

---

## Task 6: Replace `window.prompt` with an inline label input

**Files:**
- Modify: `src/app/history-panel.tsx`
- Test: `src/app/history-panel.test.tsx` (update the prompt test)

- [ ] **Step 1: Update the failing test**

Replace the existing `window.prompt`-based "calls onCaptureNow with the entered label" test with an inline-input flow:
```tsx
it("captures a named checkpoint via the inline input", () => {
  const onCaptureNow = vi.fn();
  render(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={onCaptureNow} loadDiff={vi.fn().mockResolvedValue([])} restore={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByRole("button", { name: "Save version now" }));
  const input = screen.getByPlaceholderText("Name this version"); // historyManualLabelPrompt
  fireEvent.change(input, { target: { value: "My checkpoint" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" })); // confirm
  expect(onCaptureNow).toHaveBeenCalledWith("My checkpoint");
});
```
(Reuse the existing `historyManualLabelPrompt` = "Name this version" as the placeholder; add a generic confirm-button key if needed — check if a `save`/`add` key exists, e.g. `t(lang,"add")` or `t(lang,"save")`; grep i18n. Match the test's button name to what you render.)

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/history-panel.test.tsx` → the updated test FAILS (still using prompt).

- [ ] **Step 3: Implement inline naming input**

In `history-panel.tsx`: replace the `window.prompt` in `handleSave` with a `naming` boolean state + a `draftLabel` string state. Clicking "Save version now" sets `naming = true` and reveals an inline input + a confirm button (and a cancel ×). Confirm calls `onCaptureNow(draftLabel.trim())` when non-empty, then resets `naming`/`draftLabel`. Use the existing dark-blue button styling for confirm; AIPM palette. Keep it small (inline, not a full modal). Remove the `window.prompt` call entirely.

- [ ] **Step 4: Run — PASS; tsc; lint; commit**

Run: `npx vitest run src/app/history-panel.test.tsx` → PASS. `npx tsc --noEmit` (0). `npm run lint` (0).
```bash
git add src/app/history-panel.tsx src/app/history-panel.test.tsx
git commit -m "feat: inline label input for manual checkpoints (replaces window.prompt) (slice 4)"
```

---

## Task 7: Final cross-feature review + Release 0.69.0 "Simmons"

**Files:** `package.json`, `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: Broad gates**

Run: `npm run lint` (0), `npx tsc --noEmit` (0), `npx vitest run` (full suite green — report counts; golden fixtures unchanged), `npm run build` (succeeds).

- [ ] **Step 2: Version bump**

`package.json`: `0.68.0` → `0.69.0`. `src/app/version.ts`: `APP_VERSION = "0.69.0"`, update `APP_BUILD_DATE` comment, `APP_MILESTONE = "Simmons"` (Dan Simmons), update the codename JSDoc to the 0.69.x line "Simmons".

- [ ] **Step 3: CHANGELOG entry**

Prepend above `## [0.68.0]`:
```markdown
## [0.69.0] - 2026-06-11 "Simmons"

Version history — retention, module toggle & polish (Turso only; final slice).

### Added
- A configurable retention setting (Settings → keep N versions; minimum 50, in
  steps of 10) controls how many automatic versions are kept per project; named
  checkpoints are always kept.
- Version history is now a toggleable feature-module — turn the History view on
  or off like the other modules (it still requires the Turso backend).

### Changed
- Restoring now records an immediate version checkpoint of the restored state
  (no waiting for the next autosave).
- Naming a manual checkpoint uses an inline themed input instead of a browser
  prompt.
```

- [ ] **Step 4: Commit**

```bash
git add package.json src/app/version.ts CHANGELOG.md
git commit -m "chore: release 0.69.0 \"Simmons\" — version-history retention, module & polish (slice 4)"
```

---

## Final verification

- [ ] `npx tsc --noEmit` clean; `npm run lint` clean; full `npx vitest run` green; `npm run build` succeeds; golden fixtures unchanged.
- [ ] Manual (mental trace, Turso): Settings shows a "keep N versions" stepper (min 50, step 10) → lowering it prunes on the next capture; toggling the History module off hides the nav entry; a restore immediately adds a version row; "Save version now" reveals an inline input (no browser prompt).

## Notes / landmines

- `history` becomes a feature-module → `defaultSettings.features` (`[...ALL_MODULE_IDS]`) and `sanitizeFeatures(undefined)` include it, so existing users keep History ON by default. The nav gate is now "Turso AND module enabled" automatically via `isViewEnabled` + `TURSO_ONLY_VIEWS` — do NOT add a separate module check in nav-config.
- The immediate restore checkpoint MUST use `workspaceToJson(restored)` (the computed workspace), NOT `getPayload()` — `getPayload` still closes over pre-render (pre-restore) state at that moment. Setting `lastPayload` to the restored payload makes the later idle auto-capture a no-op (no duplicate).
- Retention sanitizer snaps to 10 and clamps [50,1000]; the prune reads the live setting each capture, so lowering N prunes on the NEXT capture (not retroactively on save).
- `i18n.de.ts` quote-corruption: verify after editing.
- No Turso schema change; golden fixtures untouched.
