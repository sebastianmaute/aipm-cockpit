# Classic layout — secondary sub-tab row (v0.38.1)

**Date:** 2026-06-01
**Status:** Design approved; pending implementation plan

## Problem
The v0.38.0 batch restructured the Resources navigation into nav-config children
(`resources → directory/workload/calendar/planning/manage-roles`, `raid → raid-report`)
and removed the in-panel buttons/toggles classic users relied on to reach those views.
The **modern** sidebar exposes them as nested nav items; the **classic** tab strip
(`workspace-section.tsx`, `role="tablist"`, gated `!isPopout && !fullBleed`) is a hardcoded
row of top-level tabs (chat · reports · gantt · raid · resources · budget · activity) and
therefore can no longer reach: `directory`, `workload`, `calendar`, `planning`,
`manage-roles`, or `raid-report`. Their panels already render in `workspace-section`
(routing was added in v0.38); only the navigation affordance is missing in classic.

## Decisions (resolved with the user)
1. **Presentation:** a secondary sub-tab row beneath the primary classic strip, shown only
   when the active section has children — mirrors the modern sidebar's expand-children
   behavior; keeps the primary strip uncluttered. (Not flat extra tabs.)
2. **Scope:** all sub-views including **RAID Report** (full parity with the modern sidebar).

## Design

### Shared helper — `nav-config.ts`
Add and export:
```ts
export function subTabsFor(view: AppView): readonly { view: AppView }[]
```
Returns the `children` of the `NAV_GROUPS` item that contains `view` (matched as the item's
own `view` OR as one of its `children[].view`); returns `[]` when the active view's section
has no children. This is the single source of truth shared with the sidebar's tree, and is
independently unit-testable.

Expected results:
- `subTabsFor("resources")` and `subTabsFor("directory"|"workload"|"calendar"|"planning"|"manage-roles")`
  → the 5 resources children `[directory, workload, calendar, planning, manage-roles]`.
- `subTabsFor("raid")` and `subTabsFor("raid-report")` → `[raid-report]`.
- `subTabsFor("chat"|"reports"|"gantt"|"budget"|"activity"|"open-points"|"settings"|"edit")` → `[]`.

### Secondary row — `workspace-section.tsx` (classic only)
Directly after the existing primary `role="tablist"` block (inside the same
`!isPopout && !fullBleed` guard), render a second `role="tablist"` (aria-label e.g.
"Workspace sub-tabs") ONLY when `subTabsFor(activeTab).length > 0`. For each child it
renders a `TabButton`:
- `active={activeTab === child.view}`
- `onClick`: `setActiveTab(child.view)` and `if (workspaceCollapsed) setWorkspaceCollapsed(false)`
- `controls={\`panel-${child.view}\`}`
- label: `t(lang, navLabelKey(child.view))`
- **no** `onPopout` (navigational only — avoids popout/broadcast plumbing; primary tabs keep theirs)

No changes to panel rendering, `manageRolesView` (already passed in both layouts), routing,
or the modern shell.

## Testing (TDD)
- `nav-config.test.ts`: `subTabsFor` returns the expected children/empty per the table above.
- `workspace-section.test.tsx`:
  - classic (`fullBleed={false}`, not popout) with a resources view active renders the
    secondary row containing the 5 resources children; clicking one calls `setActiveTab`
    with that child view.
  - secondary row is ABSENT when `activeTab === "chat"`.
  - secondary row is ABSENT in modern (`fullBleed`) and in popout mode.

## Versioning
- `version.ts` → `0.38.1`; CHANGELOG entry. No new i18n keys (labels reuse `navLabelKey`).

## Out of scope
- Modern sidebar (unchanged). Popout support for sub-views. Any panel/routing changes.
