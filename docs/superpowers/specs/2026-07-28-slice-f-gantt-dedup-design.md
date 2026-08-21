# Slice F — Gantt dedup button

_Opened 2026-07-28 against 0.205.0 "Griffith". Third slice of
`2026-07-27-ux-batch-roadmap-design.md` (order C → D → **F** → A → E → S6 → S7 → B)._

## Scope — confirmed with the user, 2026-07-28

The roadmap line is one cell: "Gantt: dedup button". Two readings were possible (add the AI
dedup trigger; or remove a duplicated control). **Confirmed: add the AI "Deduplicate & unify"
trigger + review modal to the Gantt toolbar**, the same feature Open Points already has. Nothing
else folds into this slice.

Rationale: Gantt renders the same task set. A duplicate pair is arguably *more* visible there
(two bars, same span, same name) than in the table, and the user currently has to leave the view
to act on it.

## What already exists

`useTasksDedup` (`use-tasks-dedup.tsx`, 195 lines) is already a self-contained glue hook returning
`{ button, modal }` — the whole propose → preview → confirm state machine, the forced Anthropic
call, the re-grounding of untrusted model ids, the undo capture and the activity log entry. It is
consumed once, by `tasks-section.tsx:277`.

So this slice adds **no engine, no AI tool, no persisted field, no i18n string for the feature
itself**. It is a second mount of an existing hook plus the wiring to reach it.

Gating is inherited unchanged: `isAiEnabled && !isPopout && apiKey && tasks.length >= 2`, else the
hook returns `button: null` and the toolbar renders nothing.

## Constraint that shapes the whole design — the size ratchet

Measured 2026-07-28 (`scripts/check-file-sizes.mjs` counts `split("\n").length`, i.e. wc -l + 1):

| File | Lines | Baseline | Headroom |
|---|---|---|---|
| `workspace-section.tsx` | 966 | 966 | **0** |
| `task-manager.tsx` | 2974 | 2974 | **0** |
| `tasks-section.tsx` | 1070 | 1073 | 3 |
| `gantt.tsx` | 763 | — (cap 800) | 37 |
| `gantt-chrome.tsx` | 489 | — (cap 800) | 311 |

