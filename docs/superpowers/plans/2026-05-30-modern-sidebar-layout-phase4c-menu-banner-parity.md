# Phase 4 Workstream C — DRY ActionMenus + Banner Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the duplicated `Voice · Export · Help · Version` cluster into one shared `ActionMenus` component, and render the Due/Birthday/Jira-token banners in the modern layout (closing the parity gap with classic).

**Architecture:** A new presentational `ActionMenus` component pulls ExportMenu's data from `useWorkspace()` internally and is consumed by both `app-header.tsx` (classic) and `task-manager.tsx`'s `topBarMenus` (modern). A single shared `bannersEl` const in `TaskManagerInner` (existing gates verbatim) is rendered by both trees; `ModernShell` gains a `banners` slot at the top of `<main>`. A cwd-based sweep test guards against drift.

**Tech Stack:** Next.js 16 (App Router), React 18, TypeScript, Tailwind v4, Vitest + React Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-05-30-modern-sidebar-layout-phase4c-menu-banner-parity-design.md`

**Constraints (carry through every task):**
- AIPM 9-color palette only — no gradients, no drop shadows, no off-palette colors. (This workstream adds no new styles; banners/menus are already compliant.)
- `README.md` and `public/*.png` are pre-existing uncommitted user changes — NEVER touch or stage them. Use scoped `git add <paths>`, never `git add -A`/`git add .`.
- Branch: `phase4c-menu-banner-parity` (already created; spec committed at `cd1bf83`).
- Verify after each task: `npx tsc --noEmit` is clean and `npx vitest run` is fully green.

---

### Task 1: Create the shared `ActionMenus` component

**Files:**
- Create: `src/app/action-menus.tsx`
- Test: `src/app/action-menus.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/action-menus.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type React from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { ActionMenus } from "./action-menus";
import { t } from "./i18n";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

describe("ActionMenus", () => {
  it("renders the Export, Help, and Version menu triggers", () => {
    render(
      <ActionMenus lang="en-US" onCommand={vi.fn()} onVoiceError={vi.fn()} />,
      { wrapper: Wrapper },
    );
    expect(
      screen.getByRole("button", { name: t("en-US", "exportTitle") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("en-US", "help") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("en-US", "version") }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/action-menus.test.tsx`
Expected: FAIL — `Failed to resolve import "./action-menus"` (file does not exist yet).

- [ ] **Step 3: Create the component**

Create `src/app/action-menus.tsx`:

```tsx
"use client";
import dynamic from "next/dynamic";
import { type Lang } from "./i18n";
import { type Command } from "./voice";
import { ExportMenu } from "./export-menu";
import { HelpMenu } from "./help-menu";
import { VersionMenu } from "./version-menu";
import { useWorkspace } from "./workspace-context";

// Lazy-loaded like in app-header.tsx — the speech-recognition bundle is only
// fetched client-side when the button mounts.
const VoiceCommandButton = dynamic(
  () => import("./voice-button").then((m) => m.VoiceCommandButton),
  { ssr: false },
);

interface ActionMenusProps {
  lang: Lang;
  onCommand: (cmd: Command, originalText: string) => void;
  onVoiceError: (msg: string) => void;
}

/**
 * The shared header action cluster — Voice, Export, Help, Version — rendered
 * identically by the classic `AppHeader` and the modern `TopBar`. ExportMenu's
 * data comes from `useWorkspace()` here so callers pass only `lang` + the voice
 * handlers (single source of truth; see the action-menus-sweep guard test).
 */
