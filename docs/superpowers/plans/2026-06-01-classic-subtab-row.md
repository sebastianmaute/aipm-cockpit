# Classic Sub-Tab Row — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the classic layout, expose the Resources sub-views (Directory/Workload/Calendar/Planning/Manage Roles) and RAID Report via a secondary sub-tab row beneath the primary tab strip, driven by `nav-config`.

**Architecture:** Add a pure `subTabsFor(view)` helper to `nav-config.ts` (single source of truth = the same NAV_GROUPS tree the sidebar uses), then render a second `role="tablist"` in `workspace-section.tsx` (classic only) when the active section has children. Panels and `manageRolesView` already render in both layouts (v0.38), so this is navigation-affordance only.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-01-classic-subtab-row-design.md`

**Conventions:** type-check `npx tsc --noEmit`; lint `npm run lint`; test `npx vitest run <file>`. Scoped `git add` only. Branch first (we're on `main` — start a `classic-subtabs` branch). Commit locally; push/MR only on request.

---

## Task 0: Branch

- [ ] **Step 1:** We are on `main` (clean, = origin/main). Create and switch to a feature branch:
```bash
git checkout -b classic-subtabs
git branch --show-current   # expect: classic-subtabs
```

---

## Task 1: `subTabsFor` helper in nav-config

**Files:**
- Modify: `src/app/nav-config.ts`
- Test: `src/app/nav-config.test.ts`

Context: `NAV_GROUPS: NavGroup[]` where `NavGroup = { labelKey, items: NavItem[] }` and
`NavItem = { view: AppView; children?: { view: AppView }[] }`. The Resources item is
`{ view: "resources", children: [{view:"directory"},{view:"workload"},{view:"calendar"},{view:"planning"},{view:"manage-roles"}] }`
and the RAID item is `{ view: "raid", children: [{view:"raid-report"}] }`.

- [ ] **Step 1: Write the failing test** — append to `src/app/nav-config.test.ts`:

```ts
test("subTabsFor returns the containing section's children for a parent or child view", () => {
  const resKids = subTabsFor("resources").map((c) => c.view);
  expect(resKids).toEqual(["directory", "workload", "calendar", "planning", "manage-roles"]);
  // a child view resolves to the same sibling set
  expect(subTabsFor("planning").map((c) => c.view)).toEqual(resKids);
  expect(subTabsFor("raid").map((c) => c.view)).toEqual(["raid-report"]);
  expect(subTabsFor("raid-report").map((c) => c.view)).toEqual(["raid-report"]);
  // sections without children → no sub-tabs
  expect(subTabsFor("chat")).toEqual([]);
  expect(subTabsFor("budget")).toEqual([]);
  expect(subTabsFor("open-points")).toEqual([]);
});
```
Add `subTabsFor` to the existing `import { ... } from "./nav-config";` line at the top of the test file.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/app/nav-config.test.ts` (subTabsFor not exported).

- [ ] **Step 3: Implement** — add to `src/app/nav-config.ts` (after `allNavViews`):

```ts
/** The sub-tab children of the nav section that contains `view` (matched as the
 *  section's own view OR one of its children). Empty when the section has no
 *  children. Drives the classic layout's secondary sub-tab row. */
export function subTabsFor(view: AppView): readonly { view: AppView }[] {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const contains =
        item.view === view || (item.children ?? []).some((c) => c.view === view);
      if (contains) return item.children ?? [];
    }
  }
  return [];
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/app/nav-config.test.ts` then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**
```bash
git add src/app/nav-config.ts src/app/nav-config.test.ts
git commit -m "feat: subTabsFor helper for classic sub-tab navigation"
```

---

## Task 2: Secondary sub-tab row in workspace-section

**Files:**
- Modify: `src/app/workspace-section.tsx`
- Test: `src/app/workspace-section.test.tsx`

Context: the primary classic strip is a `{!isPopout && !fullBleed && ( <div role="tablist" aria-label="Workspace tabs" …> …TabButtons… </div> )}` block (ends around line 301–302). `TabButton` (from `./task-manager-ui`) props: `active`, `onClick`, `controls`, optional `onPopout`/`popoutLabel`, and children. `workspaceCollapsed`/`setWorkspaceCollapsed`, `activeTab`/`setActiveTab` (from `useWorkspaceTab`), `lang`, and `isPopout`/`fullBleed` are all in scope. The existing primary tablist uses a hardcoded `aria-label="Workspace tabs"` (NOT i18n) — mirror that.

