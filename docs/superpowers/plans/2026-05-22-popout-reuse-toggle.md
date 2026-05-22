# Popout Reuse Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings toggle that, when enabled, causes all popout panel buttons to reuse a single already-open popout window (focusing it) rather than opening a new browser window per panel.

**Architecture:** Add `popout.reuseWindow` to the `Settings` type and `defaultSettings`; add a module-level `_popoutWindowRef` in `broadcast-sync.ts` and update `openPopoutWindow` to accept and act on `reuseWindow`; update `workspace-section.tsx` to pass the setting to each of its 6 `openPopoutWindow` call sites (it already calls `useSettings()` internally — no new hook needed); add a checkbox toggle in the settings panel UI.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library

---

## Files Modified

| File | Change |
|------|--------|
| `src/app/settings-menu.tsx` | Add `popout: { reuseWindow: boolean }` to `Settings` type + `defaultSettings`; add toggle UI |
| `src/app/use-settings.ts` | Add `popout` deep-merge to the load effect (matches existing `jira`/`ai`/`notifications` pattern) |
| `src/app/i18n.ts` | Add `popoutReuseWindow` key to `enUS` |
| `src/app/i18n.de.ts` | Add `popoutReuseWindow` German translation |
| `src/app/broadcast-sync.ts` | Add module-level `_popoutWindowRef`; update `openPopoutWindow` signature |
| `src/app/workspace-section.tsx` | Pass `settings.popout.reuseWindow` to every `openPopoutWindow` call (6 sites) |

## New Files

| File | Purpose |
|------|---------|
| `src/app/broadcast-sync.test.ts` | 4 tests for the updated `openPopoutWindow` |
| `src/app/settings-menu.test.tsx` | 3 tests: defaultSettings default + toggle renders + toggle updates value |

---

### Task 1: Extend Settings type + defaultSettings + add i18n key

**Files:**
- Modify: `src/app/settings-menu.tsx`
- Modify: `src/app/use-settings.ts`
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`
- Create: `src/app/settings-menu.test.tsx`

- [ ] **Step 1: Write failing test for defaultSettings.popout**

Create `src/app/settings-menu.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { defaultSettings } from "./settings-menu";

