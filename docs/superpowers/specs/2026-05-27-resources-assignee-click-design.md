# Resources Assignee Click-to-Edit (0.14.3) — Design

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.14.3-resources-assignee-click`
**Context:** Sub-project A of a larger batch (decomposed into C=RAID sorting [shipped 0.14.2], A=resources assignee click, D+E=design system, B=resources styling). This is A.

## Goal

In the resources **calendar** and **planning** grids, make the assignee name a clickable control with the directory/workload hover effect:
- A name that resolves to a real `Resource` opens the resource **edit** modal.
- In the calendar, a name that does NOT resolve (aggregated from a task/absence/shift but never added to the directory) opens the **Add Resource** modal prefilled with that name.

This extends the behavior the **workload** tab already implements to the calendar and planning grids. The directory and workload tabs already do this and are out of scope.

## Current state

- **Directory** (`resource-directory.tsx`): rows are `Resource` objects; the name is a button → `onEditResource(r)`. Hover style: `rounded-md border border-transparent px-2 py-0.5 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:text-AIPM-light-grey dark:hover:bg-zinc-800`.
- **Workload** (`resource-workload.tsx`): canonical version. Matched name → `onEditResource(row.resource)`; unmatched → `onAddResource({ firstName, lastName, email: email || undefined })`. Button class is the directory style **plus** `focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-dark-blue` and `text-left`.
- **Planning** (`resources-panel.tsx`, ~line 371): each grid row is already a `Resource` (`r`); the name renders as plain `<td>` text. `onEditResource` is already a panel prop.
- **Calendar** (`resource-calendar.tsx`, ~line 194): rows are aggregated `CalendarAssignee` (`{ key, display, email }`) keyed by case-folded name, derived from tasks/absences/shifts — NOT from `resources`. The name renders as plain `<td>` text. The component does not currently receive `resources`, `onEditResource`, or `onAddResource`.

## Design

### Shared hover style

Reuse the **workload** button's classes verbatim (the canonical version — the directory style plus a `focus-visible` ring for keyboard accessibility):

```
rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-dark-blue dark:text-AIPM-light-grey dark:hover:bg-zinc-800
```

Note: this carries `shadow-sm`. It stays for now and is stripped app-wide in the later D+E sub-project — keeping it now makes A consistent with the rest of the current app.

### Planning grid (`resources-panel.tsx`)

The grid row is already a `Resource` (`r`), and `onEditResource` is already a panel prop. Replace the plain name `<td>` content `{resourceDisplayName(r)}` with a `<button type="button">` using the shared style, `onClick={() => onEditResource(r)}`, `title={resourceDisplayName(r)}`.

No new props. No unmatched case (the planning grid iterates `resources`, so every row is a real resource).

### Calendar (`resource-calendar.tsx`)

Add three required props to `Props`:
- `resources: readonly Resource[]`
- `onEditResource: (resource: Resource) => void`
- `onAddResource: (seed: Partial<Resource>) => void`

Inside the component, build a case-folded lookup with `useMemo`:

```
const resourceByKey = useMemo(() => {
  const m = new Map<string, Resource>();
  for (const r of resources) m.set(resourceDisplayName(r).trim().toLowerCase(), r);
  return m;
}, [resources]);
```

The map key (`resourceDisplayName(r).trim().toLowerCase()`) matches how `CalendarAssignee.key` is already built in `resources-panel` (`assignee.trim().toLowerCase()`), so matched assignees join correctly. Name collisions are last-wins — a rare, pre-existing ambiguity, acceptable.

Replace the plain row-label `<td>` content `{row.display}` with a `<button type="button">` using the shared style, `title={row.display}`, and:

```
const res = resourceByKey.get(row.key);
onClick={() =>
  res
    ? onEditResource(res)
    : onAddResource({ ...splitName(row.display), email: row.email || undefined })
}
```

`splitName` and `resourceDisplayName` are imported from `./resource-foundation`. The seed shape (`firstName`, `lastName`, `email`) matches what the workload tab passes to `onAddResource`.

### Wiring (`resources-panel.tsx`)

`onEditResource` and `onAddResource` are already panel props (threaded from `task-manager.tsx` as `guardEdit(handleEditResource)` / `guardEdit(handleOpenAddResource)`). Forward all three (`resources={resources}`, `onEditResource={onEditResource}`, `onAddResource={onAddResource}`) into the existing `<ResourceCalendar>` render. No new upstream plumbing.

## Non-goals

- No styling/color/shadow changes beyond adopting the existing button (that is the D+E sub-project).
- No behavior change to absence cells, the calendar legend, or the planning utilization/cost cells.
- No edits to the directory or workload tabs (already done).
- No new i18n keys (the name's `title`/`aria` use the existing display string; the edit/add modals are unchanged).

## Edge cases

- **Unmatched calendar name:** opens Add Resource prefilled (chosen behavior). `splitName` splits on the first space ("Sample Anne Dummy" → first "Sample", last "Anne Dummy").
- **Empty email:** seed passes `email: undefined` (never `""`), matching workload.
- **Name collision** (two resources, same display name): last one wins in the lookup map. Pre-existing ambiguity; acceptable.
- **Calendar with zero resources:** the lookup map is empty, so every name is treated as unmatched → Add Resource prefilled. Correct (nothing to edit yet).

## Testing

- **Calendar component test (`resource-calendar.test.tsx`):** render with a row whose name matches a resource → the name is a `button`; clicking calls `onEditResource` with that resource. Render with an unmatched row → clicking calls `onAddResource` with `{ firstName, lastName, email }` derived from the name. Update the existing calendar test render(s) to pass the three new props.
- **Planning test (`resources-panel.test.tsx`):** in the planning view, the resource name is a `button`; clicking it calls `onEditResource` with that resource.

## Release

Patch → **0.14.3** (keep the "Atwood" codename). Do NOT add a highlight key (consistent with the 0.13.1/0.14.1/0.14.2 patch policy). Bump `version.ts`, add a `[0.14.3]` CHANGELOG entry, note the calendar/planning assignee click in `docs/CODEMAPS/frontend.md`. Gates: lint 0, tsc 0, `test:coverage` green (≥70%).
