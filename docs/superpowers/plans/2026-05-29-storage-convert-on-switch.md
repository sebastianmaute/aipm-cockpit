# Convert-and-Write on Storage-Format Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Changing the storage format converts the current in-memory workspace to that format and writes it to the new backend (after a confirm), then switches — instead of loading from the new backend and replacing the live data.

**Architecture:** A new `onRequestStorageSwitch(newKind)` orchestrator in `use-storage-backend.ts` (confirm → ensure target writable → `newBackend.save(currentWorkspace)` → suppress the next auto-load → commit `storageConfig`), plus a `suppressNextLoadRef` guard on the existing load effect. The Storage `<select>` calls this instead of committing config directly; it stays controlled by `config.kind` so cancel/abort reverts. No backend internals change; startup load unchanged.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Vitest.

**Spec:** `docs/superpowers/specs/2026-05-29-storage-convert-on-switch-design.md`

**Branch:** `feat/0.27.0-storage-convert-switch` (already created & checked out).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/app/use-storage-backend.ts` | Add `suppressNextLoadRef` + load-effect guard; add `onRequestStorageSwitch(newKind)`; accept a `setStorageConfig` arg | Modify |
| `src/app/use-storage-backend.test.tsx` | Tests for the switch orchestrator | Modify |
| `src/app/storage-config.tsx` | Dropdown `onChange` → `onRequestSwitch(kind)` prop; controlled select reverts on cancel | Modify |
| `src/app/storage-config.test.tsx` | Test the dropdown calls `onRequestSwitch` | Modify |
| `src/app/settings-menu.tsx` | Thread `onRequestStorageSwitch` prop → `StorageConfigSection` | Modify |
| `src/app/task-manager.tsx` | Pass `setStorageConfig` into the hook; thread `onRequestStorageSwitch` to settings | Modify |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | New keys | Modify |
| `src/app/version.ts`, `CHANGELOG.md` | Release 0.27.0 | Modify |

**Verified facts (do not re-derive):**
- `use-storage-backend.ts`: `useWorkspace()` exposes `tasks/raid/absences/shifts/resources/roles/disciplines/grades/plan/budgets/fxRates` (+ setters). The `backend` memo (lines 57-72) is `createBackend(args.settings.storageConfig, { acquireToken, tursoConfig })`. The **load effect** (lines 93-130) replaces state on backend change; it already uses `suppressNextSaveRef`. `onPickStorageFile` (178) does `pickFileForBackend(backend)` then `backend.save({...current})` — the convert-and-write-to-a-picked-file pattern already exists. `pickFileForBackend`, `createBackend`, `StorageNotReadyError`, `StorageNotImplementedError` imported from `./storage`; `getTursoConfig` from `./turso-config`. `args.settings`/`args.lang` mirrored into `settingsRef`/`langRef`. Current-workspace literal: `{ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates }`.
- `storage-config.tsx`: `STORAGE_OPTIONS: { kind, labelKey, comingSoon? }[]`; `handleKindChange(newKind)` currently `setError(null); onChange({ kind: newKind } as StorageConfig)`. `<select value={config.kind} onChange={(e)=>handleKindChange(e.target.value as StorageKind)}>` already controlled. Props: `config`, `onChange`, `onPickFile`, `onOpenFile`, `onGrantWrite`, `m365Enabled`, `sharepointEnabled`, `tursoEnabled`. `handleSpUrlBlur` calls `onChange({ kind, ...parsed })` (keep).
- `settings-menu.tsx`: `<StorageConfigSection lang config={settings.storageConfig} onChange={(storageConfig)=>onChange({...settings, storageConfig})} description ready onPickFile={onPickStorageFile} onOpenFile={onOpenStorageFile} onGrantWrite=... m365Enabled sharepointEnabled tursoEnabled />` (line 581+). `SettingsMenu` props include `onPickStorageFile`/`onOpenStorageFile` (~177/185).
- `task-manager.tsx`: `const { settings, setSettings, ... } = useSettings()` (81). `useStorageBackend({ settings, lang, hydrated, isPopout, activityLog, setActivityLog, showToast })` (198) returns `{ storageDescription, storageReady, onPickStorageFile, onGrantWriteAccess, onOpenStorageFile }` — threaded to `SettingsMenu`.
- `t(lang, key, ...args)` positional substitution. `StorageKind`/`StorageConfig` from `./storage`. Format label keys: `storageBrowser`/`storageLocalJson`/`storageLocalCsv`/`storageLocalMd`/`storageSpJson`/`storageSpCsv`/`storageTurso` (all exist).

---

## Task 1: `onRequestStorageSwitch` + suppress-load in `use-storage-backend.ts`

**Files:** Modify `src/app/use-storage-backend.ts`; Test `src/app/use-storage-backend.test.tsx`.

Adds the orchestrator + the load-suppression guard + a `setStorageConfig` arg. Add the two i18n keys it references to BOTH dictionaries now (Task 4 verifies the full set):
```ts
// i18n.ts (EN)
storageConvertConfirm: "Convert your current workspace ({0} tasks) to {1} and write it to this storage, overwriting any data already there?",
storageConvertedToast: "Converted and switched to {0}.",
// i18n.de.ts (DE) — verify ASCII " delimiters after editing
storageConvertConfirm: "Aktuellen Workspace ({0} Aufgaben) nach {1} konvertieren und in diesen Speicher schreiben? Vorhandene Daten dort werden überschrieben.",
storageConvertedToast: "Konvertiert und zu {0} gewechselt.",
```

- [ ] **Step 1: Write the failing test.** In `src/app/use-storage-backend.test.tsx` (match the file's existing harness — it already mocks `./storage` incl. `createBackend`, and renders the hook). Add a describe for the switch; mock `window.confirm`. Prefer a NON-local target (turso/browser) for the happy path to avoid the file picker:
```ts
it("onRequestStorageSwitch: confirm=true writes current workspace to the new backend and commits config", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  createBackendMock.mockReturnValue({ kind: "turso", load: vi.fn().mockResolvedValue(emptyWorkspace()), save, isReady: vi.fn().mockResolvedValue(true), describe: vi.fn().mockResolvedValue("Turso: x") });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  // render hook with setStorageConfig spy + a current workspace that has >=1 task
  await result.current.onRequestStorageSwitch("turso");
  expect(save).toHaveBeenCalledTimes(1);
  expect(setStorageConfig).toHaveBeenCalledWith({ kind: "turso" });
  expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
});