Both files a naive wiring would touch are frozen at exactly their baseline. This is the
constraint slice C flagged ("check the headroom of every file a slice touches **before** planning
it") arriving in its worst form: **zero**, not "some".

The hook's deps are all reachable from contexts *except one*:

| Dep | Source available under Gantt |
| --- | --- |
| `settings`, `lang` | `useSettings()` |
| `tasks`, `setTasks` | `useWorkspace()` |
| `isPopout` | `useWorkspaceTab()` (also already a `GanttPanel` prop) |
| `logActivity` | `useActivityLogger()` — context exists, returns `null` when unmounted |
| `capture` (undo) | **prop only** — `UndoStackApi["capture"]`, single stack created in `task-manager.tsx:211`, no context |

Dropping `capture` was rejected: dedup **deletes tasks**, and the Open Points path records one
undo entry covering the removed duplicates plus the edited keep rows. A Gantt path without it
would be a destructive AI action with no way back.

## Decision 1 — extract `gantt-view.tsx` (user choice over bumping the baseline)

`workspace-section.tsx` keeps its Gantt **tabpanel**; the `GanttPanel` call moves into a new lazy
glue component that owns the dedup mount.

```
workspace-section.tsx        →  <GanttView … />        (fewer lines than the block it replaces)
gantt-view.tsx      (new)    →  contexts + useTasksDedup + <GanttPanel dedupButton={…}/> + {modal}
gantt.tsx                    →  new optional  dedupButton?: ReactNode  → GanttToolbar
gantt-chrome.tsx             →  renders {dedupButton} after the add buttons
```

The call site loses seven props that `GanttView` reads from context instead
(`lang`/`tasks`/`absences`/`resources`/`milestones`/`isPopout`/`onLearnMore`) and gains two
(`onCaptureUndo`, `milestonesEnabled`) — a **net reduction**, which is what buys the headroom.
The alternative (`check-file-sizes.mjs --update`, 966 → 968) was rejected by the user: it is
exactly the creep the ratchet exists to stop, and every later slice would cite the precedent.

★ `GanttView` must be the **lazy** export in `workspace-panels.tsx`, replacing `GanttPanel` there
(nothing else imports the lazy `GanttPanel`) — otherwise the chart, which is lazy today, would start
loading eagerly. Function props survive `dynamic(ssr:false)` here — the shipped `GanttPanel` lazy
export already takes `onUpdateBar`/`onAddTask`.

★★ CORRECTION to an earlier draft of this line, caught in pre-merge review: the lazy boundary does
**not** keep the dedup call/engine/modal out of the main bundle. `tasks-section.tsx` imports the same
hook and is imported STATICALLY by `task-manager.tsx`, so that code ships either way. The reason to
keep `GanttView` lazy is purely to preserve the chart's existing laziness — do not defend it as a
bundle-size win.

★ `workspace-section.characterization.test.tsx` mocks `"./gantt"` and asserts
`data-testid="gantt-panel"`. `GanttView` imports `GanttPanel` from `"./gantt"`, so the mock still
lands. It renders inside the real `WorkspaceProvider`/`WorkspaceTabProvider` with `use-settings`
mocked, so the context reads resolve; `useToastContext` has a no-op default value and needs no
provider.

## Decision 2 — qualify the Gantt trigger's accessible name (user choice)

★★ **In CLASSIC layout `TasksSection` and `WorkspaceSection` mount simultaneously**
(`task-manager.tsx:2781-2782`), so with Gantt active both dedup buttons are in one DOM. Two
controls announcing "Deduplicate & unify tasks" is WCAG 2.4.6, and **the axe gate cannot see a
duplicate accessible name — only a missing one** (the slice-C lesson, which shipped this exact
bug once already). Gantt *is* axe-scanned, and a green run would say nothing.

The Gantt instance therefore takes an optional qualifier: accessible name becomes
`Deduplicate & unify tasks – Gantt` (`t(lang,"tabGantt")`), visible text unchanged. Open Points
is left alone (user choice) — re-baselining an existing axe-scanned view's accessible name is
churn this slice does not need.

WCAG 2.5.3 (label in name) still holds in EN: visible `taskDedup` = "Deduplicate & unify" ⊂
accessible `taskDedupTitle` = "Deduplicate & unify tasks" ⊂ the qualified form.

★ **Pre-existing, NOT introduced here:** in DE the visible label is "Duplikate &
vereinheitlichen" while the accessible name is "Aufgaben deduplizieren & vereinheitlichen" —
the visible string is *not* a substring, so the shipped Open Points button already fails 2.5.3 in
German. Qualifying only appends, so this slice neither fixes nor worsens it. Recorded as a
follow-up, not fixed here (it would re-baseline an axe-scanned view's name, i.e. the churn
decision 2 just declined).

## Behaviour

- Position: after `+ Add task` / `+ Add milestone`, **before** the search input — mirroring Open
  Points (Add · [Jira sync] · dedup). ★ `gantt.test.tsx` has a source-order assertion pinning
  `onClick={onAddTask}` ahead of this file's `type="search"`; inserting between them keeps it true.
- The proposal always considers the **whole** task list (`buildDedupContext(tasks)`), never the
  Gantt's filtered/sorted subset — the same tasks the Open Points button would see. A filter is a
  view state, not a scope for a destructive merge.
- The two mounts hold **independent** state machines. Only one can be visible at a time in modern
  layout; in classic both exist but each modal is opened by its own trigger. No shared state, no
  cross-talk, and the apply path is a functional `setTasks` either way.

## Out of scope

- Hoisting to a single shared instance in `task-manager` — both candidate hosts are frozen at
  their ratchet baseline, and one state machine would not change any user-visible behaviour.
- Any Gantt-specific dedup heuristic (e.g. "same span" as a signal). The engine is untouched.
- The DE 2.5.3 mismatch above.
