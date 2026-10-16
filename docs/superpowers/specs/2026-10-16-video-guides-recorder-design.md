# Video guides — the recorder (project A)

Status: draft for owner review, 2026-10-16. Register: §715.

## Why

New users learn the app faster from short videos than from reading help text. Today there is one
7-minute "getting started" video (`scripts/demo-video/record.mjs`), built on a project the recorder
types in by hand ("Acme Website Relaunch"). That project is too thin to show most functions: it has
no task links, no near-duplicate tasks, no history. The owner wants a full set of English videos,
hosted on YouTube, that the README and the app can point at — and wants to retake them whenever the
UI changes, so every video must come from a script, one command per video.

## The whole programme, and where this document sits

| Project | What | Order |
|---|---|---|
| D | Milestone drag in the Gantt (new app feature) | 1st — its own design |
| E | Demo data extension (`sample-workspace-small.json` + regenerated fixtures) | 2nd — its own design, fed by the data list at the end of this one |
| **A** | **The recorder: produces every video listed below** | **3rd — this document** |
| B | Upload to YouTube (the owner's channel, the owner's hands) | after A |
| C | In-app links (guided tour, help, first-open nudge) + README "Video guides" section | after B |

The owner chose this order (A's recording comes before C's links). D and E come before A because
A's clips show them. This document fixes what A records; it names what it needs from D and E but
does not design them.

## Goals

- **44 videos, English only**, in four tiers (owner):
  1. **Big video** (1) — the full walk-through, retaken.
  2. **Chapter videos** (8) — one per chapter of the big video.
  3. **AI clips** (15) — one per AI function in the app.
  4. **Feature clips** (20) — one per feature listed below.
- **One data source for all of them: the demo project** "Customer Identity Platform (demo)" (owner).
  The big video shows once how to set up a new project by hand through the wizard, up to its last
  step, then switches to the demo project instead of creating it (owner).