it("onRequestStorageSwitch: confirm=false → no save, no config change", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  await result.current.onRequestStorageSwitch("turso");
  expect(setStorageConfig).not.toHaveBeenCalled();
});

it("onRequestStorageSwitch: same kind → no-op (no confirm)", async () => {
  const c = vi.spyOn(window, "confirm");
  await result.current.onRequestStorageSwitch(currentKind);  // == settings.storageConfig.kind
  expect(c).not.toHaveBeenCalled();
});

it("onRequestStorageSwitch: write failure → no config change + error toast", async () => {
  createBackendMock.mockReturnValue({ kind: "turso", load: vi.fn(), save: vi.fn().mockRejectedValue(new Error("boom")), isReady: vi.fn().mockResolvedValue(true), describe: vi.fn().mockResolvedValue(null) });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await result.current.onRequestStorageSwitch("turso");
  expect(setStorageConfig).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
});
```
Also mock `./storage` `pickFileForBackend` to return `null` (non-local) so the happy path skips the picker. (If the existing test mock of `./storage` doesn't include `pickFileForBackend`, add it returning `null`.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** In `src/app/use-storage-backend.ts`:
  - Imports: ensure `type StorageConfig`, `type StorageKind` are imported from `./storage`.
  - `UseStorageBackendArgs` += `setStorageConfig: (config: StorageConfig) => void;`
  - Near `suppressNextSaveRef`: `const suppressNextLoadRef = useRef(false);`
  - In the load effect, immediately after `if (!args.hydrated) return;` (inside the async IIFE, before `backend.load()`):
    ```ts
    if (suppressNextLoadRef.current) { suppressNextLoadRef.current = false; await refreshBackendStatus(); return; }
    ```
  - Add the label map + handler:
    ```ts
    const STORAGE_LABEL_KEYS: Record<StorageKind, Parameters<typeof t>[1]> = {
      browser: "storageBrowser",
      "local-json": "storageLocalJson",
      "local-csv": "storageLocalCsv",
      "local-md": "storageLocalMd",
      "sp-json": "storageSpJson",
      "sp-csv": "storageSpCsv",
      turso: "storageTurso",
    };

    async function onRequestStorageSwitch(newKind: StorageKind): Promise<void> {
      if (args.isPopout) return;
      const current = settingsRef.current.storageConfig;
      if (newKind === current.kind) return;

      const newConfig: StorageConfig =
        (newKind === "sp-json" || newKind === "sp-csv") &&
        (current.kind === "sp-json" || current.kind === "sp-csv")
          ? { ...current, kind: newKind }
          : ({ kind: newKind } as StorageConfig);

      const label = t(langRef.current, STORAGE_LABEL_KEYS[newKind]);
      if (!window.confirm(t(langRef.current, "storageConvertConfirm", tasks.length, label))) return;

      const target = createBackend(newConfig, {
        acquireToken: auth.acquireToken,
        tursoConfig: getTursoConfig(
          settingsRef.current.integrations?.turso?.databaseUrl,
          settingsRef.current.integrations?.turso?.authToken,
        ),
      });

      try {
        const pick = pickFileForBackend(target); // promise only for local-* ; null/undefined otherwise
        if (pick) await pick;
        await target.save({ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates });
        suppressNextLoadRef.current = true;
        args.setStorageConfig(newConfig);
        await refreshBackendStatus();
        args.showToast("info", t(langRef.current, "storageConvertedToast", label));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/abort/i.test(msg) || /user activation/i.test(msg)) return; // cancelled picker
        if (err instanceof StorageNotReadyError) {
          const hint = (err as StorageNotReadyError).hint;
          const key = hint === "local-file-permission-needed" ? "storagePermissionGestureNeeded" : "storageNotReady";
          args.showToast("error", t(langRef.current, key));
        } else if (!(err instanceof StorageNotImplementedError)) {
          args.showToast("error", t(langRef.current, "storageSaveFailed", msg));
        }
      }
    }
    ```
  - Add `onRequestStorageSwitch` to the returned object.
- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/use-storage-backend.test.tsx`. `npx tsc --noEmit && npm run lint` → 0. (Confirm `pickFileForBackend`'s real return contract — match the `if (pick) await pick` guard to how `onPickStorageFile` uses it.)
- [ ] **Step 5: Commit** `git add src/app/use-storage-backend.ts src/app/use-storage-backend.test.tsx src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat(storage): convert-and-write onRequestStorageSwitch + suppress-load guard"`

---

## Task 2: Dropdown → `onRequestSwitch` in `storage-config.tsx`

**Files:** Modify `src/app/storage-config.tsx`; Test `src/app/storage-config.test.tsx`.

- [ ] **Step 1: Failing test.** In `storage-config.test.tsx` add `onRequestSwitch: vi.fn()` to the `baseProps()` defaults, then:
```ts
it("changing the storage format calls onRequestSwitch, not onChange", () => {
  const onRequestSwitch = vi.fn();
  const onChange = vi.fn();
  render(<StorageConfigSection {...baseProps({ onRequestSwitch, onChange, config: { kind: "browser" } })} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "local-json" } });
  expect(onRequestSwitch).toHaveBeenCalledWith("local-json");
  expect(onChange).not.toHaveBeenCalled();
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** In `storage-config.tsx`:
  - `Props` += `onRequestSwitch: (kind: StorageKind) => void;`; destructure it.
  - `handleKindChange`:
    ```ts
    function handleKindChange(newKind: StorageKind) {
      setError(null);
      if (newKind === config.kind) return;
      onRequestSwitch(newKind);
    }
    ```
  - Keep the `<select>` controlled by `config.kind` (unchanged) — cancel/abort leaves `config` unchanged so it reverts. Keep `handleSpUrlBlur`'s `onChange` usage.
- [ ] **Step 4: Run → PASS.** Add `onRequestSwitch` to every `StorageConfigSection` render in the test file (the standalone renders at lines ~44/63/84/110 + `baseProps`). `npx vitest run src/app/storage-config.test.tsx` → green. tsc + lint 0.
- [ ] **Step 5: Commit** `git add src/app/storage-config.tsx src/app/storage-config.test.tsx && git commit -m "feat(storage): format dropdown routes through onRequestSwitch"`

---

## Task 3: Wire through the container

**Files:** Modify `src/app/task-manager.tsx`, `src/app/settings-menu.tsx`, + test mocks.

- [ ] **Step 1: task-manager** — pass `setStorageConfig` into the hook + capture `onRequestStorageSwitch`:
```ts
const { storageDescription, storageReady, onPickStorageFile, onGrantWriteAccess, onOpenStorageFile, onRequestStorageSwitch } =
  useStorageBackend({
    settings, lang, hydrated, isPopout, activityLog, setActivityLog, showToast,
    setStorageConfig: (storageConfig) => setSettings((s) => ({ ...s, storageConfig })),
  });
```
Grep where `<SettingsMenu` (and/or `<AppHeader`) is rendered with `onPickStorageFile={...}` and add `onRequestStorageSwitch={onRequestStorageSwitch}` alongside (mirror the existing thread; if it passes through `AppHeader`, add the passthrough prop there too — check `app-header.tsx` which declares `onPickStorageFile`/`onOpenStorageFile`).
- [ ] **Step 2: settings-menu** — add `onRequestStorageSwitch: (kind: StorageKind) => void;` to `SettingsMenu` props (next to `onPickStorageFile`); destructure; pass to `<StorageConfigSection ... onRequestSwitch={onRequestStorageSwitch} />`. Import `type StorageKind` if needed. If `AppHeader` is the renderer of `SettingsMenu`, add the prop to `app-header.tsx`'s `Props` + passthrough too.
- [ ] **Step 3: Update test mocks** so tsc + tests pass with the new required props: `settings-menu.test.tsx` `makeProps` (add `onRequestStorageSwitch: vi.fn()`), `app-header.test.tsx` (add `onRequestStorageSwitch: vi.fn().mockResolvedValue(undefined)` or `vi.fn()` to its props), and confirm `storage-config.test.tsx` `baseProps` already has `onRequestSwitch` (Task 2).
- [ ] **Step 4: Gates** — `npx vitest run && npx tsc --noEmit && npm run lint` → green / 0 / 0.
- [ ] **Step 5: Commit** `git add src/app/task-manager.tsx src/app/settings-menu.tsx src/app/app-header.tsx src/app/settings-menu.test.tsx src/app/app-header.test.tsx && git commit -m "feat(storage): wire onRequestStorageSwitch through settings to the dropdown"`

---

## Task 4: i18n completeness (EN + DE)

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: Add the highlight key to BOTH files** (near other `versionHighlight*`):
```ts
// EN
versionHighlightStorageConvert: "Switching storage format now converts your current data and writes it to the new format (JSON, CSV, Markdown, SharePoint, or Turso) — after a confirmation — instead of loading whatever was there.",
// DE — verify ASCII " delimiters after editing
versionHighlightStorageConvert: "Beim Wechsel des Speicherformats werden jetzt Ihre aktuellen Daten konvertiert und in das neue Format (JSON, CSV, Markdown, SharePoint oder Turso) geschrieben – nach einer Bestätigung – statt vorhandene Daten zu laden.",
```
- [ ] **Step 2: Verify** `storageConvertConfirm`, `storageConvertedToast`, `versionHighlightStorageConvert` exist in BOTH files (grep). After editing `i18n.de.ts`, grep the new lines to confirm ASCII `"` delimiters; fix any curly-quote corruption.
- [ ] **Step 3:** `npx vitest run src/app && npx tsc --noEmit && npm run lint` → green / 0 / 0.
- [ ] **Step 4: Commit** `git add src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat(storage): EN/DE highlight string for convert-on-switch"`

---

## Task 5: Release 0.27.0

**Files:** Modify `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — top comment:
```ts
// 0.27.0 changes how switching the storage format behaves: instead of loading
// from the newly-selected backend (replacing your data), it converts your
// current in-memory workspace to the chosen format and writes it to the new
// backend after a confirmation, then switches. All formats (JSON, CSV,
// Markdown, SharePoint, Turso) are two-way. Completes the storage rework
// (A: relational Turso schema; B: convert-on-switch).
```
Bump `APP_VERSION` → `"0.27.0"`; keep `APP_BUILD_DATE`; append `"versionHighlightStorageConvert"` as the LAST `APP_HIGHLIGHT_KEYS` entry.
- [ ] **Step 2: CHANGELOG** — `## [0.27.0] — 2026-05-29` (match heading style): **Changed** — Switching the storage format now converts your current workspace to the chosen format and writes it to the new backend (after a confirmation), overwriting any data there, instead of loading the target's contents and replacing your data. Applies to JSON, CSV, Markdown, SharePoint, and Turso (all two-way). Startup still loads your configured backend; use "Open file" to pull data from a file.
- [ ] **Step 3: Gates** — `npx vitest run && npx tsc --noEmit && npm run lint` → green / 0 / 0.
- [ ] **Step 4: Commit** `git add src/app/version.ts CHANGELOG.md && git commit -m "release: 0.27.0 — convert-and-write on storage switch"`

---

## Final Review Checklist
- [ ] Switching format = confirm → (local: pick file) → `newBackend.save(current)` → suppress-load → commit config → toast; cancel/error → no config change (dropdown reverts).
- [ ] Startup load + `onOpenStorageFile` (pull) + `onPickStorageFile` (re-pick) unchanged; no backend internals changed.
- [ ] Same-kind → no-op; popout → no switch.
- [ ] `setStorageConfig` wired from task-manager `setSettings`; new required props supplied at all call sites incl. test mocks.
- [ ] EN/DE parity; `i18n.de.ts` delimiters ASCII; tsc 0; lint 0; full suite green; `eslint.config.mjs` untouched.

## Self-Review (plan vs spec)
- **Coverage:** orchestrator + suppress-load → Task 1; dropdown routing → Task 2; container wiring + `setStorageConfig` → Task 3; i18n → Tasks 1/4; release → Task 5.
- **Placeholders:** test snippets say "match the file's existing harness/mocks" — a confirm-then-use against the real `use-storage-backend.test.tsx` (which already mocks `createBackend`); the orchestrator code is complete.
- **Type consistency:** `onRequestStorageSwitch(newKind: StorageKind)` (Task 1) → exposed by hook → threaded as `onRequestStorageSwitch` (settings-menu/app-header) → `onRequestSwitch` (StorageConfigSection prop) Tasks 2-3; `setStorageConfig: (StorageConfig)=>void` added Task 1, supplied Task 3; i18n keys consistent Tasks 1/4. Local-file picker-after-`confirm()` user-activation is a live-verification follow-up (unit tests mock `pickFileForBackend`).
