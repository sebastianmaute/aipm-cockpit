# Modern Sidebar Layout — Phase 4 (Shell Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the modern sidebar genuinely responsive and accessible — a working collapsible icon rail (auto-collapsing on narrow screens), a top-bar menu button, skip-link + landmarks, and a fuller sidebar footer (theme toggle, storage status, account/sign-out) — shipping as v0.32.0.

**Architecture:** Two new hooks (`useMediaQuery`, `useSidebarCollapsed`) own the responsive collapse state (persisted, viewport-aware). `sidebar-nav` gains a per-view `NavIcon` so the collapsed `w-16` rail shows icons (not clipped text). `top-bar` gets a menu/hamburger button wired to the same toggle; `modern-shell` adds a skip-link and `id` target on `<main>`. A new `SidebarFooter` reuses the existing `SegmentedControl` theme control, storage status, and `useMsAuth` sign-out. The collapse button — currently a **no-op** because `task-manager.tsx` never passes `collapsed`/`onToggleCollapsed` to `ModernShell` — is finally wired up.

**Tech Stack:** Next.js 16 (App Router), React, TypeScript, Tailwind v4 (CSS-var tokens), Vitest + React Testing Library.

**Scope:** Workstream **A only** (shell a11y + responsive collapse). Deferred to follow-on plans: B (full-page Settings view), C (DRY menu-cluster + banner parity), D (divergent-table sweep).

**Hard constraints (carried):**
- **Palette locked:** only the 9 Acme colors via existing tokens (`AIPM-dark-grey #636362`, `AIPM-dark-blue #004159`, `AIPM-green #84BD00`, `AIPM-white #FFFFFF`, `AIPM-light-grey #E3E6E6`, `AIPM-medium-grey #939598`, `AIPM-blue #60C0DD`, `AIPM-pink #E5497C`, `AIPM-purple #AA4899`) + semantic `surface`/`surface-muted`/`line`/`foreground`/`muted-foreground`. Opacity modifiers (e.g. `bg-AIPM-white/10`) are allowed. **No gradients, no drop shadows, no off-palette hex.** Dark-mode neutral surfaces (`#121619`/`#1b2024`/`#2b3137`) already exist in `globals.css` `.dark` and are the only exception.
- **i18n:** every new label goes through `t(lang, ...)` with keys in BOTH `i18n.ts` and `i18n.de.ts`. `i18n.de.ts` is prone to ASCII `"` → curly-quote corruption when edited — byte-patch carefully and grep-verify after every change.
- **No new routing framework**; popout (`?popout=`) and Classic mode must stay unaffected.

**Baseline facts (verified against the repo):**
- `task-manager.tsx:952–972` renders `<ModernShell .../>` with `sidebarFooter={null}` and **no** `collapsed`/`onToggleCollapsed` props. `TaskManagerInner` owns `activeTab`/`setActiveTab`, `settings`, storage props, etc.
- `sidebar.tsx` already has a collapse `<button>` (aria-expanded/aria-label, `sidebarExpand`/`sidebarCollapse` keys) and renders `w-16` when collapsed; footer area renders `{footer}` then `{!collapsed && <p>{version}</p>}`.
- `sidebar-nav.tsx` collapsed currently only hides group headers; item buttons still render **text** (clips in `w-16`). Has `<nav aria-label="Primary">`, `aria-current="page"` on active items, `role="list"`. Line 10 TODO: "icon-only rail when collapsed".
- `top-bar.tsx` `<header>` has New-task + alerts buttons; **no** menu button.
- `modern-shell.tsx` has `<main className="... bg-surface-muted p-6 dark:bg-black">` with **no `id`** and **no skip-link**; already accepts `collapsed`/`onToggleCollapsed` (defaulted to `false`/no-op).
- No `useMediaQuery` hook exists (`use-theme.tsx` uses `window.matchMedia` directly). `use-workspace-collapsed.ts` is the localStorage-persistence pattern to mirror (key `lop-app:workspace-collapsed`).
- Theme control: `SegmentedControl<Theme>` from `./segmented-control`, driven by `useTheme()` (`{ theme, setTheme }` from `./use-theme`; `Theme` from `./theme`). Currently only inside `settings-menu.tsx:316–333`.
- M365: `useMsAuth(enabled: boolean)` (from `./use-ms-auth`) returns `{ account: AccountInfo | null, ready, signIn, signOut, acquireToken }`; `account.username` is the display string; `signOut()` returns a Promise. `settings-menu.tsx:216` calls `const auth = useMsAuth(m365.enabled)` and renders `auth.account ? (… {auth.account.username} … onClick={() => { void auth.signOut(); }})`. Storage status: `storageDescription: string | null`, `storageReady: boolean` (already threaded into `AppHeader`).
- i18n: existing keys at `i18n.ts:1042–1054` (`navGroupOverview/Plan/Registers/System`, `navPrimaryLabel`, `navOpenPoints`, `sidebarBrandSubtitle`, `sidebarCollapse`, `sidebarExpand`); theme keys `theme`/`themeHint`/`themeLight`/`themeDark`/`themeSystem` exist; `integrationsM365SignedInAs` exists. `TranslationKey = keyof typeof enUS` (`i18n.ts:1057`). No hamburger/skip-link/sign-out-in-footer key exists yet.
- `APP_VERSION = "0.31.0"` (`version.ts:361`).