describe("defaultSettings", () => {
  it("popout.reuseWindow defaults to false", () => {
    expect(defaultSettings.popout.reuseWindow).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/settings-menu.test.tsx --reporter=verbose`
Expected: FAIL — TypeScript error: Property 'popout' does not exist on type 'Settings'

- [ ] **Step 3: Add popout to Settings type and defaultSettings in settings-menu.tsx**

In `src/app/settings-menu.tsx`, update the `Settings` type (currently at line 82):

```typescript
export type Settings = {
  language: Lang;
  holidayCountries: string[];
  storageConfig: StorageConfig;
  ai: AiConfig;
  notifications: NotificationsConfig;
  jira: JiraConfig;
  popout: {
    reuseWindow: boolean;
  };
};
```

Update `defaultSettings` (currently at line 91) — add the `popout` field:

```typescript
export const defaultSettings: Settings = {
  language: "en-US",
  holidayCountries: [],
  storageConfig: defaultStorageConfig,
  ai: defaultAiConfig,
  notifications: defaultNotificationsConfig,
  jira: defaultJiraConfig,
  popout: {
    reuseWindow: false,
  },
};
```

- [ ] **Step 4: Add popout to the deep-merge in use-settings.ts**

In `src/app/use-settings.ts`, the `merged` object is built starting around line 33. Add `popout` following the same pattern as `jira`:

```typescript
const merged: Settings = {
  ...defaultSettings,
  ...parsed,
  language: resolvedLang,
  ai: {
    ...defaultSettings.ai,
    ...(isPlainObject(parsed.ai) ? parsed.ai : {}),
  },
  notifications: {
    ...defaultSettings.notifications,
    ...(isPlainObject(parsed.notifications)
      ? parsed.notifications
      : {}),
  },
  jira: {
    ...defaultSettings.jira,
    ...(isPlainObject(parsed.jira) ? parsed.jira : {}),
  },
  popout: {
    ...defaultSettings.popout,
    ...(isPlainObject(parsed.popout) ? parsed.popout : {}),
  },
  holidayCountries: Array.isArray(parsed.holidayCountries)
    ? (parsed.holidayCountries as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : defaultSettings.holidayCountries,
};
```

- [ ] **Step 5: Add popoutReuseWindow to i18n.ts**

In `src/app/i18n.ts`, inside the `enUS` object, add after `popoutOpenInNewWindow` (currently line 601):

```typescript
  popoutOpenInNewWindow: "Open in new window",
  popoutReuseWindow: "Reuse popout window",
```

- [ ] **Step 6: Add German translation to i18n.de.ts**

In `src/app/i18n.de.ts`, add after `popoutOpenInNewWindow` (currently line 617):

```typescript
  popoutOpenInNewWindow: "In neuem Fenster öffnen",
  popoutReuseWindow: "Bereits geöffnetes Fenster wiederverwenden",
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/app/settings-menu.test.tsx --reporter=verbose`
Expected: PASS — 1 test passed

- [ ] **Step 8: Run tsc to verify types**

Run: `npx tsc --noEmit`
Expected: No new errors (one pre-existing error in `use-due-alerts.test.ts` is unrelated)

- [ ] **Step 9: Commit**

```bash
git add src/app/settings-menu.tsx src/app/settings-menu.test.tsx src/app/use-settings.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(settings): add popout.reuseWindow to Settings type + i18n key"
```

---

### Task 2: Update broadcast-sync.ts — add ref tracker + update openPopoutWindow

**Files:**
- Modify: `src/app/broadcast-sync.ts`
- Create: `src/app/broadcast-sync.test.ts`

Uses `vi.resetModules()` + dynamic import per test to reset the module-level `_popoutWindowRef` between tests.

- [ ] **Step 1: Write 4 failing tests**

Create `src/app/broadcast-sync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("openPopoutWindow", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls window.open and stores ref when reuseWindow=false", async () => {
    const mockFocus = vi.fn();
    const mockWin = { focus: mockFocus, closed: false } as unknown as Window;
    const mockOpen = vi.spyOn(window, "open").mockReturnValue(mockWin);

    const { openPopoutWindow } = await import("./broadcast-sync");
    openPopoutWindow("gantt", false);

    expect(mockOpen).toHaveBeenCalledOnce();
    expect(mockOpen).toHaveBeenCalledWith(
      expect.stringContaining("?popout=gantt"),
      "lop-popout-gantt",
      "popup=yes,width=1200,height=800",
    );
    mockOpen.mockRestore();
  });

  it("focuses existing open window without calling window.open when reuseWindow=true", async () => {
    const mockFocus = vi.fn();
    const mockWin = { focus: mockFocus, closed: false } as unknown as Window;
    const mockOpen = vi.spyOn(window, "open").mockReturnValue(mockWin);

    const { openPopoutWindow } = await import("./broadcast-sync");
    openPopoutWindow("gantt", false); // establishes the ref

    openPopoutWindow("reports", true); // reuse: should focus, not open
    expect(mockOpen).toHaveBeenCalledOnce(); // still exactly 1 call
    expect(mockFocus).toHaveBeenCalledOnce();
    mockOpen.mockRestore();
  });

  it("opens a new window when reuseWindow=true but stored ref is closed", async () => {
    const closedWin = { focus: vi.fn(), closed: true } as unknown as Window;
    const freshWin = { focus: vi.fn(), closed: false } as unknown as Window;
    const mockOpen = vi
      .spyOn(window, "open")
      .mockReturnValueOnce(closedWin)
      .mockReturnValueOnce(freshWin);

    const { openPopoutWindow } = await import("./broadcast-sync");
    openPopoutWindow("gantt", false); // ref = closedWin

    openPopoutWindow("reports", true); // ref closed → opens new
    expect(mockOpen).toHaveBeenCalledTimes(2);
    mockOpen.mockRestore();
  });

  it("always calls window.open with reuseWindow=false (multi-window mode unchanged)", async () => {
    const mockWin = { focus: vi.fn(), closed: false } as unknown as Window;
    const mockOpen = vi.spyOn(window, "open").mockReturnValue(mockWin);

    const { openPopoutWindow } = await import("./broadcast-sync");
    openPopoutWindow("gantt", false);
    openPopoutWindow("reports", false);
    expect(mockOpen).toHaveBeenCalledTimes(2);
    mockOpen.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/broadcast-sync.test.ts --reporter=verbose`
Expected: FAIL — `openPopoutWindow` does not accept 2 arguments

- [ ] **Step 3: Update broadcast-sync.ts**

In `src/app/broadcast-sync.ts`:

1. After the `POPOUT_TABS` constant block (after `} as const;` at line 101), add:

```typescript
let _popoutWindowRef: Window | null = null;
```

2. Replace the `openPopoutWindow` function (currently lines 112–119) with:

```typescript
export function openPopoutWindow(tab: PopoutTab, reuseWindow: boolean): void {
  if (typeof window === "undefined") return;
  if (reuseWindow && _popoutWindowRef && !_popoutWindowRef.closed) {
    _popoutWindowRef.focus();
    return;
  }
  const url = `${window.location.pathname}?popout=${encodeURIComponent(tab)}`;
  const win = window.open(url, `lop-popout-${tab}`, "popup=yes,width=1200,height=800");
  if (win) _popoutWindowRef = win;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/broadcast-sync.test.ts --reporter=verbose`
Expected: PASS — 4 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/app/broadcast-sync.ts src/app/broadcast-sync.test.ts
git commit -m "feat(broadcast-sync): add popout window ref tracking + reuseWindow logic"
```

---

### Task 3: Update workspace-section.tsx — pass reuseWindow to openPopoutWindow

**Files:**
- Modify: `src/app/workspace-section.tsx`

`workspace-section.tsx` already calls `const { settings, lang } = useSettings();` at line 94 — no new hook needed. Only the 6 `onPopout` callbacks need updating.

- [ ] **Step 1: Update all 6 openPopoutWindow calls**

In `src/app/workspace-section.tsx`, update each `onPopout` callback inside the tab bar (lines ~131–197). Change every `openPopoutWindow("tab")` to pass `settings.popout.reuseWindow` as the second argument:

```tsx
// chat tab (~line 131)
onPopout={() => openPopoutWindow("chat", settings.popout.reuseWindow)}

// reports tab (~line 143)
onPopout={() => openPopoutWindow("reports", settings.popout.reuseWindow)}

// gantt tab (~line 155)
onPopout={() => openPopoutWindow("gantt", settings.popout.reuseWindow)}

// raid tab (~line 167)
onPopout={() => openPopoutWindow("raid", settings.popout.reuseWindow)}

// resources tab (~line 181)
onPopout={() => openPopoutWindow("resources", settings.popout.reuseWindow)}

// activity tab (~line 191)
onPopout={() => openPopoutWindow("activity", settings.popout.reuseWindow)}
```

- [ ] **Step 2: Run tsc to verify no type errors**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All existing tests pass

- [ ] **Step 4: Commit**

```bash
git add src/app/workspace-section.tsx
git commit -m "feat(workspace-section): pass reuseWindow to openPopoutWindow"
```

---

### Task 4: Add settings toggle UI in settings-menu.tsx + tests

**Files:**
- Modify: `src/app/settings-menu.tsx`
- Modify: `src/app/settings-menu.test.tsx`

- [ ] **Step 1: Write 2 failing UI tests**

Replace `src/app/settings-menu.test.tsx` entirely with the following (consolidates the Task 1 test and the 2 new UI tests):

```typescript
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { defaultSettings, SettingsMenu, type Settings } from "./settings-menu";
import { t } from "./i18n";

vi.mock("./jira-settings", () => ({
  JiraSettingsSection: () => null,
}));
vi.mock("./storage-config", () => ({
  StorageConfigSection: () => null,
}));

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...defaultSettings, ...overrides };
}

const baseMenuProps = {
  settings: makeSettings(),
  onChange: vi.fn(),
  storageDescription: null,
  storageReady: false,
  onPickStorageFile: vi.fn().mockResolvedValue(undefined),
  onOpenStorageFile: vi.fn().mockResolvedValue(undefined),
  onGrantStorageWrite: vi.fn().mockResolvedValue(undefined),
};

describe("defaultSettings", () => {
  it("popout.reuseWindow defaults to false", () => {
    expect(defaultSettings.popout.reuseWindow).toBe(false);
  });
});

describe("SettingsMenu popout toggle", () => {
  it("renders 'Reuse popout window' toggle in settings panel", () => {
    render(<SettingsMenu {...baseMenuProps} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));

    expect(
      screen.getByRole("checkbox", { name: t("en-US", "popoutReuseWindow") }),
    ).toBeInTheDocument();
  });

  it("toggling calls onChange with updated popout.reuseWindow value", () => {
    const onChange = vi.fn();
    render(<SettingsMenu {...baseMenuProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));

    fireEvent.click(
      screen.getByRole("checkbox", { name: t("en-US", "popoutReuseWindow") }),
    );

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        popout: { reuseWindow: true },
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify 2 new tests fail**

Run: `npx vitest run src/app/settings-menu.test.tsx --reporter=verbose`
Expected: 1 PASS (defaultSettings test), 2 FAIL (checkbox not found)

- [ ] **Step 3: Add toggle UI to settings-menu.tsx**

In `src/app/settings-menu.tsx`, inside the `{open && <div role="dialog" ...>}` block, insert after the closing `</div>` of the notifications `mb-4` section (the div containing three `<NotificationRow>` calls, currently ending around line 323) and before the `<hr>` that precedes AI settings:

```tsx
<hr className="my-4 border-zinc-200 dark:border-zinc-800" />

<div className="mb-4">
  <label className="flex cursor-pointer items-center gap-2">
    <input
      type="checkbox"
      checked={settings.popout.reuseWindow}
      onChange={(e) =>
        onChange({
          ...settings,
          popout: { ...settings.popout, reuseWindow: e.target.checked },
        })
      }
      className="h-4 w-4 rounded border-zinc-300 text-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-600 dark:bg-zinc-800"
    />
    <span className="text-sm text-zinc-700 dark:text-zinc-300">
      {t(lang, "popoutReuseWindow")}
    </span>
  </label>
</div>
```

- [ ] **Step 4: Run tests to verify all 3 pass**

Run: `npx vitest run src/app/settings-menu.test.tsx --reporter=verbose`
Expected: PASS — 3 tests passed

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-menu.tsx src/app/settings-menu.test.tsx
git commit -m "feat(settings-menu): add popout reuse window toggle"
```