- [ ] **Step 1: Write the failing test** — append to `src/app/workspace-section.test.tsx` (match the file's existing render/provider setup — read its top + an existing render test first). Behavioral test (drive `activeTab` by clicking the primary Resources tab, which lives in a real `WorkspaceTabProvider`):

```tsx
test("classic: a secondary sub-tab row appears for Resources and navigates to a sub-view", async () => {
  renderClassicWorkspace(); // use the file's existing helper that renders WorkspaceSection in classic mode (fullBleed=false, not popout) within its providers
  // no sub-row while Chat (default) is active:
  expect(screen.queryByRole("tablist", { name: /sub-tabs/i })).toBeNull();
  // activate Resources via the primary tab:
  fireEvent.click(screen.getByRole("tab", { name: /resources/i }));
  const subRow = screen.getByRole("tablist", { name: /sub-tabs/i });
  expect(within(subRow).getByRole("tab", { name: /directory/i })).toBeInTheDocument();
  expect(within(subRow).getByRole("tab", { name: /workload/i })).toBeInTheDocument();
  expect(within(subRow).getByRole("tab", { name: /manage roles/i })).toBeInTheDocument();
  // navigating to a sub-view via the sub-tab works:
  fireEvent.click(within(subRow).getByRole("tab", { name: /directory/i }));
  expect(document.getElementById("panel-directory")).toBeTruthy();
});
```
NOTES for the implementer:
- Read the existing `workspace-section.test.tsx` to reuse its exact render helper/provider wrapper and imports (`render`, `screen`, `fireEvent`, `within`). If there is no classic render helper, render the same way other classic tests in the file do (the primary tablist only renders when `!isPopout && !fullBleed`, so the test must NOT be in popout mode and must pass `fullBleed={false}` / the classic equivalent the file already uses).
- `TabButton` renders `role="tab"` (verify in `task-manager-ui.tsx`); the accessible name is its text label. If the matchers above don't line up with the real roles/labels, adjust to what `TabButton` actually renders — but keep the test asserting REAL behavior (sub-row absent for chat, present + clickable for resources).
- If driving `activeTab` by click proves impractical in the harness, fall back to ALSO adding a source-scan assertion (the secondary `role="tablist"` is guarded by `!isPopout && !fullBleed` and `subTabsFor(activeTab)`), but PREFER the behavioral test.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/app/workspace-section.test.tsx`.

- [ ] **Step 3: Implement** — in `workspace-section.tsx`:
  - Ensure the nav-config import includes the helpers: change/extend the existing import to `import { navLabelKey, subTabsFor } from "./nav-config";` (keep any existing named imports from that module; add these two).
  - Immediately AFTER the primary tablist block's closing `)}` (the one that closes `{!isPopout && !fullBleed && ( <div role="tablist" aria-label="Workspace tabs">…</div> )}`), insert:

```tsx
      {!isPopout && !fullBleed && subTabsFor(activeTab).length > 0 && (
        <div
          role="tablist"
          aria-label="Workspace sub-tabs"
          className="mb-2 flex flex-wrap items-center gap-1 border-b border-line pb-1"
        >
          {subTabsFor(activeTab).map((child) => (
            <TabButton
              key={child.view}
              active={activeTab === child.view}
              onClick={() => {
                setActiveTab(child.view);
                if (workspaceCollapsed) setWorkspaceCollapsed(false);
              }}
              controls={`panel-${child.view}`}
            >
              {t(lang, navLabelKey(child.view))}
            </TabButton>
          ))}
        </div>
      )}
```
  - If `TabButton` requires `onPopout`/`popoutLabel` (i.e. they are non-optional), make them optional in `task-manager-ui.tsx` (`onPopout?`, `popoutLabel?`) and guard the popout control render with `{onPopout && …}` — but FIRST check: the spec expects them optional. If already optional, change nothing in TabButton.

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/app/workspace-section.test.tsx` then `npx vitest run src/app/nav-config.test.ts src/app/view-pane-sweep.test.ts` (regression) then `npx tsc --noEmit` and `npm run lint`.

- [ ] **Step 5: Commit**
```bash
git add src/app/workspace-section.tsx src/app/workspace-section.test.tsx
# include src/app/task-manager-ui.tsx ONLY if you had to make TabButton's onPopout optional
git commit -m "feat: classic secondary sub-tab row for resources sub-views + raid report"
```

---

## Task 3: Version 0.38.1 + CHANGELOG

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1:** `version.ts`: set `APP_VERSION = "0.38.1"`; keep `APP_BUILD_DATE = "2026-06-01"`; prepend a `// 0.38.1 …` one-paragraph summary above the `// 0.38.0 …` block: "Classic-layout follow-up: the classic tab strip gains a secondary sub-tab row (driven by nav-config's `subTabsFor`) so Classic mode can reach the Resources sub-views (Directory/Workload/Calendar/Planning/Manage Roles) and the RAID Report that the modern sidebar already exposes; modern layout unchanged. No new strings." Do NOT add a new `APP_HIGHLIGHT_KEYS` entry (point release).

- [ ] **Step 2:** `CHANGELOG.md`: add a `## 0.38.1` section at the top with a one-line bullet describing the classic sub-tab row.

- [ ] **Step 3:** Verify full green:
```
npx vitest run && npx tsc --noEmit && npm run lint
```
Expected: all pass/clean.

- [ ] **Step 4: Commit**
```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "chore: release v0.38.1 — classic sub-tab row"
```

---

## Self-review (coverage map)
- Spec "shared helper `subTabsFor`" → Task 1 (with the exact expected-results table as the test).
- Spec "secondary row in workspace-section (classic only), TabButton per child, no onPopout, controls=panel-<view>, label via navLabelKey" → Task 2.
- Spec "testing" → Task 1 unit test + Task 2 behavioral test (absent for chat; present+clickable for resources; modern/popout absence covered by the `!isPopout && !fullBleed` guard, asserted via the chat-absence + the guard expression).
- Spec "versioning 0.38.1 + CHANGELOG, no new i18n" → Task 3.
- No placeholders; types consistent (`subTabsFor` returns `readonly { view: AppView }[]`, consumed via `.map`/`.length`); `navLabelKey`/`TabButton`/`subTabsFor` are all real existing/added symbols.