---

## Task 1: `useMediaQuery` hook

**Files:**
- Create: `src/app/use-media-query.ts`
- Test: `src/app/use-media-query.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/use-media-query.test.tsx
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMediaQuery } from "./use-media-query";

let listeners: Array<() => void> = [];
let currentMatches = false;

beforeEach(() => {
  listeners = [];
  currentMatches = false;
  // jsdom has no matchMedia — install a controllable mock (mirrors use-theme.test.tsx).
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: currentMatches,
    media: query,
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: () => void) => {
      listeners = listeners.filter((l) => l !== cb);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});

describe("useMediaQuery", () => {
  it("returns the live match state after mount", () => {
    currentMatches = true;
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(true);
  });

  it("reacts when the media query changes", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(false);
    act(() => {
      currentMatches = true;
      listeners.forEach((l) => l());
    });
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-media-query.test.tsx`
Expected: FAIL — `Cannot find module './use-media-query'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/use-media-query.ts
"use client";
import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query. Returns `false` during SSR and the first
 * client render (avoids hydration mismatch), then the live match after mount.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);

  return matches;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-media-query.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/use-media-query.ts src/app/use-media-query.test.tsx
git commit -m "feat: add useMediaQuery hook"
```

---

## Task 2: `useSidebarCollapsed` hook

**Files:**
- Create: `src/app/use-sidebar-collapsed.ts`
- Test: `src/app/use-sidebar-collapsed.test.tsx`

Behavior: default follows the viewport (collapsed below the breakpoint); an explicit user toggle is persisted to `localStorage` and wins over the responsive default.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/use-sidebar-collapsed.test.tsx
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSidebarCollapsed, SIDEBAR_NARROW_QUERY } from "./use-sidebar-collapsed";

let narrow = false;

beforeEach(() => {
  narrow = false;
  window.localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === SIDEBAR_NARROW_QUERY ? narrow : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});