- **Every video retakes with one command**, independent of the others.
- **Every clip has the same shape:** opening text → steps shown live → a short closing beat
  (pattern from the owner's Gantt clip).
- AI clips make real Claude calls; the owner accepts the token cost, per take and per retake.

## Non-goals

- Uploading, YouTube titles/descriptions/chapters (project B).
- Any in-app link, nudge or README change (project C).
- German or any other language.
- Voice-over, music, video editing or cutting. Each video is one continuous take.
- The hand-recorded parts (Ch 1 install, 2.1 Turso database creation, 2.3 Anthropic key) — the
  owner records those; the recorder leaves their place in the chapter list.

## Anti-goals (a failure even if it technically works)

- Any database other than the `TURSO_THROWAWAY_*` one touched, or its host visible on screen.
- The Anthropic key, Turso token or any secret readable in a frame, a log line or a probe screenshot.
- A clip whose script asserts on AI wording, so a different but correct model answer fails the take.
- A clip that depends on state left behind by an earlier clip (order-dependent takes cannot be
  retaken one by one).
- Personal or client names anywhere — the repo is public; the demo's fictional names only.

## Constraints (carried from the current recorder, unchanged)

- Playwright `recordVideo`, 1280×720, headless Chromium, `locale: en-US`, `Europe/Berlin`.
- Clock pinned with `page.clock.install` (`L.T0`); the demo's dates shift relative to it.
- Injected cursor and caption overlay; the libsql host blurred (CSS + MutationObserver walker).
- `guardTurso` aborts any non-throwaway Turso host and counts it as a warning; a take with warnings
  exits 1.
- Scripts read only `TURSO_THROWAWAY_*` and `ANTHROPIC_API_KEY` from `.env.local`, masked in output.
- Never run beside `e2e:live-*` on the same database.
- Trends and History are Turso-only views, so the demo project is always created on Turso, through
  the app's own "Explore the demo" path (which also seeds the Trends weeks).

## How it works

### One command per video

```
node scripts/demo-video/record.mjs --video <id>      # record one video
node scripts/demo-video/record.mjs --tier clips      # every clip in a tier
node scripts/demo-video/record.mjs --all             # all 44
node scripts/demo-video/record.mjs --video <id> --rehearse   # no recording, check only
node scripts/demo-video/record.mjs --list            # print ids, titles, tier
```

Ids are stable slugs (`big`, `ch3-plan`, `ai-dedup`, `f-gantt`, …). Output:
`<OUT>/<tier>/<NN>-<id>.webm`, `NN` = position in its tier. `OUT` stays as today
(`DEMO_VIDEO_DIR` or `.superpowers/tmp/demo-video`, git-ignored).

### Every take starts clean

Each video is its own browser context and its own demo project: before a take the recorder deletes
any earlier demo project from the throwaway database (the existing `cleanup.mjs` logic, extended to
the demo's name), then the take opens the app on the empty state and clicks **Explore the demo**.
Clips that mutate data (Dedup merges tasks, a drag moves dates) therefore never leak into the next.
Creating the demo is off-camera for clips (recording starts after the demo has opened); in the big
video it is on camera.

★ Risk to check first in rehearsal: earlier this session a "changed in another tab" banner appeared
after creating the demo on Turso. If it still appears, it is an app bug to fix before recording, not
something the recorder works around.

### Video definitions are data

Each video is one entry in a definitions module (`scripts/demo-video/videos.mjs`): id, tier, title,
opening text, the steps, the closing beat, and its **preconditions** — the data the clip needs to
show anything (e.g. `ai-dedup`: at least one near-duplicate pair among open tasks). Chapter videos
and the big video are compositions of the same step functions, so a step is written once.

### Rehearsal checks the data, not only the selectors

`--rehearse` walks every step without recording and, before the steps, checks each precondition
against the live demo project. A missing precondition fails the rehearsal with the clip id and what
was missing — that is the signal that project E's data is short, not that a selector broke.

### AI steps

- Wait for the AI result by its UI state (the trigger's busy state ending, a result list or modal
  appearing), never by its text. Upper bound per call; a timeout fails the take with the clip id.
- Where the AI proposes changes (Dedup, WBS, allocation, RACI, weights), the clip shows the proposal
  and applies it, so the viewer sees the effect.
- Show only the result on screen; no request/response logging to the console beyond a status line.

## The videos

Opening texts marked **(banner)** are the view's existing banner text (`viewHint*` in `i18n.ts`) —
the owner's choice for the Gantt, applied to every view that has one. Texts marked **(draft)** are
drafted here for the owner to correct. All step lists except the Gantt's are **drafts**: they become
final in the discovery pass, against the real controls.

### Tier 1 — big video (1)

`big`: chapters 2–8 below in one take, captions as chapter titles. Ch 1 and the hand-recorded parts
of Ch 2 are not in it (as today).

### Tier 2 — chapters (8)

| Id | Chapter | Content (draft) |
|---|---|---|
| `ch1-install` | 1 Install | hand-recorded by the owner — no script |
| `ch2-connect` | 2 Connect storage and Claude | 2.2 paste Turso URL/token, test · 2.4 paste key · 2.5 first chat prompt (2.1, 2.3 hand-recorded) |
| `ch3-plan` | 3 Plan | wizard to its last step (AI proposal shown) → cancel → Explore the demo → Open Points table, board, swimlanes, Gantt, milestones, changes |
| `ch4-people` | 4 People | directory, absences, planning, workload |
| `ch5-control` | 5 Risks and stakeholders | RAID, stakeholders, influence/interest, RACI, steering committee |
| `ch6-modules` | 6 Turn on what you need | modules, budget |
| `ch7-follow` | 7 Follow the project | dashboard digest, next actions, insights, trends, history, activity, knowledge |
| `ch8-help` | 8 Help | where the walk-through, the demo and these videos live |

The split of features into chapters is my call; the owner named the chapters' existence, not their
contents.

### Tier 3 — AI clips (15)

| Id | Where | Opening text (draft) | Steps (draft) |
|---|---|---|---|
| `ai-proposal` | New-project wizard | "Describe the project in a sentence and Claude proposes its setup." | type a one-line brief → show the proposal → step through to the last step |
| `ai-chat` | AI Assistant | "Ask the assistant anything about the project — it can also make the changes for you." | ask a question → ask it to create a task with a due date → show the task in Open Points |
| `ai-dedup` | Open Points | "Deduplicate & unify finds tasks that say the same thing and merges them." | Deduplicate & unify → review the pairs → apply → the merged rows |
| `ai-wbs` | Open Points | "Optimize with AI restructures open tasks into a clear breakdown." | Optimize with AI → review → apply |
| `ai-inline-task` | Open Points | "Ask Claude on any field to rewrite or fill it." | open a task → Ask Claude on the description → accept |
| `ai-inline-entity` | RAID | "The same works on RAID, changes, milestones and stakeholders." | RAID item → Ask Claude on mitigation → accept |
| `ai-next-actions` | Next actions | "Analyze with AI explains what needs you first, and why." | Analyze with AI → read the result |
| `ai-insight` | Insights | "Each insight can get a recommendation you can act on." | Generate recommendation on one insight → act on it |
| `ai-digest` | Dashboard | "The digest sums up what changed since you last looked." | Generate now → the narrative |
| `ai-alloc` | Resources | "Plan with AI proposes who works how much, when." | Plan with AI → review → apply → workload |
| `ai-raci` | RACI | "Suggest RACI fills the matrix from your milestones and people." | Suggest RACI → review → apply |
| `ai-steering` | Steering committee | "Draft the steering report from the project's current state." | open a meeting → Draft with AI → the report |
| `ai-forecast-import` | Forecast | "Import a forecast from a spreadsheet; Claude maps the columns." | import the fixture file → Ask Claude → mapping → apply |
| `ai-weights` | Settings → Next actions | "Claude tunes how next actions are ranked from what you acted on." | Suggest with AI → accept a suggestion |
| `ai-scheduled` | Settings → Scheduled jobs | "Scheduled jobs run an AI check on the project for you." | the prepared job → run now → its analysis |

### Tier 4 — feature clips (20)

| Id | Opening text | Steps (draft unless noted) |
|---|---|---|
| `f-open-points` | (banner) Open points | add a task · sort · filter by assignee · set a status |
| `f-board` | (draft) "The same tasks as a board — drag a card to change its status." | switch to Board · drag a card to the next column |
| `f-swimlanes` | (draft) "Swimlanes group the board by person or group." | switch to Swimlanes · change the grouping |
| `f-gantt` | (banner) Gantt | **owner's script, fixed — see below** |
| `f-milestones` | (banner) Milestones | the list · add a milestone · the horizon |
| `f-changes` | (banner) Changes | open a change · its impact fields · status |
| `f-directory` | (banner) Resources | the directory · open a person · roles and rates |
| `f-absences` | (draft) "Log vacation, training and other time off — it shows on the Gantt and in workload." | add an absence · see it in the calendar |
| `f-planning` | (banner) Planning | set capacity per period for one person |
| `f-workload` | (banner) Workload | spot an overloaded week · reassign |
| `f-raid` | (banner) RAID | the four types · open an issue · link a task |
| `f-modules` | (draft) "Turn functions on or off per project, so the app shows only what you use." | Settings → modules · switch one on · it appears in the nav |
| `f-budget` | (banner) Budget | the four setup steps · plan vs actual |
| `f-trends` | (banner) Trends | the weekly history · pick a baseline |
| `f-stakeholders` | (banner) Stakeholders | the list · open one |
| `f-raci` | (banner) RACI | the matrix · set one cell |
| `f-influence` | (banner) Stakeholder map | drag a stakeholder to another quadrant |
| `f-knowledge` | (banner) Knowledge | filter by source · search · jump to the item |
| `f-activity` | (draft) "The activity log records who changed what, and when." | the log · filter |
| `f-history` | (draft) "Version history keeps every saved state — compare and restore." | open History · compare two versions |

#### `f-gantt` — fixed by the owner

1. Opening text: "The Gantt chart shows tasks and milestones on a timeline. Link dependencies to see
   what must finish before what."
2. **Deduplicate & unify** runs live (owner accepts the token cost).
3. **Drag a task bar:** move the whole bar (start moves, duration kept), drag the right edge (end
   moves), drag the left edge (start moves) — duration visibly changes.
4. **Drag a milestone to a later date** — a real drag; needs project D.
5. **Status filter:** deselect Completed.
6. **View menu**, each toggled and captioned: Dependencies, Absences, Critical path, Milestones,
   Inline milestones.

(The owner removed "add task, add milestone" from this clip.)

## What A needs from project E (demo data)

Checked against `sample-workspace-small.json` on 2026-10-16 (35 tasks, 23 Done, 22 with
dependencies, 14 RAID, 6 milestones, 7 stakeholders, 5 resources, 5 absences, 5 insights,
1 steering committee with meetings, 4 knowledge items, 1 document, 33 activity entries):

| Clip(s) | Need | Today |
|---|---|---|
| `f-gantt`, `ai-dedup` | 2–3 near-duplicate pairs among open tasks | none |
| `ai-wbs` | enough open, loosely structured tasks to restructure | 12 open |
| `f-gantt` | an absence overlapping an open task bar of its assignee, after the date shift | unchecked |
| `f-gantt` | a dependency chain ending in a milestone, for the critical path | present (design → cutover); verify after shift |
| `f-gantt` | Completed tasks inside the visible window, so the filter visibly hides bars | 23 Done; verify window |
| `ai-forecast-import` | a forecast spreadsheet fixture shipped beside the data | none |
| `ai-weights` | a next-actions learning history | probably none |
| `ai-scheduled` | a scheduled job configured | none |
| `f-workload`, `ai-alloc` | at least one overloaded week | unchecked |
| `f-raci`, `ai-raci` | an empty or partial RACI matrix | empty (good for `ai-raci`; `f-raci` sets one cell) |
| `f-history` | at least two saved versions | to check — may come from the take itself |

Changing the master means regenerating `-big`/`-huge` and the golden fixtures; that is E's work.

## What A needs from project D (milestone drag)

A milestone on the Gantt can be dragged horizontally to a new date, and the change persists like
any other milestone edit. Keyboard operability, undo and snapping are D's to decide.

## Decisions after the builder check (my calls unless marked)

- **Opening and closing look (owner):** the opening text shows in the existing caption bar at the
  bottom, with the app already visible behind it, as the big video does today. The closing beat holds
  the last frame about 2 s with the clip title in the caption bar. No full-screen title cards.

- **The demo-on-Turso banner bug** ("changed in another tab" after Explore the demo) is fixed as its
  own small app fix, with a test, **before** A. It is not part of A; A's first rehearsal confirms it.
- **The current recorder is replaced.** `record.mjs` becomes the new entry point; the Acme flow goes;
  `--probe` stays. `ch1-install` appears in `--list` as a hand-recorded placeholder and is skipped, so
  `--all` records 43 videos.
- **Credentials per take:** each fresh context connects Turso and enters the Anthropic key **through
  the app's own Settings, off camera**, exactly as the current 2.2/2.4 steps do. No test-only shortcut,
  no change to the secrets-at-rest rule. (`ch2-connect` and `big` show it on camera.)
- **State that is not workspace data** — a scheduled job (`ai-scheduled`), a next-actions learning
  history (`ai-weights`), saved versions (`f-history`) — is created by **A**, in each clip's off-camera
  setup, through the app's UI. E covers workspace data only. `cleanup.mjs` is extended to clear those
  stores (scheduled jobs, learning, version history, snapshots) for the demo project, so takes stay
  order-independent.
- **One clock for all takes:** every take runs at `L.T0`; only `ch7-follow` and the big video's
  chapter 7 move three weeks forward, as today. E checks its data at `T0` and at `T0 + 3 weeks`.
- **Partial runs:** `--all` and `--tier` record every video whose preconditions pass and list the ones
  skipped; any skip or warning makes the exit code 1. A can land and be retaken in stages while D or
  E is unfinished.
- **AI outcome check:** after an AI step the recorder checks structure, not wording — e.g. Dedup
  returned at least one pair, WBS at least one change, RACI at least one filled cell. If the structure
  is empty the step retries once (one more call), then the take fails with the clip id.
  `--rehearse` skips AI calls by default (checks the trigger is enabled and the preconditions hold);
  `--rehearse --with-ai` makes them.

## Left to the builder

- The definitions module's exact shape and how step functions compose into chapters.
- Waits, pacing and caption timing (current values are the starting point).
- How each precondition is checked (UI read vs. reading the workspace through the page).
- File numbering inside a tier.

## Calls I made (for the owner to check)

- Each take deletes and re-creates the demo project, so takes are order-independent.
- The chapter contents (which feature sits in which chapter).
- `ai-inline-entity` is one clip on RAID covering all four entity registers.
- Dedup appears twice: inside `f-gantt` (owner) and as its own clip `ai-dedup` on Open Points.
- All drafted opening texts and step lists.
