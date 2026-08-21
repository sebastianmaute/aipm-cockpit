# Modern Sidebar Layout — Phase 1 (Chrome) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Dark-Blue left-sidebar + top-bar full-viewport layout as the new default ("modern"), with the current layout preserved as a toggleable "classic" mode, wiring navigation through generalized view state with URL-hash deep-linking.

**Architecture:** All state/handlers stay in `TaskManagerInner`. A new `AppShell` chooses `ClassicShell` (today's exact tree) or `ModernShell` (sidebar + top bar + one full-viewport view) based on `settings.layout`. ModernShell reuses the already-wired `<TasksSection>` (Open Points) and a chromeless `<WorkspaceSection>` (all other panels) — no panel rewiring. Settings stays a top-bar popover and editing stays a modal in Phase 1 (full-page edit view is Phase 2).

**Tech Stack:** Next.js (App Router, client components), React, TypeScript, Tailwind v4 (CSS-var tokens in `globals.css`), Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-29-modern-sidebar-layout-design.md`

**Palette (locked):** only the 9 Acme colors via existing tokens (`AIPM-dark-blue`, `AIPM-green`, `AIPM-white`, `AIPM-light-grey`, `AIPM-medium-grey`, plus `--surface`/`--line`/`--foreground`/`--muted-foreground`). No gradients, no shadows, no off-palette colors.

---

## File Structure

**Create:**
- `src/app/nav-config.ts` — `AppView` type, nav group/item model, slug ↔ view helpers, label-key map.
- `src/app/nav-config.test.ts` — structural invariants.
- `src/app/use-hash-view.ts` — main-window URL-hash ↔ view sync hook.
- `src/app/use-hash-view.test.tsx` — hash sync behavior.
- `src/app/sidebar-nav.tsx` — presentational nested nav (groups, items, expandable parents).
- `src/app/sidebar-nav.test.tsx`
- `src/app/sidebar.tsx` — Dark-Blue sidebar shell (brand header + nav + footer + collapse).
- `src/app/sidebar.test.tsx`
- `src/app/top-bar.tsx` — title + migrated action cluster.
- `src/app/top-bar.test.tsx`
- `src/app/modern-shell.tsx` — sidebar + top bar + full-viewport content host.
- `src/app/modern-shell.test.tsx`
- `src/app/app-shell.tsx` — classic/modern selector.
- `src/app/app-shell.test.tsx`

**Modify:**
- `src/app/settings-menu.tsx` — add `layout` to `Settings` + `defaultSettings`; add Layout segmented control.
- `src/app/use-settings.ts` — coerce `layout` in the merge.
- `src/app/i18n.ts` — new `enUS` keys.
- `src/app/i18n.de.ts` — matching German keys (ASCII-quote-safe; grep-verified).
- `src/app/workspace-tab-context.tsx` — widen `activeTab` type to `AppView` (names unchanged).
- `src/app/workspace-section.tsx` — add `fullBleed?: boolean` prop.
- `src/app/task-manager.tsx` — render `<AppShell>` instead of the inline classic tree.
- `src/app/version.ts` + `CHANGELOG.md` — version bump.

---

## Task 1: `layout` setting field

**Files:**
- Modify: `src/app/settings-menu.tsx:150-172`
- Modify: `src/app/use-settings.ts:44-71`
- Test: `src/app/use-settings.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/app/use-settings.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { defaultSettings } from "./settings-menu";
import { coerceLayout } from "./use-settings";

describe("layout setting", () => {
  it("defaults to modern", () => {
    expect(defaultSettings.layout).toBe("modern");
  });

  it("coerceLayout keeps valid values and falls back to modern", () => {
    expect(coerceLayout("classic")).toBe("classic");
    expect(coerceLayout("modern")).toBe("modern");
    expect(coerceLayout("bogus")).toBe("modern");
    expect(coerceLayout(undefined)).toBe("modern");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-settings.test.ts`
Expected: FAIL — `defaultSettings.layout` is undefined and `coerceLayout` is not exported.

- [ ] **Step 3: Add the field and helper**

In `src/app/settings-menu.tsx`, extend the `Settings` type (after `resources`):

```typescript
export type Settings = {
  language: Lang;
  holidayCountries: string[];
  storageConfig: StorageConfig;
  ai: AiConfig;
  notifications: NotificationsConfig;
  jira: JiraConfig;
  popout: { reuseWindow: boolean };
  resources: { workdayHours: number };
  layout: "modern" | "classic";
  integrations?: IntegrationsSettings;
};
```

Add to `defaultSettings` (before `integrations`):

```typescript
  resources: { workdayHours: 8 },
  layout: "modern",
  integrations: defaultIntegrations,
```

In `src/app/use-settings.ts`, add an exported helper above `useSettings`:

```typescript
export function coerceLayout(value: unknown): "modern" | "classic" {
  return value === "classic" ? "classic" : "modern";
}
```

In the merge object inside the mount effect (the `const merged: Settings = { ... }` block), add the line after `resources: {...}`:

```typescript
            layout: coerceLayout((parsed as Record<string, unknown>).layout),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-menu.tsx src/app/use-settings.ts src/app/use-settings.test.ts
git commit -m "feat: add layout setting (modern default) with coercion"
```

---

## Task 2: i18n keys (en + de)

**Files:**
- Modify: `src/app/i18n.ts` (inside the `enUS` object, before the closing `};` near line ~1038)
- Modify: `src/app/i18n.de.ts` (inside the `de` object)
- Test: `src/app/i18n.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `src/app/i18n.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { t, type TranslationKey } from "./i18n";
import { de } from "./i18n.de";

const NEW_KEYS: TranslationKey[] = [
  "navGroupOverview", "navGroupPlan", "navGroupRegisters", "navGroupSystem",
  "navOpenPoints", "navSettings",
  "layout", "layoutModern", "layoutClassic", "layoutTooltip",
  "sidebarBrandSubtitle", "sidebarCollapse", "sidebarExpand",
];

describe("modern-layout i18n keys", () => {
  it("resolve in en-US", () => {
    for (const k of NEW_KEYS) expect(t("en-US", k)).toBeTruthy();
  });
  it("exist in the German dictionary", () => {
    for (const k of NEW_KEYS) expect(de[k]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/i18n.test.ts`
Expected: FAIL — TypeScript/runtime: keys not present.

- [ ] **Step 3: Add keys to `enUS`**

In `src/app/i18n.ts`, add these lines inside the `enUS` object (e.g. just before the final closing `};` of `enUS`):

```typescript
  navGroupOverview: "OVERVIEW",
  navGroupPlan: "PLAN",
  navGroupRegisters: "REGISTERS",
  navGroupSystem: "SYSTEM",
  navOpenPoints: "Open Points",
  navSettings: "Settings",
  layout: "Layout",
  layoutModern: "Modern",
  layoutClassic: "Classic",
  layoutTooltip: "Switch between the new sidebar layout and the classic layout.",
  sidebarBrandSubtitle: "LIST OF OPEN POINTS",
  sidebarCollapse: "Collapse sidebar",
  sidebarExpand: "Expand sidebar",
```

- [ ] **Step 4: Add matching keys to `de` (ASCII-quote-safe)**

In `src/app/i18n.de.ts`, add inside the `de` object. **Type only straight ASCII double-quotes `"`.** Umlauts in values are fine.

```typescript
  navGroupOverview: "ÜBERSICHT",
  navGroupPlan: "PLANUNG",
  navGroupRegisters: "REGISTER",
  navGroupSystem: "SYSTEM",
  navOpenPoints: "Offene Punkte",
  navSettings: "Einstellungen",
  layout: "Layout",
  layoutModern: "Modern",
  layoutClassic: "Klassisch",
  layoutTooltip: "Wechselt zwischen dem neuen Seitenleisten-Layout und dem klassischen Layout.",
  sidebarBrandSubtitle: "LISTE OFFENER PUNKTE",
  sidebarCollapse: "Seitenleiste einklappen",
  sidebarExpand: "Seitenleiste ausklappen",
```

- [ ] **Step 5: Verify no curly-quote corruption was introduced**

Run: `node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8'); const bad=s.match(/[“”‘’]/g); console.log('smart quotes:', bad? bad.length: 0)"`
Expected: `smart quotes: 0`

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/app/i18n.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/i18n.test.ts
git commit -m "feat: add i18n keys for sidebar nav + layout toggle"
```

---

## Task 3: `nav-config.ts`

**Files:**
- Create: `src/app/nav-config.ts`
- Test: `src/app/nav-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/nav-config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  NAV_GROUPS, viewToSlug, slugToView, navLabelKey, allNavViews,
  type AppView,
} from "./nav-config";

describe("nav-config", () => {
  it("every nav item has a unique slug", () => {
    const slugs = allNavViews().map(viewToSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("slugToView inverts viewToSlug", () => {
    for (const v of allNavViews()) expect(slugToView(viewToSlug(v))).toBe(v);
  });

  it("unknown slug falls back to open-points", () => {
    expect(slugToView("nope")).toBe("open-points");
    expect(slugToView("")).toBe("open-points");
  });

  it("groups expose label keys and children reference known views", () => {
    const known = new Set<AppView>(allNavViews());
    for (const g of NAV_GROUPS) {
      expect(g.labelKey).toBeTruthy();
      for (const item of g.items) {
        expect(navLabelKey(item.view)).toBeTruthy();
        for (const child of item.children ?? []) expect(known.has(child.view)).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/nav-config.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `nav-config.ts`**

Create `src/app/nav-config.ts`:

```typescript
import type { TranslationKey } from "./i18n";

// Superset of the workspace/popout TopTab union. "open-points", "settings"
// and "edit" are main-window-only views. "edit" is reserved for Phase 2
// (full-page task editor) and intentionally has no nav entry yet.
export type AppView =
  | "open-points"
  | "chat"
  | "gantt"
  | "resources"
  | "address-book"
  | "resource-report"
  | "budget"
  | "raid"
  | "raid-report"
  | "reports"
  | "activity"
  | "settings"
  | "edit";

export interface NavItem {
  view: AppView;
  children?: { view: AppView }[];
}

export interface NavGroup {
  labelKey: TranslationKey;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "navGroupOverview",
    items: [{ view: "open-points" }, { view: "chat" }],
  },
  {
    labelKey: "navGroupPlan",
    items: [
      { view: "gantt" },
      {
        view: "resources",
        children: [{ view: "address-book" }, { view: "resource-report" }],
      },
      { view: "budget" },
    ],
  },
  {
    labelKey: "navGroupRegisters",
    items: [
      { view: "raid", children: [{ view: "raid-report" }] },
      { view: "reports" },
    ],
  },
  {
    labelKey: "navGroupSystem",
    items: [{ view: "activity" }, { view: "settings" }],
  },
];

const LABEL_KEYS: Record<Exclude<AppView, "edit">, TranslationKey> = {
  "open-points": "navOpenPoints",
  chat: "tabChat",
  gantt: "tabGantt",
  resources: "tabResources",
  "address-book": "resourcesAddressBookTitle",
  "resource-report": "resourcesReportTitle",
  budget: "tabBudget",
  raid: "tabRaid",
  "raid-report": "raidReportTitle",
  reports: "tabReports",
  activity: "tabActivity",
  settings: "settings", // reuse existing key; no separate navSettings
};

export function navLabelKey(view: AppView): TranslationKey {
  return LABEL_KEYS[view as Exclude<AppView, "edit">] ?? "navOpenPoints";
}

/** Flat list of all views that appear in the sidebar (excludes "edit"). */
export function allNavViews(): AppView[] {
  const out: AppView[] = [];
  for (const g of NAV_GROUPS) {
    for (const item of g.items) {
      out.push(item.view);
      for (const child of item.children ?? []) out.push(child.view);
    }
  }
  return out;
}

export function viewToSlug(view: AppView): string {
  return view; // slugs are the view ids themselves
}

export function slugToView(slug: string): AppView {
  const found = allNavViews().find((v) => viewToSlug(v) === slug);
  return found ?? "open-points";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/nav-config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/nav-config.ts src/app/nav-config.test.ts
git commit -m "feat: add nav-config (AppView model, groups, slug helpers)"
```

---

## Task 4: Widen view context + hash-sync hook

**Files:**
- Modify: `src/app/workspace-tab-context.tsx:5-9`
- Create: `src/app/use-hash-view.ts`
- Test: `src/app/use-hash-view.test.tsx`

- [ ] **Step 1: Widen the context type**

In `src/app/workspace-tab-context.tsx`, import `AppView` and widen the state type (keep names and the `"chat"` default so Classic mode is unaffected):

```typescript
import { type AppView } from "./nav-config";

export type TopTab = "chat" | "reports" | "gantt" | "raid" | "resources" | "activity" | "resource-report" | "raid-report" | "address-book" | "budget";

interface WorkspaceTabContextValue {
  activeTab: AppView;
  setActiveTab: React.Dispatch<React.SetStateAction<AppView>>;
  isPopout: boolean;
}
```

Update the `useState<TopTab>` to `useState<AppView>` (default stays `popoutTab ?? "chat"`).

- [ ] **Step 2: Write the failing test for the hook**

Create `src/app/use-hash-view.test.tsx`:

```typescript
import { renderHook, act } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { useHashView } from "./use-hash-view";

function wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceTabProvider>{children}</WorkspaceTabProvider>;
}

afterEach(() => {
  window.location.hash = "";
});

describe("useHashView", () => {
  it("selects open-points when no hash present", () => {
    window.location.hash = "";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("open-points");
  });

  it("selects the view named by the initial hash", () => {
    window.location.hash = "#gantt";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("gantt");
  });

  it("falls back to open-points on an unknown hash", () => {
    window.location.hash = "#nope";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("open-points");
  });

  it("writes the hash when the view changes", () => {
    window.location.hash = "";
    const { result } = renderHook(
      () => {
        useHashView();
        const ctx = useWorkspaceTab();
        useLayoutEffect(() => { ctx.setActiveTab("raid"); /* eslint-disable-line */ }, []);
        return ctx;
      },
      { wrapper },
    );
    act(() => {});
    expect(window.location.hash).toBe("#raid");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/use-hash-view.test.tsx`
Expected: FAIL — `use-hash-view` module not found.

- [ ] **Step 4: Implement the hook**

Create `src/app/use-hash-view.ts`:

```typescript
"use client";
import { useEffect } from "react";
import { useWorkspaceTab } from "./workspace-tab-context";
import { slugToView, viewToSlug } from "./nav-config";

function hashSlug(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash.replace(/^#/, "");
}

/**
 * Two-way sync between the URL hash and the active view, for the MAIN window
 * only (popouts use the `?popout=` query param and must not be touched).
 * On mount: hash -> view (defaulting to open-points). On view change: view ->
 * hash. Also listens for manual hashchange (back/forward).
 */
export function useHashView(): void {
  const { activeTab, setActiveTab, isPopout } = useWorkspaceTab();

  // Mount + back/forward: hash drives the view.
  useEffect(() => {
    if (isPopout) return;
    const apply = () => setActiveTab(slugToView(hashSlug()));
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [isPopout, setActiveTab]);

  // View change: write the hash (skip the reserved full-page edit view).
  useEffect(() => {
    if (isPopout || activeTab === "edit") return;
    const next = `#${viewToSlug(activeTab)}`;
    if (window.location.hash !== next) window.location.hash = next;
  }, [isPopout, activeTab]);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/use-hash-view.test.tsx src/app/workspace-tab-context.test.tsx`
Expected: PASS (existing context test still passes; default `"chat"` unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/app/workspace-tab-context.tsx src/app/use-hash-view.ts src/app/use-hash-view.test.tsx
git commit -m "feat: widen view context to AppView and add URL-hash sync hook"
```

---

## Task 5: `sidebar-nav.tsx`

**Files:**
- Create: `src/app/sidebar-nav.tsx`
- Test: `src/app/sidebar-nav.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/sidebar-nav.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarNav } from "./sidebar-nav";

describe("SidebarNav", () => {
  it("renders group headers and a top-level item", () => {
    render(<SidebarNav lang="en-US" activeView="open-points" onNavigate={() => {}} />);
    expect(screen.getByText("OVERVIEW")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Points" })).toBeTruthy();
  });

  it("calls onNavigate with the view id when an item is clicked", () => {
    const onNavigate = vi.fn();
    render(<SidebarNav lang="en-US" activeView="open-points" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Gantt" }));
    expect(onNavigate).toHaveBeenCalledWith("gantt");
  });

  it("marks the active item with aria-current", () => {
    render(<SidebarNav lang="en-US" activeView="gantt" onNavigate={() => {}} />);
    expect(screen.getByRole("button", { name: "Gantt" }).getAttribute("aria-current")).toBe("page");
  });

  it("reveals child items when a parent is active", () => {
    render(<SidebarNav lang="en-US" activeView="resources" onNavigate={() => {}} />);
    expect(screen.getByRole("button", { name: "Address Book" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/sidebar-nav.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sidebar-nav.tsx`**

Create `src/app/sidebar-nav.tsx`:

```typescript
"use client";
import { type Lang, t } from "./i18n";
import { NAV_GROUPS, navLabelKey, type AppView, type NavItem } from "./nav-config";

interface SidebarNavProps {
  lang: Lang;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  collapsed?: boolean;
}

function isParentActive(item: NavItem, active: AppView): boolean {
  if (item.view === active) return true;
  return (item.children ?? []).some((c) => c.view === active);
}

export function SidebarNav({ lang, activeView, onNavigate, collapsed = false }: SidebarNavProps) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-4 py-2">
      {NAV_GROUPS.map((group) => (
        <div key={group.labelKey}>
          {!collapsed && (
            <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-AIPM-medium-grey">
              {t(lang, group.labelKey)}
            </p>
          )}
          <ul>
            {group.items.map((item) => {
              const active = activeView === item.view;
              const showChildren = !collapsed && isParentActive(item, activeView);
              return (
                <li key={item.view}>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.view)}
                    aria-current={active ? "page" : undefined}
                    className={
                      "flex w-full items-center gap-2 border-l-2 px-4 py-2 text-left text-sm transition-colors " +
                      (active
                        ? "border-AIPM-green bg-AIPM-green/15 font-semibold text-AIPM-white"
                        : "border-transparent text-AIPM-light-grey hover:bg-AIPM-white/10 hover:text-AIPM-white")
                    }
                  >
                    {t(lang, navLabelKey(item.view))}
                  </button>
                  {showChildren && (
                    <ul>
                      {item.children!.map((child) => {
                        const childActive = activeView === child.view;
                        return (
                          <li key={child.view}>
                            <button
                              type="button"
                              onClick={() => onNavigate(child.view)}
                              aria-current={childActive ? "page" : undefined}
                              className={
                                "flex w-full items-center gap-2 border-l-2 py-1.5 pl-9 pr-4 text-left text-sm transition-colors " +
                                (childActive
                                  ? "border-AIPM-green bg-AIPM-green/15 font-semibold text-AIPM-white"
                                  : "border-transparent text-AIPM-medium-grey hover:bg-AIPM-white/10 hover:text-AIPM-white")
                              }
                            >
                              {t(lang, navLabelKey(child.view))}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/sidebar-nav.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/sidebar-nav.tsx src/app/sidebar-nav.test.tsx
git commit -m "feat: add nested SidebarNav component"
```

---

## Task 6: `sidebar.tsx`

**Files:**
- Create: `src/app/sidebar.tsx`
- Test: `src/app/sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/sidebar.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";

describe("Sidebar", () => {
  const base = {
    lang: "en-US" as const,
    activeView: "open-points" as const,
    onNavigate: () => {},
    collapsed: false,
    onToggleCollapsed: () => {},
    version: "v0.29.0",
  };

  it("renders the brand subtitle and version", () => {
    render(<Sidebar {...base} />);
    expect(screen.getByText("LIST OF OPEN POINTS")).toBeTruthy();
    expect(screen.getByText("v0.29.0")).toBeTruthy();
  });

  it("toggles collapse when the collapse button is clicked", () => {
    const onToggleCollapsed = vi.fn();
    render(<Sidebar {...base} onToggleCollapsed={onToggleCollapsed} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onToggleCollapsed).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/sidebar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sidebar.tsx`**

Create `src/app/sidebar.tsx`:

```typescript
"use client";
import { type Lang, t } from "./i18n";
import { SidebarNav } from "./sidebar-nav";
import type { AppView } from "./nav-config";

interface SidebarProps {
  lang: Lang;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  version: string;
  footer?: React.ReactNode;
}

export function Sidebar({
  lang, activeView, onNavigate, collapsed, onToggleCollapsed, version, footer,
}: SidebarProps) {
  return (
    <aside
      className={
        "flex h-full flex-col bg-AIPM-dark-blue text-AIPM-white " +
        (collapsed ? "w-16" : "w-64")
      }
    >
      <div className="flex items-start justify-between gap-2 border-b border-AIPM-white/10 px-4 py-4">
        {!collapsed && (
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/AIPM-logo.svg" alt="Acme" className="h-6 w-auto brightness-0 invert" />
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-AIPM-green">
              {t(lang, "sidebarBrandSubtitle")}
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? t(lang, "sidebarExpand") : t(lang, "sidebarCollapse")}
          title={collapsed ? t(lang, "sidebarExpand") : t(lang, "sidebarCollapse")}
          className="rounded-md p-1.5 text-AIPM-light-grey hover:bg-AIPM-white/10 hover:text-AIPM-white focus:outline-none focus:ring-2 focus:ring-AIPM-green"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
            <path fillRule="evenodd" d="M12.78 5.22a.75.75 0 010 1.06L9.06 10l3.72 3.72a.75.75 0 11-1.06 1.06l-4.25-4.25a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav lang={lang} activeView={activeView} onNavigate={onNavigate} collapsed={collapsed} />
      </div>

      <div className="border-t border-AIPM-white/10 px-4 py-3 text-xs text-AIPM-medium-grey">
        {footer}
        {!collapsed && <p className="mt-2">{version}</p>}
      </div>
    </aside>
  );
}
```

Note: the logo is the existing `/AIPM-logo.svg`; `brightness-0 invert` renders it white on Dark Blue without introducing a new asset or color. If a dedicated white logo asset exists later, swap the `<img src>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/sidebar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/sidebar.tsx src/app/sidebar.test.tsx
git commit -m "feat: add Dark-Blue Sidebar shell with brand header and collapse"
```

---

## Task 7: `top-bar.tsx`

**Files:**
- Create: `src/app/top-bar.tsx`
- Test: `src/app/top-bar.test.tsx`

This reuses the action-cluster pattern from `app-header.tsx:71-140`. The TopBar takes a resolved `title` string plus the same callback props the header uses, and renders the New/alerts buttons (the menu components — Export/Help/Version/Settings/Voice — are passed in as a `children` slot to avoid duplicating their large prop lists).

- [ ] **Step 1: Write the failing test**

Create `src/app/top-bar.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TopBar } from "./top-bar";

describe("TopBar", () => {
  const base = {
    lang: "en-US" as const,
    title: "Gantt",
    bannerCount: 0,
    onNewTask: () => {},
    onShowAlerts: () => {},
  };

  it("renders the view title", () => {
    render(<TopBar {...base} />);
    expect(screen.getByRole("heading", { name: "Gantt" })).toBeTruthy();
  });

  it("calls onNewTask when the add button is clicked", () => {
    const onNewTask = vi.fn();
    render(<TopBar {...base} onNewTask={onNewTask} />);
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(onNewTask).toHaveBeenCalled();
  });

  it("shows the alert badge count when > 0", () => {
    render(<TopBar {...base} bannerCount={3} />);
    expect(screen.getByText("3")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/top-bar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `top-bar.tsx`**

Create `src/app/top-bar.tsx`:

```typescript
"use client";
import { type Lang, t } from "./i18n";

interface TopBarProps {
  lang: Lang;
  title: string;
  bannerCount: number;
  onNewTask: () => void;
  onShowAlerts: () => void;
  /** Menu components (Export/Help/Version/Settings/Voice) rendered as-is. */
  children?: React.ReactNode;
}

export function TopBar({ lang, title, bannerCount, onNewTask, onShowAlerts, children }: TopBarProps) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line bg-surface px-6 py-3">
      <h1 className="text-xl font-semibold tracking-tight text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {title}
      </h1>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onNewTask}
          aria-label={t(lang, "addTask")}
          title={t(lang, "addTask")}
          className="rounded-md bg-AIPM-green px-3 py-1.5 text-sm font-semibold text-AIPM-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-green"
        >
          {t(lang, "newTask")}
        </button>
        <button
          type="button"
          onClick={onShowAlerts}
          aria-label={t(lang, "showDueAlerts")}
          title={t(lang, "showDueAlerts")}
          className="relative rounded-md p-2 text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-AIPM-medium-grey dark:hover:text-AIPM-light-grey"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
            <path d="M10 2a6 6 0 00-6 6v2.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 10.586V8a6 6 0 00-6-6zM8 15a2 2 0 104 0H8z" />
          </svg>
          {bannerCount > 0 && (
            <span aria-hidden className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-AIPM-pink px-1 text-[10px] font-semibold leading-none text-AIPM-white">
              {bannerCount}
            </span>
          )}
        </button>
        {children}
      </div>
    </header>
  );
}
```

Note: the `Add task` accessible name comes from `aria-label={t(lang,"addTask")}`; the visible label uses `newTask`. The test queries by the `addTask` accessible name.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/top-bar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/top-bar.tsx src/app/top-bar.test.tsx
git commit -m "feat: add TopBar with title and primary actions"
```

---

## Task 8: `fullBleed` prop on `WorkspaceSection`

**Files:**
- Modify: `src/app/workspace-section.tsx:53-160` (props + tab strip + wrapper)
- Test: `src/app/workspace-section.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/app/workspace-section.test.tsx` a case asserting the tab strip is absent when `fullBleed` is set. (Match the existing render/provider setup already used in that file; reuse its `renderWorkspace`/wrapper helper.)

```typescript
it("hides the tab strip in fullBleed mode", () => {
  renderWorkspace({ fullBleed: true }); // pass-through to <WorkspaceSection fullBleed />
  expect(screen.queryByRole("tablist", { name: "Workspace tabs" })).toBeNull();
});
```

If the existing test file has no `fullBleed` pass-through, extend its render helper to forward the prop.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/workspace-section.test.tsx`
Expected: FAIL — tablist still rendered.

- [ ] **Step 3: Add the prop and gate the chrome**

In `src/app/workspace-section.tsx`, add `fullBleed?: boolean;` to `WorkspaceSectionProps`, default it `false` in the destructure, then:

1. Change the `<section>` className: when `fullBleed`, use `"flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface"` (no border, no resize, no fixed height).
2. Gate the tab strip: change `{!isPopout && (` wrapping the `role="tablist"` block to `{!isPopout && !fullBleed && (`.
3. Gate the resize handle (`⠿`) and reset/collapse buttons the same way (`!fullBleed`).
4. In the panels container, when `fullBleed`, ignore `workspaceCollapsed` (always show): `hidden={!isPopout && !fullBleed && workspaceCollapsed}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/workspace-section.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-section.tsx src/app/workspace-section.test.tsx
git commit -m "feat: add fullBleed (chromeless) mode to WorkspaceSection"
```

---

## Task 9: `modern-shell.tsx`

**Files:**
- Create: `src/app/modern-shell.tsx`
- Test: `src/app/modern-shell.test.tsx`

ModernShell composes Sidebar + TopBar + content. It receives the already-built `tasksSection`, `workspace`, and `topBarMenus` React nodes from `TaskManagerInner` (so no panel rewiring), plus nav/title state. Content rule: `open-points` → `tasksSection`; everything else → `workspace` (chromeless, already bound to `activeView`). The `settings` view is handled by the caller (Phase 1 opens the existing Settings popover from `topBarMenus`); a dedicated settings view is Phase 4.

- [ ] **Step 1: Write the failing test**

Create `src/app/modern-shell.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModernShell } from "./modern-shell";

function setup(over: Partial<React.ComponentProps<typeof ModernShell>> = {}) {
  const onNavigate = vi.fn();
  render(
    <ModernShell
      lang="en-US"
      activeView="open-points"
      onNavigate={onNavigate}
      version="v0.29.0"
      bannerCount={0}
      onNewTask={() => {}}
      onShowAlerts={() => {}}
      topBarMenus={<div data-testid="menus" />}
      sidebarFooter={null}
      tasksSection={<div data-testid="tasks" />}
      workspace={<div data-testid="workspace" />}
      {...over}
    />,
  );
  return { onNavigate };
}

describe("ModernShell", () => {
  it("shows the tasks section for the open-points view", () => {
    setup({ activeView: "open-points" });
    expect(screen.getByTestId("tasks")).toBeTruthy();
    expect(screen.queryByTestId("workspace")).toBeNull();
  });

  it("shows the workspace for other views", () => {
    setup({ activeView: "gantt" });
    expect(screen.getByTestId("workspace")).toBeTruthy();
    expect(screen.queryByTestId("tasks")).toBeNull();
  });

  it("navigates when a sidebar item is clicked", () => {
    const { onNavigate } = setup({ activeView: "open-points" });
    fireEvent.click(screen.getByRole("button", { name: "RAID" }));
    expect(onNavigate).toHaveBeenCalledWith("raid");
  });

  it("uses the active view's label as the top-bar title", () => {
    setup({ activeView: "gantt" });
    expect(screen.getByRole("heading", { name: "Gantt" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/modern-shell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `modern-shell.tsx`**

Create `src/app/modern-shell.tsx`:

```typescript
"use client";
import { type Lang, t } from "./i18n";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { navLabelKey, type AppView } from "./nav-config";

interface ModernShellProps {
  lang: Lang;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  version: string;
  bannerCount: number;
  onNewTask: () => void;
  onShowAlerts: () => void;
  topBarMenus: React.ReactNode;
  sidebarFooter: React.ReactNode;
  tasksSection: React.ReactNode;
  workspace: React.ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function ModernShell({
  lang, activeView, onNavigate, version, bannerCount, onNewTask, onShowAlerts,
  topBarMenus, sidebarFooter, tasksSection, workspace,
  collapsed = false, onToggleCollapsed = () => {},
}: ModernShellProps) {
  const title = t(lang, navLabelKey(activeView));
  const content = activeView === "open-points" ? tasksSection : workspace;
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        lang={lang}
        activeView={activeView}
        onNavigate={onNavigate}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        version={version}
        footer={sidebarFooter}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          lang={lang}
          title={title}
          bannerCount={bannerCount}
          onNewTask={onNewTask}
          onShowAlerts={onShowAlerts}
        >
          {topBarMenus}
        </TopBar>
        <main className="min-h-0 flex-1 overflow-auto bg-surface-muted p-6 dark:bg-black">
          {content}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/modern-shell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/modern-shell.tsx src/app/modern-shell.test.tsx
git commit -m "feat: add ModernShell (sidebar + top bar + view content host)"
```

---

## Task 10: `app-shell.tsx` + wire into `TaskManagerInner`

**Files:**
- Create: `src/app/app-shell.tsx`
- Test: `src/app/app-shell.test.tsx`
- Modify: `src/app/task-manager.tsx` (the `return` of `TaskManagerInner`, ~line 597 onward)

- [ ] **Step 1: Write the failing test for the selector**

Create `src/app/app-shell.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("renders the classic tree when layout is classic", () => {
    render(<AppShell layout="classic" classic={<div data-testid="classic" />} modern={<div data-testid="modern" />} />);
    expect(screen.getByTestId("classic")).toBeTruthy();
    expect(screen.queryByTestId("modern")).toBeNull();
  });

  it("renders the modern shell when layout is modern", () => {
    render(<AppShell layout="modern" classic={<div data-testid="classic" />} modern={<div data-testid="modern" />} />);
    expect(screen.getByTestId("modern")).toBeTruthy();
    expect(screen.queryByTestId("classic")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/app-shell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `app-shell.tsx`**

Create `src/app/app-shell.tsx`:

```typescript
"use client";

interface AppShellProps {
  layout: "modern" | "classic";
  classic: React.ReactNode;
  modern: React.ReactNode;
}

export function AppShell({ layout, classic, modern }: AppShellProps) {
  return <>{layout === "classic" ? classic : modern}</>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/app-shell.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire `TaskManagerInner` to use the shells**

In `src/app/task-manager.tsx`:

1. Add imports near the other component imports:

```typescript
import { AppShell } from "./app-shell";
import { ModernShell } from "./modern-shell";
import { useHashView } from "./use-hash-view";
import { APP_VERSION } from "./version";
```

(Use the existing version export name from `version.ts`; if it differs, import that symbol. See the "Open follow-ups" note in Self-Review.)

2. Inside `TaskManagerInner`, ensure `activeTab`/`setActiveTab` are in scope via `useWorkspaceTab()` and call the hash-sync hook (no-op for popouts):

```typescript
  const { activeTab, setActiveTab } = useWorkspaceTab();
  useHashView();
```

3. Keep the popout early-return unchanged. For the main-window return, extract the existing JSX into shared local elements so neither shell duplicates prop wiring:

- `const tasksSectionEl = <TasksSection {...} />` — the exact `<TasksSection>` element currently rendered (with all its current props).
- `const workspaceProps = { ...the exact props currently passed to <WorkspaceSection> }`. Then `const workspaceEl = <WorkspaceSection {...workspaceProps} />` (classic) and `const workspaceFullBleedEl = <WorkspaceSection {...workspaceProps} fullBleed />` (modern).
- `const modalsBlock = (<>{/* the existing <OutlookImportModal/>, <OutlookCalendarImportModal/>, <AppModals/> group, unchanged */}</>)`.
- `const topBarMenus = (<>{/* VoiceCommandButton + ExportMenu + HelpMenu + VersionMenu + SettingsMenu, with the same props AppHeader passes today */}</>)`. Import the dynamic `VoiceCommandButton` here exactly as in `app-header.tsx:15-18`.

Then build the two trees and select between them:

```tsx
  const classicTree = (
    <div className="mx-auto w-full max-w-[1536px] p-6 sm:p-10">
      {/* existing AppHeader + banners */}
      {/* ...existing banner JSX... */}
      {workspaceEl}
      {tasksSectionEl}
      {modalsBlock}
    </div>
  );

  const modernTree = (
    <>
      <ModernShell
        lang={lang}
        activeView={activeTab}
        onNavigate={(v) => setActiveTab(v)}
        version={APP_VERSION}
        bannerCount={bannerItems.length}
        onNewTask={() => { handleCancelEdit(); setTaskModalOpen(true); }}
        onShowAlerts={() => { setBannerDismissed(false); setDueModalOpen(true); }}
        topBarMenus={topBarMenus}
        sidebarFooter={null}
        tasksSection={tasksSectionEl}
        workspace={workspaceFullBleedEl}
      />
      {modalsBlock}
    </>
  );

  return (
    <VoiceCommandProvider value={voiceHandlers}>
      <AppShell layout={settings.layout} classic={classicTree} modern={modernTree} />
    </VoiceCommandProvider>
  );
```

Notes:
- `classicTree` must reproduce TODAY's exact main-window JSX (the current `<div className="mx-auto ...">` block including `<AppHeader>`, the `DueBanner`/`BirthdayBanner`/`JiraTokenBanner` conditionals, `WorkspaceSection`, `TasksSection`, and the modal group). Move it verbatim — do not restyle it. This is the Phase 1 guarantee that classic mode is unchanged.
- The banners are intentionally omitted from `modernTree` for Phase 1 (the top-bar bell + due modal cover alerts); revisit in Phase 4 if banner parity is wanted in modern mode.
- `modalsBlock` is rendered once per tree so overlays work in both modes.

- [ ] **Step 6: Add a shell-selection regression test**

Create `src/app/task-manager.shell.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import TaskManager from "./task-manager";

function setLayout(layout: "modern" | "classic") {
  window.localStorage.setItem("lop-app:settings", JSON.stringify({ layout }));
}

describe("TaskManager shell selection", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders the sidebar brand in modern mode (default)", async () => {
    render(<TaskManager />);
    expect(await screen.findByText("LIST OF OPEN POINTS")).toBeTruthy();
  });

  it("renders the classic layout (no sidebar brand) in classic mode", async () => {
    setLayout("classic");
    render(<TaskManager />);
    // settings hydrate from localStorage asynchronously; assert after a tick.
    expect(await screen.findByRole("button", { name: "Add task" })).toBeTruthy();
    expect(screen.queryByText("LIST OF OPEN POINTS")).toBeNull();
  });
});
```

If the full `TaskManager` render pulls browser-only deps that error under jsdom, narrow each assertion to the `Primary` nav landmark (`screen.queryByRole("navigation", { name: "Primary" })`) — present in modern, absent in classic — rather than deleting the test.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS (all new + existing tests).

- [ ] **Step 8: Typecheck and lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: no errors. (Do not edit `eslint.config.mjs` — it is hook-protected; if a rule blocks, fix the code, not the config.)

- [ ] **Step 9: Commit**

```bash
git add src/app/app-shell.tsx src/app/app-shell.test.tsx src/app/task-manager.tsx src/app/task-manager.shell.test.tsx
git commit -m "feat: select modern/classic shell from settings.layout"
```

---

## Task 11: Settings toggle UI + version bump + changelog

**Files:**
- Modify: `src/app/settings-menu.tsx` (add Layout control near the Theme control, ~line 304-316)
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the failing test**

Create `src/app/settings-menu.layout.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsMenu, defaultSettings } from "./settings-menu";

function noop() {}
const asyncNoop = async () => {};

describe("SettingsMenu layout control", () => {
  it("calls onChange with the chosen layout", () => {
    const onChange = vi.fn();
    render(
      <SettingsMenu
        settings={{ ...defaultSettings, layout: "modern" }}
        onChange={onChange}
        storageDescription={null}
        storageReady
        onPickStorageFile={asyncNoop}
        onOpenStorageFile={asyncNoop}
        onGrantStorageWrite={asyncNoop}
        onRequestStorageSwitch={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Classic" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ layout: "classic" }));
  });
});
```

If opening the menu uses a different accessible name than "Settings", match the existing trigger's `aria-label`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/settings-menu.layout.test.tsx`
Expected: FAIL — no "Classic" control.

- [ ] **Step 3: Add the Layout segmented control**

In `src/app/settings-menu.tsx`, directly after the Theme `SegmentedControl` block (around line 316), add:

```tsx
          <label className="mt-4 flex items-center gap-1 text-sm font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
            {t(lang, "layout")}
            <InfoTooltip text={t(lang, "layoutTooltip")} />
          </label>
          <SegmentedControl<"modern" | "classic">
            value={settings.layout}
            ariaLabel={t(lang, "layout")}
            title={t(lang, "layoutTooltip")}
            onChange={(v) => onChange({ ...settings, layout: v })}
            options={[
              { value: "modern", label: t(lang, "layoutModern") },
              { value: "classic", label: t(lang, "layoutClassic") },
            ]}
          />
```

(Match the exact prop names/generic usage from the adjacent Theme `SegmentedControl` — see `settings-menu.tsx:307-316`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/settings-menu.layout.test.tsx`
Expected: PASS

- [ ] **Step 5: Bump version + changelog**

Update the version constant in `src/app/version.ts` to the next minor (e.g. `0.29.0`) and add a `CHANGELOG.md` entry continuing the existing codename-chain style. Keep the in-app version display (sidebar footer + `VersionMenu`) consistent with `version.ts`.

- [ ] **Step 6: Run the full suite + typecheck + lint**

Run: `npx vitest run && npx tsc --noEmit && npx next lint`
Expected: all green.

- [ ] **Step 7: Manual verification (modern default)**

Run: `npm run dev`, open the app:
- Sidebar (Dark Blue) with OVERVIEW/PLAN/REGISTERS/SYSTEM groups; Open Points is the home view.
- Clicking Resources expands Address Book + Resource Report; clicking RAID expands RAID Report.
- URL hash updates (`#gantt`, `#raid`, …); reloading a hash restores the view; back/forward works.
- Top bar shows the view title and New/alerts/menus; New opens the task modal; alerts opens the due list.
- Settings → Layout → Classic instantly reverts to the exact current layout; switching back to Modern restores the sidebar. Setting persists across reload.
- Toggle dark mode: sidebar stays Dark Blue; content surfaces follow the theme. Confirm no off-palette colors, gradients, or shadows were introduced.
- Popout windows (Gantt/RAID/Reports) still open and stay in sync.

- [ ] **Step 8: Commit**

```bash
git add src/app/settings-menu.tsx src/app/settings-menu.layout.test.tsx src/app/version.ts CHANGELOG.md
git commit -m "feat: add layout toggle to settings; bump version for modern layout phase 1"
```

---

## Self-Review

**Spec coverage (Phase 1 scope):**
- Layout setting + default modern + backward-compatible merge → Task 1. ✓
- Dark-Blue sidebar, nested nav, brand header, collapse, footer/version → Tasks 5, 6. ✓
- Top bar with title + migrated actions → Task 7. ✓
- Full-viewport one-view content; Open Points home; panels reused full-bleed → Tasks 8, 9. ✓
- Generalized view state (`AppView`) + URL-hash deep-linking, popout untouched → Tasks 3, 4. ✓
- Classic mode = today's exact tree, selectable via toggle → Tasks 10, 11. ✓
- Palette-only styling, no gradients/shadows → enforced in component classes (Tasks 5-7, 9) + manual check (Task 11 Step 7). ✓
- i18n en + de with curly-quote safeguard → Task 2. ✓
- Tests for shell switching, nav, hash sync, top bar → Tasks 4, 5, 7, 9, 10. ✓
- Phase 2 (full-page edit) / Phase 3 (table restyle) / Phase 4 (responsive, settings view, banner parity) explicitly deferred. ✓

**Placeholder scan:** The only intentionally non-literal spot is Task 10 Step 5, where `classicTree`/`workspaceProps`/`modalsBlock`/`topBarMenus` reference existing JSX that must be moved verbatim rather than re-typed (re-printing ~200 lines of unchanged prop wiring would be error-prone and is exactly the current code). Concrete extraction guidance and the exact selector wiring are provided. No "TBD"/"handle edge cases"/"add validation" placeholders remain.

**Type consistency:** `AppView` (Task 3) is used consistently in Tasks 4, 5, 6, 9. `coerceLayout` (Task 1) returns the same `"modern" | "classic"` union used by `Settings.layout`, `AppShell` (Task 10), and the `SegmentedControl` generic (Task 11). `navLabelKey`/`viewToSlug`/`slugToView`/`allNavViews` signatures match across Tasks 3, 4, 5, 9. Context field names (`activeTab`/`setActiveTab`) unchanged; only the type widened.

**Open follow-ups for execution (verify against the actual code before relying on the literal token):**
- The exact version-constant symbol exported by `version.ts` (used in Task 10 import + Task 11 bump) — grep `version.ts` and use that name (the plan assumes `APP_VERSION`).
- The Settings menu trigger's accessible name (Task 11 test query assumes "Settings").
- The existing `workspace-section.test.tsx` render helper's prop pass-through (Task 8 test).