describe("useSidebarCollapsed", () => {
  it("defaults to expanded on a wide viewport", () => {
    narrow = false;
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current.collapsed).toBe(false);
  });

  it("defaults to collapsed on a narrow viewport", () => {
    narrow = true;
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current.collapsed).toBe(true);
  });

  it("toggle flips and persists an explicit preference that wins over the viewport", () => {
    narrow = false;
    const { result } = renderHook(() => useSidebarCollapsed());
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(window.localStorage.getItem("lop-app:sidebar-collapsed")).toBe("1");
  });

  it("hydrates a persisted preference on mount", () => {
    window.localStorage.setItem("lop-app:sidebar-collapsed", "0");
    narrow = true; // viewport says collapse, but the stored pref says expanded
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current.collapsed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-sidebar-collapsed.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/use-sidebar-collapsed.ts
"use client";
import { useCallback, useEffect, useState } from "react";
import { useMediaQuery } from "./use-media-query";

const SIDEBAR_COLLAPSED_KEY = "lop-app:sidebar-collapsed";
/** Below this width the sidebar defaults to its collapsed icon rail (Tailwind < lg). */
export const SIDEBAR_NARROW_QUERY = "(max-width: 1023px)";

/**
 * Owns the modern sidebar's collapsed state. The default follows the viewport
 * (collapsed on narrow screens); an explicit user toggle is persisted to
 * localStorage and overrides the responsive default.
 */
export function useSidebarCollapsed(): { collapsed: boolean; toggle: () => void } {
  const isNarrow = useMediaQuery(SIDEBAR_NARROW_QUERY);
  const [pref, setPref] = useState<boolean | null>(null);

  // Hydrate the persisted preference once on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (raw === "1") setPref(true);
      else if (raw === "0") setPref(false);
    } catch {
      /* non-fatal */
    }
  }, []);

  const collapsed = pref ?? isNarrow;

  const toggle = useCallback(() => {
    setPref((prev) => {
      const next = !(prev ?? isNarrow);
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }, [isNarrow]);

  return { collapsed, toggle };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-sidebar-collapsed.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/use-sidebar-collapsed.ts src/app/use-sidebar-collapsed.test.tsx
git commit -m "feat: add useSidebarCollapsed hook (responsive + persisted)"
```

---

## Task 3: Wire collapse state into the shell (fix the no-op)

**Files:**
- Modify: `src/app/task-manager.tsx` (import + hook call + two new props on `<ModernShell>`)
- Test: `src/app/modern-shell.test.tsx` (add a prop-forwarding test)

The collapse button is dead today because `task-manager` never passes `collapsed`/`onToggleCollapsed`. Wire the Task-2 hook through.

- [ ] **Step 1: Write the failing test** (add to `modern-shell.test.tsx`, inside `describe("ModernShell", ...)`)

```tsx
  it("forwards collapsed to the sidebar (brand subtitle hidden, expand button shown)", () => {
    setup({ collapsed: true });
    expect(screen.queryByText("LIST OF OPEN POINTS")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("calls onToggleCollapsed when the sidebar collapse button is clicked", () => {
    const onToggleCollapsed = vi.fn();
    setup({ collapsed: false, onToggleCollapsed });
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onToggleCollapsed).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/modern-shell.test.tsx`
Expected: These exercise `ModernShell`'s existing forwarding via `{...over}`. If they already pass, that only proves the shell forwards — the real fix is the `task-manager` wiring in Step 3, for which these tests lock the contract. If `setup` needs `collapsed`/`onToggleCollapsed` to be accepted, they already flow through `{...over}`.

- [ ] **Step 3: Wire `task-manager.tsx`**

Add the import near the other hook imports (next to `useWorkspaceCollapsed`):

```tsx
import { useSidebarCollapsed } from "./use-sidebar-collapsed";
```

Inside `TaskManagerInner()` (near the top, with the other hook calls), add:

```tsx
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebarCollapsed();
```

In the `<ModernShell ... />` JSX (currently `task-manager.tsx:954–972`), add these two props (e.g. right after `version={APP_VERSION}`):

```tsx
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
```

- [ ] **Step 4: Run tests + types**

Run: `npx vitest run src/app/modern-shell.test.tsx && npx tsc --noEmit`
Expected: PASS; types clean.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open the app in modern mode, click the sidebar chevron — it must collapse/expand and persist across reload. Narrow the window below 1024px — it must auto-collapse.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager.tsx src/app/modern-shell.test.tsx
git commit -m "feat: wire sidebar collapse state into the modern shell"
```

---

## Task 4: `NavIcon` component (icons for the rail)

**Files:**
- Create: `src/app/nav-icons.tsx`
- Test: `src/app/nav-icons.test.tsx`

One palette-neutral (`currentColor`) icon per nav view, so the collapsed rail shows icons instead of clipped text. Icons are decorative (`aria-hidden`); the accessible name comes from the button label (Task 5).

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/nav-icons.test.tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NavIcon } from "./nav-icons";
import { allNavViews } from "./nav-config";

describe("NavIcon", () => {
  it("renders an aria-hidden svg for every sidebar view", () => {
    for (const view of allNavViews()) {
      const { container, unmount } = render(<NavIcon view={view} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });

  it("renders nothing for the edit view", () => {
    const { container } = render(<NavIcon view="edit" />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/nav-icons.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/app/nav-icons.tsx
import type { AppView } from "./nav-config";

// 20x20 outline path data, one per nav view. `currentColor` so the sidebar's
// text color drives the icon — keeps the palette constraint trivially satisfied.
const ICON_PATHS: Record<Exclude<AppView, "edit">, string> = {
  "open-points": "M3 4.5h14M3 10h14M3 15.5h14",
  chat: "M4 4h12v8H8l-4 4V4z",
  gantt: "M3 5h8M3 10h12M3 15h6",
  resources: "M7 9a3 3 0 100-6 3 3 0 000 6zM2 17a5 5 0 0110 0",
  "address-book": "M5 3h9a1 1 0 011 1v12a1 1 0 01-1 1H5zM3 6h2M3 10h2M3 14h2",
  "resource-report": "M4 3h12v14H4zM7 8h6M7 11h6M7 14h3",
  budget: "M10 2v16M6 6h6a2 2 0 010 4H8a2 2 0 000 4h6",
  raid: "M10 2l8 14H2L10 2zM10 8v3M10 14h.01",
  "raid-report": "M4 3h12v14H4zM7 7h6M7 10h6M7 13h3",
  reports: "M4 3h12v14H4zM7 8l2 2 3-4",
  activity: "M3 10h3l2-5 3 10 2-5h3",
  settings: "M10 7a3 3 0 100 6 3 3 0 000-6zM10 2v2M10 16v2M4 10H2M18 10h-2",
};

interface NavIconProps {
  view: AppView;
  className?: string;
}

export function NavIcon({ view, className }: NavIconProps) {
  if (view === "edit") return null;
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? "h-5 w-5 shrink-0"}
    >
      <path d={ICON_PATHS[view]} />
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/nav-icons.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/nav-icons.tsx src/app/nav-icons.test.tsx
git commit -m "feat: add per-view NavIcon for the sidebar rail"
```

---

## Task 5: Render the icon rail in `sidebar-nav.tsx`

**Files:**
- Modify: `src/app/sidebar-nav.tsx`
- Test: `src/app/sidebar-nav.test.tsx` (add collapsed-rail cases)

When collapsed: icon-only buttons, centered, with the label as `aria-label` + `title`. When expanded: icon + text as today. Group headers and child lists stay hidden when collapsed (unchanged).

- [ ] **Step 1: Write the failing tests** (add to `sidebar-nav.test.tsx`)

```tsx
  it("collapsed rail shows icon-only buttons that keep an accessible name", () => {
    render(
      <SidebarNav lang="en-US" activeView="open-points" onNavigate={() => {}} collapsed />,
    );
    // Group header text is hidden when collapsed.
    expect(screen.queryByText("OVERVIEW")).toBeNull();
    // The item keeps its accessible name via aria-label even with no visible text.
    const gantt = screen.getByRole("button", { name: "Gantt" });
    expect(gantt.getAttribute("aria-label")).toBe("Gantt");
    expect(gantt.querySelector("svg")).not.toBeNull();
  });

  it("expanded items render both an icon and the visible label", () => {
    render(
      <SidebarNav lang="en-US" activeView="open-points" onNavigate={() => {}} />,
    );
    const gantt = screen.getByRole("button", { name: "Gantt" });
    expect(gantt.querySelector("svg")).not.toBeNull();
    expect(gantt.textContent).toContain("Gantt");
  });
```

(`screen` is already imported in this file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/sidebar-nav.test.tsx`
Expected: FAIL — no `svg` inside the buttons yet; collapsed buttons have no `aria-label`.

- [ ] **Step 3: Implement** — replace the body of `sidebar-nav.tsx` with:

```tsx
"use client";
import { type Lang, t } from "./i18n";
import { NAV_GROUPS, navLabelKey, type AppView, type NavItem } from "./nav-config";
import { NavIcon } from "./nav-icons";

interface SidebarNavProps {
  lang: Lang;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  // When collapsed the sidebar is an icon-only rail: group headers and child
  // lists are hidden and item labels move to aria-label/title.
  collapsed?: boolean;
}

function isParentActive(item: NavItem, active: AppView): boolean {
  if (item.view === active) return true;
  return (item.children ?? []).some((c) => c.view === active);
}

function navItemClass(active: boolean, indent: "root" | "child", collapsed: boolean): string {
  const base = "flex w-full items-center gap-2 border-l-2 text-left text-sm transition-colors ";
  const spacing = collapsed
    ? "justify-center px-0 py-2 "
    : indent === "root"
      ? "px-4 py-2 "
      : "py-1.5 pl-9 pr-4 ";
  const inactiveText = indent === "root" ? "text-AIPM-light-grey" : "text-AIPM-medium-grey";
  const state = active
    ? "border-AIPM-green bg-AIPM-green/15 font-semibold text-AIPM-white"
    : `border-transparent ${inactiveText} hover:bg-AIPM-white/10 hover:text-AIPM-white`;
  return base + spacing + state;
}

export function SidebarNav({ lang, activeView, onNavigate, collapsed = false }: SidebarNavProps) {
  return (
    <nav aria-label={t(lang, "navPrimaryLabel")} className="flex flex-col gap-4 py-2">
      {NAV_GROUPS.map((group) => (
        <div key={group.labelKey}>
          {!collapsed && (
            <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-AIPM-medium-grey">
              {t(lang, group.labelKey)}
            </p>
          )}
          <ul role="list">
            {group.items.map((item) => {
              const active = activeView === item.view;
              const label = t(lang, navLabelKey(item.view));
              const showChildren = !collapsed && !!item.children?.length && isParentActive(item, activeView);
              return (
                <li key={item.view}>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.view)}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? label : undefined}
                    title={collapsed ? label : undefined}
                    className={navItemClass(active, "root", collapsed)}
                  >
                    <NavIcon view={item.view} />
                    {!collapsed && <span>{label}</span>}
                  </button>
                  {showChildren && (
                    <ul role="list">
                      {(item.children ?? []).map((child) => {
                        const childActive = activeView === child.view;
                        return (
                          <li key={child.view}>
                            <button
                              type="button"
                              onClick={() => onNavigate(child.view)}
                              aria-current={childActive ? "page" : undefined}
                              className={navItemClass(childActive, "child", false)}
                            >
                              <NavIcon view={child.view} />
                              <span>{t(lang, navLabelKey(child.view))}</span>
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

- [ ] **Step 4: Run tests** (existing + new must all pass)

Run: `npx vitest run src/app/sidebar-nav.test.tsx src/app/sidebar.test.tsx src/app/modern-shell.test.tsx`
Expected: PASS. (Existing expanded tests still find buttons by text name; the icon is `aria-hidden` so accessible names are unchanged.)

- [ ] **Step 5: Commit**

```bash
git add src/app/sidebar-nav.tsx src/app/sidebar-nav.test.tsx
git commit -m "feat: icon rail for the collapsed sidebar"
```

---

## Task 6: Top-bar menu button + skip-link + main landmark

**Files:**
- Modify: `src/app/top-bar.tsx` (add an optional menu button)
- Modify: `src/app/modern-shell.tsx` (skip-link, `<main id>`, pass toggle to TopBar)
- Modify: `src/app/i18n.ts` and `src/app/i18n.de.ts` (two new keys)
- Test: `src/app/top-bar.test.tsx`, `src/app/modern-shell.test.tsx`

- [ ] **Step 1: Add i18n keys**

In `i18n.ts`, in the `enUS` object near the sidebar keys (`i18n.ts:1052–1054`), add:

```ts
    sidebarMenuButton: "Open navigation menu",
    skipToContent: "Skip to content",
```

In `i18n.de.ts`, add the matching keys (ASCII `"` quotes only — grep-verify after):

```ts
    sidebarMenuButton: "Navigationsmenü öffnen",
    skipToContent: "Zum Inhalt springen",
```

Verify no curly-quote corruption: `npx tsc --noEmit` and confirm `i18n.de.ts` still parses.

- [ ] **Step 2: Write the failing tests**

Add to `top-bar.test.tsx`:

```tsx
  it("renders a menu button that calls onToggleSidebar when provided", () => {
    const onToggleSidebar = vi.fn();
    render(<TopBar {...base} onToggleSidebar={onToggleSidebar} />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(onToggleSidebar).toHaveBeenCalled();
  });

  it("omits the menu button when onToggleSidebar is not provided", () => {
    render(<TopBar {...base} />);
    expect(screen.queryByRole("button", { name: "Open navigation menu" })).toBeNull();
  });
```

Add to `modern-shell.test.tsx`:

```tsx
  it("renders a skip-to-content link targeting the main region", () => {
    setup();
    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(link.getAttribute("href")).toBe("#main-content");
    expect(document.getElementById("main-content")).not.toBeNull();
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/app/top-bar.test.tsx src/app/modern-shell.test.tsx`
Expected: FAIL — no menu button / no skip-link yet.

- [ ] **Step 4: Implement `top-bar.tsx`** — add `onToggleSidebar?: () => void` to `TopBarProps` and render the button at the start of the `<header>`:

```tsx
interface TopBarProps {
  lang: Lang;
  title: string;
  bannerCount: number;
  onNewTask: () => void;
  onShowAlerts: () => void;
  /** When set, renders a leading menu button (toggles the sidebar / icon rail). */
  onToggleSidebar?: () => void;
  /** When set, replaces the default New-task button (e.g. Save/Cancel while editing). */
  primaryAction?: React.ReactNode;
  /** Menu components (Export/Help/Version/Settings/Voice) rendered as-is. */
  children?: React.ReactNode;
}

export function TopBar({ lang, title, bannerCount, onNewTask, onShowAlerts, onToggleSidebar, primaryAction, children }: TopBarProps) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line bg-surface px-6 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={t(lang, "sidebarMenuButton")}
            title={t(lang, "sidebarMenuButton")}
            className="rounded-md p-2 text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-AIPM-medium-grey dark:hover:text-AIPM-light-grey"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
              <path fillRule="evenodd" d="M3 5.5A.75.75 0 013.75 4.75h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 5.5zm0 4.5a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 10zm0 4.5a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 14.5z" clipRule="evenodd" />
            </svg>
          </button>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {title}
        </h1>
      </div>
      <div className="flex items-center gap-1">
        {primaryAction ?? (
          <button
            type="button"
            onClick={onNewTask}
            title={t(lang, "newTask")}
            className="rounded-md bg-AIPM-green px-3 py-1.5 text-sm font-semibold text-AIPM-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-green"
          >
            {t(lang, "newTask")}
          </button>
        )}
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

- [ ] **Step 5: Implement `modern-shell.tsx`** — add the skip-link, an `id` on `<main>`, and pass `onToggleSidebar` to `TopBar`. Replace the returned JSX with:

```tsx
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-AIPM-green focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold focus:text-AIPM-white"
      >
        {t(lang, "skipToContent")}
      </a>
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
          onToggleSidebar={onToggleCollapsed}
          primaryAction={isEditing ? editActions : undefined}
        >
          {topBarMenus}
        </TopBar>
        <main id="main-content" className="min-h-0 flex-1 overflow-auto bg-surface-muted p-6 dark:bg-black">
          {content}
        </main>
      </div>
    </div>
  );
```

(`onToggleCollapsed` is already a `ModernShell` prop, defaulted to a no-op; once Task 3 wires it from `task-manager`, both the sidebar chevron and the top-bar menu button drive the same toggle.)

- [ ] **Step 6: Run tests + types**

Run: `npx vitest run src/app/top-bar.test.tsx src/app/modern-shell.test.tsx && npx tsc --noEmit`
Expected: PASS; types clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/top-bar.tsx src/app/modern-shell.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/top-bar.test.tsx src/app/modern-shell.test.tsx
git commit -m "feat: top-bar menu button + skip-to-content link for the modern shell"
```

---

## Task 7: `SidebarFooter` — theme toggle, storage status, account/sign-out

**Files:**
- Create: `src/app/sidebar-footer.tsx`
- Test: `src/app/sidebar-footer.test.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (one new key `sidebarSignOut`)
- Modify: `src/app/task-manager.tsx` (build `<SidebarFooter>` and pass it as `sidebarFooter`)

The footer reuses existing chrome. Version stays in `Sidebar` (unchanged) — the footer adds the rest. When `collapsed`, render only the compact theme control.

> **Step 0 (read before coding):** Confirm `SegmentedControl`'s ARIA role and prop names from `src/app/segmented-control.tsx` (already used in `settings-menu.tsx:316–333`: `value`, `onChange`, `options`, `ariaLabel`, `title`, `className`). `useMsAuth(enabled)` returns `{ account, ready, signIn, signOut, acquireToken }` (account display = `account.username`); confirm the `enabled` flag used at `settings-menu.tsx:216` and the equivalent M365-enabled value in `task-manager` scope.

- [ ] **Step 1: Add i18n key** (BOTH files; ASCII quotes; grep-verify `i18n.de.ts`)

`i18n.ts`:

```ts
    sidebarSignOut: "Sign out",
```

`i18n.de.ts`:

```ts
    sidebarSignOut: "Abmelden",
```

- [ ] **Step 2: Write the failing test**

```tsx
// src/app/sidebar-footer.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SidebarFooter } from "./sidebar-footer";

const base = {
  lang: "en-US" as const,
  collapsed: false,
  storageDescription: "Local file: lop.json",
  storageReady: true,
  accountName: null as string | null,
  isSignedIn: false,
  onSignOut: () => {},
};

describe("SidebarFooter", () => {
  it("renders the theme control label and the storage description", () => {
    render(<SidebarFooter {...base} />);
    expect(screen.getByText("Local file: lop.json")).toBeTruthy();
    // SegmentedControl exposes ariaLabel="Theme"; confirm the control is present.
    expect(screen.getAllByText("Theme").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the account name and a sign-out button when signed in", () => {
    const onSignOut = vi.fn();
    render(<SidebarFooter {...base} isSignedIn accountName="alex@example.com" onSignOut={onSignOut} />);
    expect(screen.getByText("alex@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("hides the storage description when collapsed (keeps the theme control compact)", () => {
    render(<SidebarFooter {...base} collapsed />);
    expect(screen.queryByText("Local file: lop.json")).toBeNull();
  });
});
```

> If `getAllByText("Theme")` is brittle against `SegmentedControl`'s markup, switch to querying its `ariaLabel` role once confirmed in Step 0 (e.g. `getByRole("radiogroup", { name: "Theme" })`). Keep the assertion meaningful.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/sidebar-footer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `sidebar-footer.tsx`**

```tsx
// src/app/sidebar-footer.tsx
"use client";
import { type Lang, t } from "./i18n";
import { useTheme } from "./use-theme";
import { type Theme } from "./theme";
import { SegmentedControl } from "./segmented-control";

interface SidebarFooterProps {
  lang: Lang;
  collapsed: boolean;
  storageDescription: string | null;
  storageReady: boolean;
  isSignedIn: boolean;
  accountName: string | null;
  onSignOut: () => void;
}

function ThemeControl({ lang }: { lang: Lang }) {
  const { theme, setTheme } = useTheme();
  return (
    <SegmentedControl<Theme>
      value={theme}
      ariaLabel={t(lang, "theme")}
      title={t(lang, "themeHint")}
      className="w-full"
      options={[
        { value: "light", label: t(lang, "themeLight") },
        { value: "dark", label: t(lang, "themeDark") },
        { value: "system", label: t(lang, "themeSystem") },
      ]}
      onChange={setTheme}
    />
  );
}

export function SidebarFooter({
  lang, collapsed, storageDescription, storageReady, isSignedIn, accountName, onSignOut,
}: SidebarFooterProps) {
  // Collapsed rail: keep only the compact theme control; full details return on expand.
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2">
        <ThemeControl lang={lang} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-AIPM-medium-grey">
          {t(lang, "theme")}
        </span>
        <ThemeControl lang={lang} />
      </div>

      {storageDescription && (
        <p className={storageReady ? "text-AIPM-light-grey" : "text-AIPM-medium-grey"}>
          <span aria-hidden className={"mr-1 inline-block h-2 w-2 rounded-full " + (storageReady ? "bg-AIPM-green" : "bg-AIPM-medium-grey")} />
          {storageDescription}
        </p>
      )}

      {isSignedIn && accountName && (
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-AIPM-light-grey">{accountName}</span>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-md px-2 py-1 text-AIPM-medium-grey hover:bg-AIPM-white/10 hover:text-AIPM-white focus:outline-none focus:ring-2 focus:ring-AIPM-green"
          >
            {t(lang, "sidebarSignOut")}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire into `task-manager.tsx`**

Add imports:

```tsx
import { SidebarFooter } from "./sidebar-footer";
import { useMsAuth } from "./use-ms-auth";
```

In `TaskManagerInner()`, add (using the same M365-enabled flag `settings-menu.tsx:216` passes — confirm its source in Step 0):

```tsx
  const msAuth = useMsAuth(/* M365 enabled flag, e.g. */ settings.m365?.enabled ?? false);
```

Replace `sidebarFooter={null}` (`task-manager.tsx:966`) with:

```tsx
        sidebarFooter={
          <SidebarFooter
            lang={lang}
            collapsed={sidebarCollapsed}
            storageDescription={storageDescription}
            storageReady={storageReady}
            isSignedIn={msAuth.account != null}
            accountName={msAuth.account?.username ?? null}
            onSignOut={() => { void msAuth.signOut(); }}
          />
        }
```

> `storageDescription`/`storageReady` are already in `TaskManagerInner` scope (passed to `AppHeader`); use the existing local names. Adjust the `settings.m365?.enabled` path to the real M365-enabled setting confirmed in Step 0.

- [ ] **Step 6: Run tests + types**

Run: `npx vitest run src/app/sidebar-footer.test.tsx && npx tsc --noEmit`
Expected: PASS; types clean.

- [ ] **Step 7: Manual verification**

`npm run dev`: footer shows the theme control + storage line; sign in with M365 → username + Sign out appear; collapse → footer compacts to the theme control.

- [ ] **Step 8: Commit**

```bash
git add src/app/sidebar-footer.tsx src/app/sidebar-footer.test.tsx src/app/task-manager.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: full sidebar footer (theme, storage status, account sign-out)"
```

---

## Task 8: Dark-mode + palette audit of the shell

**Files:**
- Modify (only if violations found): any Phase-4 touched shell file
- Test: `src/app/shell-palette-guard.test.ts` (new source-guard)

A cheap regression guard asserting the new/modified shell files contain **no raw hex colors** and **no `shadow`/gradient** utilities. (Mirrors Phase-3's `table-head-sweep.test.ts` — read source via `process.cwd()`, NOT `import.meta.url`, which breaks on Windows/Vitest multi-file runs.)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/shell-palette-guard.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SHELL_FILES = [
  "sidebar.tsx",
  "sidebar-nav.tsx",
  "sidebar-footer.tsx",
  "top-bar.tsx",
  "modern-shell.tsx",
  "nav-icons.tsx",
];

// Raw hex like bg-[#fff] in a className is off-palette; tokens must be used.
const HEX_IN_CLASS = /(?:bg|text|border|ring|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/;
const SHADOW_OR_GRADIENT = /\b(?:shadow(?:-[a-z0-9]+)?|bg-gradient-)/;

describe("shell palette guard", () => {
  it("resolves shell sources from the project cwd", () => {
    expect(existsSync(join(process.cwd(), "src/app", "modern-shell.tsx"))).toBe(true);
  });

  for (const file of SHELL_FILES) {
    it(`${file} uses palette tokens (no raw hex, no shadow/gradient)`, () => {
      const src = readFileSync(join(process.cwd(), "src/app", file), "utf8");
      expect(HEX_IN_CLASS.test(src)).toBe(false);
      expect(SHADOW_OR_GRADIENT.test(src)).toBe(false);
    });
  }
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run src/app/shell-palette-guard.test.ts`
Expected: PASS if Phase-4 code used tokens. If any file FAILS, fix the offending class (swap raw hex for an `AIPM-*`/semantic token; remove any `shadow-*`/`bg-gradient-*`), then re-run.

- [ ] **Step 3: Manual dark-mode check**

`npm run dev`: toggle Theme → Dark in the footer. Verify the modern shell reads correctly in dark mode — sidebar (Dark Blue, always), top bar (`bg-surface` + dark variants), main (`dark:bg-black`), footer contrast. Fix any low-contrast/off-palette class, keeping every color a permitted token.

- [ ] **Step 4: Commit**

```bash
git add src/app/shell-palette-guard.test.ts
git commit -m "test: palette/dark-mode source guard for the modern shell"
```

---

## Task 9: Version bump + changelog + docs (v0.32.0 "Jemisin")

**Files:**
- Modify: `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Modify: `CHANGELOG.md`, `README.md`

- [ ] **Step 1: Add the highlight i18n key** (BOTH files; ASCII quotes; grep-verify `i18n.de.ts`)

`i18n.ts`:

```ts
    versionHighlightSidebarPolish: "Responsive sidebar — collapsible icon rail, accessible navigation (skip link, menu button), and a fuller sidebar footer",
```

`i18n.de.ts`:

```ts
    versionHighlightSidebarPolish: "Responsive Seitenleiste — einklappbare Icon-Leiste, barrierefreie Navigation (Sprunglink, Menü-Button) und eine umfassendere Fußzeile",
```

- [ ] **Step 2: Bump `version.ts`**

- Set `APP_VERSION = "0.32.0"`.
- Set `APP_BUILD_DATE = "2026-05-30"; // Jemisin milestone` (match the existing pattern).
- Prepend a `0.32.0 "Jemisin"` milestone comment continuing the codename chain (Okorafor → Liu → Leckie → **Jemisin**). Confirm the prior codenames in `CHANGELOG.md` and keep the chain consistent.
- Append `"versionHighlightSidebarPolish"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 3: CHANGELOG + README**

Add to `CHANGELOG.md` (top), matching the existing entry format:

```markdown
## [0.32.0] — 2026-05-30 "Jemisin"

### Added
- Responsive sidebar: a collapsible **icon rail** that auto-collapses on narrow screens, a top-bar menu button, and a persisted collapse preference.
- Sidebar footer with the theme toggle, storage status, and M365 account / sign-out.
- Accessibility: a skip-to-content link and a labelled `#main-content` landmark in the modern shell.

### Fixed
- The sidebar collapse button is no longer a no-op — it is now wired through the modern shell.
```

Update the README highlights/version line to mention 0.32.0 (follow the existing README convention; no internal pattern-file references).

- [ ] **Step 4: Full suite + types**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green; types clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md README.md
git commit -m "release: 0.32.0 — responsive sidebar, a11y, fuller footer (Jemisin)"
```

---

## Final review

After all tasks: dispatch a final holistic code review over the whole branch (spec compliance + code quality + palette/a11y), confirm `npx vitest run` and `npx tsc --noEmit` are green, then use **superpowers:finishing-a-development-branch**.

## Self-review notes (author)

- **Spec coverage (Phase 4 / workstream A):** responsive collapse (Tasks 1–3, 5), icon rail (Tasks 4–5), top-bar menu button (Task 6), footer details (Task 7), accessibility — landmarks/skip-link/`aria-current` (Tasks 5–6; `aria-current` already present), dark-mode pass (Task 8). Keyboard nav: all nav/menu controls are native `<button>`/`<a>` (Tab + Enter/Space), no roving-tabindex needed (YAGNI).
- **Deferred (own plans):** B full-page Settings, C DRY menu cluster + banner parity, D divergent-table sweep.
- **Type consistency:** `collapsed`/`onToggleCollapsed` (ModernShell/Sidebar), `onToggleSidebar` (TopBar), `useSidebarCollapsed()` → `{ collapsed, toggle }`, `SIDEBAR_NARROW_QUERY`, `NavIcon({view,className})`, `SidebarFooter` props, `useMsAuth(enabled)` → `{ account, signOut }` (display = `account.username`) — all consistent across tasks.
- **Risk flagged:** `SegmentedControl`'s ARIA role and the exact M365-enabled settings path are confirmed at execution time (Task 7 Step 0); adjust the footer test query / hook arg to the real values.