export function ActionMenus({ lang, onCommand, onVoiceError }: ActionMenusProps) {
  const { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates } = useWorkspace();
  return (
    <>
      <VoiceCommandButton lang={lang} onCommand={onCommand} onError={onVoiceError} />
      <ExportMenu lang={lang} tasks={tasks} raid={raid} absences={absences} shifts={shifts} resources={resources} roles={roles} disciplines={disciplines} grades={grades} plan={plan} budgets={budgets} fxRates={fxRates} />
      <HelpMenu lang={lang} />
      <VersionMenu lang={lang} />
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/action-menus.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/action-menus.tsx src/app/action-menus.test.tsx
git commit -m "feat: add shared ActionMenus cluster (Voice/Export/Help/Version)"
```

---

### Task 2: Wire the modern `topBarMenus` to `ActionMenus`

**Files:**
- Modify: `src/app/task-manager.tsx`

This removes the inline `topBarMenus` element and its now-unused imports. The modern `TopBar` renders the cluster via `ActionMenus`.

- [ ] **Step 1: Add the ActionMenus import**

In `src/app/task-manager.tsx`, add this import next to the other local imports (e.g. directly after the `import { VersionMenu } from "./version-menu";` line, which you will remove in Step 3):

```tsx
import { ActionMenus } from "./action-menus";
```

- [ ] **Step 2: Replace the inline `topBarMenus` element**

Find this block (currently around lines 791–802):

```tsx
  // The action-cluster menus that AppHeader renders in classic mode. Reused by
  // the modern TopBar (which renders the + and bell buttons itself).
  const topBarMenus = (
    <>
      <VoiceCommandButton
        lang={lang}
        onCommand={handleCommand}
        onError={(msg) => showToast("error", msg)}
      />
      <ExportMenu lang={lang} tasks={tasks} raid={raid} absences={absences} shifts={shifts} resources={resources} roles={roles} disciplines={disciplines} grades={grades} plan={plan} budgets={budgets} fxRates={fxRates} />
      <HelpMenu lang={lang} />
      <VersionMenu lang={lang} />
    </>
  );
```

Replace it with:

```tsx
  // The action-cluster menus (Voice/Export/Help/Version) shared with the classic
  // AppHeader via ActionMenus. The modern TopBar renders the + and bell buttons
  // itself; this fills its trailing `children` slot.
  const topBarMenus = (
    <ActionMenus
      lang={lang}
      onCommand={handleCommand}
      onVoiceError={(msg) => showToast("error", msg)}
    />
  );
```

- [ ] **Step 3: Remove the now-unused imports and the dynamic VoiceCommandButton**

In `src/app/task-manager.tsx`:

1. Remove these three import lines (currently lines 53–55):

```tsx
import { ExportMenu } from "./export-menu";
import { HelpMenu } from "./help-menu";
import { VersionMenu } from "./version-menu";
```

2. Remove the `next/dynamic` import (currently line 4):

```tsx
import dynamic from "next/dynamic";
```

3. Remove the lazy `VoiceCommandButton` definition (currently lines 73–78):

```tsx
// Lazy-loaded like in app-header.tsx — the speech-recognition bundle is only
// fetched client-side when the button mounts.
const VoiceCommandButton = dynamic(
  () => import("./voice-button").then((m) => m.VoiceCommandButton),
  { ssr: false },
);
```

(`dynamic` is used ONLY for that definition in this file, and `ExportMenu`/`HelpMenu`/`VersionMenu`/`VoiceCommandButton` are used ONLY inside the old `topBarMenus`. After the edits they have no remaining references.)

- [ ] **Step 4: Type-check (catches any missed reference)**

Run: `npx tsc --noEmit`
Expected: no errors. If you see `'X' is declared but its value is never read` or `Cannot find name 'VoiceCommandButton'`, you missed a removal in Step 3 — fix it.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all green (no behavior change — the modern cluster renders the same four controls).

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "refactor: render modern topBarMenus via shared ActionMenus"
```

---

### Task 3: Wire the classic `AppHeader` to `ActionMenus`

**Files:**
- Modify: `src/app/app-header.tsx`

The classic header keeps Add/Bell/Settings; the `Voice/Export/Help/Version` run becomes `<ActionMenus/>`. AppHeader no longer needs `useWorkspace()` (it used it only to feed ExportMenu). **Deliberate, approved reorder:** Voice moves to sit just before Export (new order `Add · Bell · [Voice · Export · Help · Version] · Settings`).

- [ ] **Step 1: Update imports**

In `src/app/app-header.tsx`:

1. Remove the `next/dynamic` import (line 2):

```tsx
import dynamic from "next/dynamic";
```

2. Remove these imports (lines 8–10 and the `useWorkspace` import on line 12):

```tsx
import { ExportMenu } from "./export-menu";
import { HelpMenu } from "./help-menu";
import { VersionMenu } from "./version-menu";
```
```tsx
import { useWorkspace } from "./workspace-context";
```

3. Remove the lazy `VoiceCommandButton` definition (lines 14–17):

```tsx
const VoiceCommandButton = dynamic(
  () => import("./voice-button").then((m) => m.VoiceCommandButton),
  { ssr: false },
);
```

4. Add the ActionMenus import (place it after the `SettingsMenu` import on line 11):

```tsx
import { ActionMenus } from "./action-menus";
```

Keep the `SettingsMenu`, `type Settings`, `type Command`, `type AlertableTask`, `type StorageKind`, and `type Lang`/`t` imports — they are still used.

- [ ] **Step 2: Remove the `useWorkspace()` destructure**

Remove this line from the `AppHeader` function body (currently line 59):

```tsx
  const { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates } = useWorkspace();
```

- [ ] **Step 3: Replace the inline Voice button and the Export/Help/Version run**

In the returned JSX, the action cluster currently reads (lines 78–146):

```tsx
        <div className="flex items-center gap-1">
          <VoiceCommandButton
            lang={lang}
            onCommand={handleCommand}
            onError={(msg) => showToast("error", msg)}
          />
          <button
            type="button"
            onClick={() => {
              handleCancelEdit();
              setTaskModalOpen(true);
            }}
            aria-label={t(lang, "addTaskButton")}
            title={t(lang, "addTaskButton")}
            className="rounded-md p-2 text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-AIPM-medium-grey dark:hover:text-AIPM-light-grey"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="h-5 w-5"
            >
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              setBannerDismissed(false);
              setDueModalOpen(true);
            }}
            aria-label={t(lang, "showDueAlerts")}
            title={t(lang, "showDueAlerts")}
            className="relative rounded-md p-2 text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-AIPM-medium-grey dark:hover:text-AIPM-light-grey"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="h-5 w-5"
            >
              <path d="M10 2a6 6 0 00-6 6v2.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 10.586V8a6 6 0 00-6-6zM8 15a2 2 0 104 0H8z" />
            </svg>
            {bannerItems.length > 0 && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-AIPM-pink px-1 text-[10px] font-semibold leading-none text-white"
              >
                {bannerItems.length}
              </span>
            )}
          </button>
          <ExportMenu lang={lang} tasks={tasks} raid={raid} absences={absences} shifts={shifts} resources={resources} roles={roles} disciplines={disciplines} grades={grades} plan={plan} budgets={budgets} fxRates={fxRates} />
          <HelpMenu lang={lang} />
          <VersionMenu lang={lang} />
          <SettingsMenu
            settings={settings}
            onChange={setSettings}
            storageDescription={storageDescription}
            storageReady={storageReady}
            onPickStorageFile={onPickStorageFile}
            onOpenStorageFile={onOpenStorageFile}
            onGrantStorageWrite={onGrantStorageWrite}
            onRequestStorageSwitch={onRequestStorageSwitch}
          />
        </div>
```

Make exactly two changes, leaving the Add and Bell buttons and `SettingsMenu` untouched:

1. **Delete** the leading `<VoiceCommandButton ... />` element (the first child, lines 79–83).
2. **Replace** the three lines `<ExportMenu .../>`, `<HelpMenu .../>`, `<VersionMenu .../>` with a single `<ActionMenus/>` that also carries the Voice button:

```tsx
          <ActionMenus
            lang={lang}
            onCommand={handleCommand}
            onVoiceError={(msg) => showToast("error", msg)}
          />
```

The cluster now reads: Add button, Bell button, `<ActionMenus/>`, `<SettingsMenu/>`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `useWorkspace` / `ExportMenu` / `dynamic` show as unused, a removal was missed in Step 1.)

- [ ] **Step 5: Run the AppHeader tests and the full suite**

Run: `npx vitest run src/app/app-header.test.tsx`
Expected: PASS — the existing tests assert only the title heading and the bell badge count, both unaffected. AppHeader still renders inside the test's `WorkspaceProvider`, which `ActionMenus` needs.

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/app/app-header.tsx
git commit -m "refactor: render classic AppHeader menus via shared ActionMenus"
```

---

### Task 4: Add the `banners` slot to `ModernShell`

**Files:**
- Modify: `src/app/modern-shell.tsx`
- Test: `src/app/modern-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `src/app/modern-shell.test.tsx` (after the existing `ModernShell settings slot` block):

```tsx
describe("ModernShell banners slot", () => {
  it("renders banners at the top of the main content region", () => {
    setup({ banners: <div data-testid="banners" /> });
    const main = document.getElementById("main-content");
    const banners = screen.getByTestId("banners");
    expect(banners).toBeInTheDocument();
    expect(main?.contains(banners)).toBe(true);
    // Banners come before the view content in DOM order.
    const tasks = screen.getByTestId("tasks");
    expect(banners.compareDocumentPosition(tasks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders banners on the edit view too (all views)", () => {
    setup({
      activeView: "edit",
      editView: <div data-testid="edit" />,
      editTitle: "Editing task #1",
      banners: <div data-testid="banners" />,
    });
    expect(screen.getByTestId("banners")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/modern-shell.test.tsx`
Expected: FAIL — `getByTestId("banners")` finds nothing (the slot is not rendered yet). Note: `vitest` compiles via esbuild (no type-check), so passing the not-yet-typed `banners` prop through `setup`'s spread is allowed at runtime; the failure is the missing element, not a type error.

- [ ] **Step 3: Add the prop and render it**

In `src/app/modern-shell.tsx`, add the prop to the `ModernShellProps` interface (after the `settingsView?` line, currently line 24):

```tsx
  /** Phase 4C: notification banners (Due / Birthday / Jira token), rendered at the top of <main> on all views. */
  banners?: React.ReactNode;
```

Add it to the destructured params (after `settingsView = null,`, currently line 33):

```tsx
  banners = null,
```

Render it at the top of `<main>`, before `{content}` (currently lines 75–77):

```tsx
        <main id="main-content" className="min-h-0 flex-1 overflow-auto bg-surface-muted p-6 dark:bg-black">
          {banners}
          {content}
        </main>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/modern-shell.test.tsx`
Expected: PASS (all ModernShell tests, including the two new ones).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/modern-shell.tsx src/app/modern-shell.test.tsx
git commit -m "feat: add ModernShell banners slot at top of main content"
```

---

### Task 5: Extract `bannersEl` and render it in both trees

**Files:**
- Modify: `src/app/task-manager.tsx`

Extract the three classic banners into a single `bannersEl` const (gates verbatim, including `!isPopout`), use it in `legacyTree`, and pass it to `ModernShell` via the new `banners` slot.

- [ ] **Step 1: Define the shared `bannersEl` const**

In `src/app/task-manager.tsx`, add this const immediately after the `topBarMenus` definition you edited in Task 2 (i.e. just before `const modalsBlock = (`):

```tsx
  // The Due / Birthday / Jira-token reminder banners, shared by the classic tree
  // (rendered after AppHeader) and the modern tree (ModernShell `banners` slot).
  // Gates kept verbatim — popouts (`!isPopout`) still suppress all three.
  const bannersEl = (
    <>
      {!isPopout && !bannerDismissed && !dueSnooze.isSnoozed && (
        <DueBanner
          items={bannerItems}
          lang={lang}
          onOpenList={() => setDueModalOpen(true)}
          onDismiss={() => setBannerDismissed(true)}
          onSnooze={dueSnooze.snooze}
        />
      )}
      {!isPopout && !birthdaySnooze.isSnoozed && !birthdayDismissed && birthdayItems.length > 0 && (
        <BirthdayBanner items={birthdayItems} lang={lang} onDismiss={() => setBirthdayDismissed(true)} onSnooze={birthdaySnooze.snooze} />
      )}
      {!isPopout && jiraTokenAlert && !jiraTokenSnooze.isSnoozed && !jiraTokenDismissed && (
        <JiraTokenBanner
          alert={jiraTokenAlert}
          lang={lang}
          onSnooze={jiraTokenSnooze.snooze}
          onDismiss={() => setJiraTokenDismissed(true)}
        />
      )}
    </>
  );
```

- [ ] **Step 2: Replace the inline banners in `legacyTree`**

In `legacyTree`, find the three inline banner blocks (currently lines 925–946), which sit between the `<AppHeader .../>` block and `{workspaceEl}`:

```tsx
      {!isPopout && !bannerDismissed && !dueSnooze.isSnoozed && (
        <DueBanner
          items={bannerItems}
          lang={lang}
          onOpenList={() => setDueModalOpen(true)}
          onDismiss={() => setBannerDismissed(true)}
          onSnooze={dueSnooze.snooze}
        />
      )}

      {!isPopout && !birthdaySnooze.isSnoozed && !birthdayDismissed && birthdayItems.length > 0 && (
        <BirthdayBanner items={birthdayItems} lang={lang} onDismiss={() => setBirthdayDismissed(true)} onSnooze={birthdaySnooze.snooze} />
      )}

      {!isPopout && jiraTokenAlert && !jiraTokenSnooze.isSnoozed && !jiraTokenDismissed && (
        <JiraTokenBanner
          alert={jiraTokenAlert}
          lang={lang}
          onSnooze={jiraTokenSnooze.snooze}
          onDismiss={() => setJiraTokenDismissed(true)}
        />
      )}
```

Replace all of it with the single shared element:

```tsx
      {bannersEl}
```

- [ ] **Step 3: Pass `banners` to `ModernShell`**

In `modernTree`, add the `banners` prop to the `<ModernShell ... />` element (e.g. directly after the `settingsView={settingsViewEl}` line, currently line 987):

```tsx
        banners={bannersEl}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all green. Classic output is byte-identical (same element, same gates); modern now renders the banners at the top of `<main>`.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "feat: render reminder banners in the modern layout (banner parity)"
```

---

### Task 6: Add the DRY sweep guard test

**Files:**
- Create: `src/app/action-menus-sweep.test.ts`

A cwd-based source-scan (mirroring `settings-sections-sweep.test.ts`) that fails if either consumer drifts back to importing the individual menus instead of `ActionMenus`.

- [ ] **Step 1: Write the test**

Create `src/app/action-menus-sweep.test.ts`:

```ts
// src/app/action-menus-sweep.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Both consumers MUST source the action cluster from ./action-menus so the
// classic header and the modern top bar never diverge (Phase 4 Workstream C).
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const CONSUMERS = [
  "src/app/app-header.tsx",
  "src/app/task-manager.tsx",
] as const;

const FORBIDDEN_DIRECT_IMPORTS = [
  "./export-menu",
  "./help-menu",
  "./version-menu",
] as const;

describe("action menus — single source of truth", () => {
  it("resolves the source directory from the vitest root", () => {
    expect(read("src/app/action-menus.tsx").length).toBeGreaterThan(0);
  });

  for (const file of CONSUMERS) {
    const src = read(file);
    it(`${file} imports the shared ActionMenus`, () => {
      expect(src).toContain("./action-menus");
    });
    for (const dep of FORBIDDEN_DIRECT_IMPORTS) {
      it(`${file} no longer imports ${dep} directly`, () => {
        expect(src).not.toContain(`from "${dep}"`);
      });
    }
  }
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run src/app/action-menus-sweep.test.ts`
Expected: PASS — Tasks 2 and 3 already removed the direct imports from both consumers and added `./action-menus`. (If a `... no longer imports ...` case FAILS, a direct import was left behind in Task 2 or 3 — go remove it.)

- [ ] **Step 3: Commit**

```bash
git add src/app/action-menus-sweep.test.ts
git commit -m "test: guard that AppHeader + task-manager source menus from ActionMenus"
```

---

### Task 7: Release 0.34.0 "Novik"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

**Codename:** "Novik" (Naomi Novik). The spec's tentative "Chambers" collides with 0.28.0, so it is superseded. Before committing, verify "Novik" is unused.

- [ ] **Step 1: Verify the codename is free**

Run: `git grep -n "Novik" -- CHANGELOG.md src/app/version.ts`
Expected: no output. If there is any output, pick the first unused name from this fallback list and use it everywhere below instead: `Muir`, `Hurley`, `Kowal`, `Valente`.

- [ ] **Step 2: Update `version.ts`**

In `src/app/version.ts`:

1. Add this milestone comment at the very top of the file (before the existing `// 0.33.0 "Wells" ...` line):

```tsx
// 0.34.0 "Novik" is Phase 4 Workstream C of the modern layout: shell DRY +
// banner parity. The header action cluster (Voice, Export, Help, Version) is now
// one shared ActionMenus component consumed by both the classic header and the
// modern top bar (a sweep test guards against drift). The modern layout now also
// shows the Due / Birthday / Jira-token reminder banners — previously only the
// classic layout did — rendered at the top of the content area on every view via
// a new ModernShell `banners` slot. No new user-facing settings or strings.
```

2. Change `APP_VERSION` (currently line 388):

```tsx
export const APP_VERSION = "0.34.0";
```

3. Change `APP_BUILD_DATE`'s codename comment (currently line 389):

```tsx
export const APP_BUILD_DATE = "2026-05-30"; // Novik
```

(Leave `APP_HIGHLIGHT_KEYS` unchanged — this workstream adds no new highlight.)

- [ ] **Step 3: Update `CHANGELOG.md`**

Insert this entry directly above the `## [0.33.0] — 2026-05-30 "Wells"` line (currently line 11):

```markdown
## [0.34.0] — 2026-05-30 "Novik"

### Added
- The modern layout now shows the Due, Birthday, and Jira-token reminder banners at the top of the content area (previously only the Classic layout showed them).

### Internal
- Extracted the shared header action cluster (Voice, Export, Help, Version) into a single `ActionMenus` component used by both the Classic header and the modern top bar, with a sweep test that guards against the two drifting apart. In the Classic header the Voice button now sits alongside Export/Help/Version (a minor reorder); behavior is unchanged.

```

- [ ] **Step 4: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "release: 0.34.0 — DRY ActionMenus + modern banner parity (Phase 4 Workstream C)"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npx vitest run` — fully green.
- [ ] `git status --short` shows ONLY the pre-existing `README.md` (M) and `public/*.png` (D) entries — nothing else uncommitted, and those were never staged.
- [ ] Dispatch a final holistic code review over the whole branch diff (`git diff main...HEAD`) before finishing the branch.

## Notes for the executor

- **Line numbers** in this plan are from the pre-edit files and will drift as you edit. Match on the quoted code, not the numbers.
- **Never** run `git add -A` / `git add .` — always stage the explicit paths shown. `README.md` + `public/*.png` are the user's pre-existing changes and must stay untouched.
- The `settings-sections-sweep.test.ts` in this repo uses a slightly weaker assertion style; the new sweep test in Task 6 intentionally matches on the exact `from "<path>"` substring to avoid false negatives.
