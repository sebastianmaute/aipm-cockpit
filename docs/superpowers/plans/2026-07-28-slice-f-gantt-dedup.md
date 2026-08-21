# Slice F plan — Gantt dedup button

Spec: `specs/2026-07-28-slice-f-gantt-dedup-design.md`. Roadmap:
`specs/2026-07-27-ux-batch-roadmap-design.md` (C → D → **F** → A → E → S6 → S7 → B).

Implemented in-session (no implementer subagents): 7 files, all decisions already locked, and
reviewer subagents have returned nothing for six consecutive sessions.

## Task 1 — `useTasksDedup` takes an optional trigger qualifier

`src/app/use-tasks-dedup.tsx`

- Add `triggerQualifier?: string` to `TasksDedupDeps` (a **translated** string, like every other
  qualified label in the app — the hook does no i18n of its own beyond `t(lang, …)`).
- Button `aria-label` + `title` become `` `${t(lang,"taskDedupTitle")} – ${qualifier}` `` when set,
  unchanged otherwise. Visible child text is untouched (WCAG 2.5.3).
- Nothing else changes: gating, phases, abort/generation guards, apply, undo capture all stay.

**Verify:** existing `tasks-section` dedup tests still pass byte-for-byte in behaviour (no
qualifier passed there ⇒ name unchanged).

## Task 2 — toolbar slot

`src/app/gantt-chrome.tsx` — `GanttToolbar` gains `dedupButton?: ReactNode`, rendered immediately
after the two `AddButton`s and **before** the `ClearableSearchInput`.

`src/app/gantt.tsx` — `GanttPanel` gains `dedupButton?: ReactNode`, threaded straight to
`GanttToolbar` (both render sites: the empty-state early return renders the toolbar too — check
which branches build it and keep them consistent).

★ Do not touch the comment above the search input: `gantt.test.tsx` pins add-before-search source
order in `gantt-chrome.tsx`.

## Task 3 — `gantt-view.tsx` (new)

Lazy glue component. Reads from contexts: `useSettings()` (settings, lang), `useWorkspace()`
(tasks, absences, resources, milestones, setTasks), `useWorkspaceTab()` (isPopout,
requestHelpConcept), `useActivityLogger()` (nullable → `?? undefined`).

Props (from `workspace-section`): `onUpdateBar`, `onAddTask`, `onEditTask`, `onAddMilestone`,
`onEditMilestone`, `showHints`, `milestonesEnabled`, `baselineMilestoneDates`, `onCaptureUndo`.

```tsx
const dedup = useTasksDedup({
  settings, isPopout, lang, tasks, setTasks,
  capture: onCaptureUndo,
  logActivity: logActivity ?? undefined,
  triggerQualifier: t(lang, "tabGantt"),
});
return <>
  <GanttPanel … dedupButton={dedup.button} />
  {dedup.modal}
</>;
```

★ `milestones={milestonesEnabled ? milestones : []}` — keep the gate, it lives at the call site
today.

## Task 4 — swap the call site

`src/app/workspace-panels.tsx` — replace the lazy `GanttPanel` export with a lazy `GanttView`
(`() => import("./gantt-view").then((m) => m.GanttView)`), same `PanelSkeleton` fallback.

`src/app/workspace-section.tsx` — the Gantt tabpanel renders `<GanttView …>` with the nine props
above. **Must end with fewer lines than before** (ratchet headroom is 0).

**Verify:** `node scripts/check-file-sizes.mjs` — `workspace-section.tsx` ≤ 966.

## Task 5 — tests

1. `gantt-view.test.tsx` (new): with AI enabled + ≥2 tasks, the toolbar shows a button whose
   accessible name is `Deduplicate & unify tasks – Gantt`; with AI disabled it shows none.
2. Uniqueness guard: the Gantt trigger's accessible name **differs** from the Open Points one —
   the WCAG 2.4.6 claim of decision 2, and the thing axe cannot see. Mirrors slice D's
   `clear-label-uniqueness.test.tsx`.
3. `gantt-chrome`/`gantt`: `dedupButton` renders inside the toolbar, positioned after the add
   buttons and before the search input.

**Mutation (aim at the CLAIM, read WHICH assertion failed — slice C lesson):**
- Delete the `triggerQualifier` branch in the hook ⇒ test 2 must fail on the *name inequality*
  assertion, not on a neighbour.
- Drop `dedupButton` from `GanttToolbar` ⇒ test 1 and 3 fail on the button lookup.
- Drop `capture: onCaptureUndo` in `gantt-view` ⇒ an assertion that the hook received it fails.
  (Undo is the reason this slice needed a new file at all; it must be pinned, not assumed.)

## Task 6 — release chain

- `src/app/version.ts` (APP_VERSION + milestone codename — **grep `CHANGELOG.md` first**, ~230 used).
- `CHANGELOG.md` entry.
- New `versionHighlight*` key → `APP_HIGHLIGHT_KEYS` + EN **and** DE strings (DE via a node utf8
  write, then grep-verify — the Edit tool corrupts umlauts in the CRLF `i18n.de.ts`).
- Gates: `npm run lint` · `npx tsc --noEmit` · `npm run test:run` · `npm run test:coverage` ·
  `npm run dup:check` · `npm run size:check` · axe on Gantt
  (`npx playwright test e2e/a11y.spec.ts --project=chromium -g "Gantt"`).
- ★ Mandatory roadmap step: re-archive `docs/superpowers/` **cumulatively** —
  merge the previous zip's entries, assert `set(old) - set(new) == ∅`. Today already holds
  `_archive-slice-docs-2026-07-28.zip` **and** `…-2026-07-28-slice-d.zip`, so this one needs a
  distinct name again (`…-2026-07-28-slice-f.zip`) and must be a superset of the newest existing.

Nothing is pushed without an explicit instruction.
