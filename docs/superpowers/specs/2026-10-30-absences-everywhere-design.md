# Claude respects absences in every AI feature (§773, #862) — design

Status: draft for owner approval, 2026-10-30.

## Intent

The owner, 2026-10-23: Claude should know and respect absences whenever it plans work or moves dates, not only in
Plan with AI. Today only Plan with AI does (its available hours deduct absences and holidays). The chat can list
absences but is told to look only on the Calendar view; a date set by the chat, inline AI edit or the WBS plan lands in
someone's vacation without a word; the WBS plan, Analyze with AI, insight recommendations and the steering report never
see absences at all.

## Owner decisions (2026-10-30)

1. **All AI features are in scope** — those that write dates or plan work, and those that only analyse or report.
2. **Writers warn, never refuse.** When an AI-written date clashes with an absence, the preview shows a warning, the
   chat's tool result tells Claude so it can offer another date, and the WBS plan's review window marks the row.
   Nothing is blocked.
3. **What counts as a clash** (approved rule): for the person whose work it is,
   - the work's date (a task's due or start date, a milestone's date) — new, moved, or newly theirs by decision 7 —
     falls on one of their absence days, or
   - for a task with a span, they are absent on MORE THAN HALF of its working days (start to due, weekends and
     holidays excluded).
   A milestone's people are the owners of its linked tasks (`Milestone.linkedTaskIds`).
4. **Analysing and reporting features** get a short "who is away soon" summary in what their AI sees, so findings can
   account for absences. They write no dates, so they get no warning.
5. **Approach A**: one shared pure check plus one shared summary builder, called from each AI path. Rejected: B, a
   check in the write layer for every date write (no preview to warn in, and it would flag manual edits, which were
   not asked for); C, instructions only (what fails today: the chat can list absences but nothing makes it look).
6. **A clash forces a preview.** A single chat write is applied at once today (`shouldStage` in chat-proposal.ts stages
   only two or more writes). A single date-setting write that clashes is staged instead, so the user sees the warning
   and approves before anything is written; a write with no clash still applies at once. This makes staging depend on
   workspace data for the first time (`shouldStage` is a pure function of the call list today): the clash check runs
   before the stage decision, with the absences and holidays the dispatcher already holds.
7. **Putting work on a person is checked, not only moving a date.** Any AI change that gives a person work is checked
   against that person's absences with the same rule: a new or moved date, a new owner on a task (its existing dates
   now fall to them), and a task newly linked to a milestone (its owner joins the milestone's people).
8. **Design choices go to the owner** (standing): a choice this document does not settle that changes what the user
   gets is asked, not guessed.

## Goals

- No AI feature can put a person's work on a day they are away without the user seeing it before it is written.
- The chat is told, on every view, to check absences before it sets a date.
- Every AI feature that plans or judges work sees who is away soon.
- One rule, tested once, shared by every path.

## Non-goals

- Warnings on MANUAL date edits (the task editor, Gantt drag, Kanban). This is about Claude.
- Refusing or auto-shifting a date. The user decides.
- Changing how absences are stored, edited or shown (the absence edit modal is being reworked elsewhere).
- Plan with AI's hour planning (§769) — it already deducts absences; it only gains the warning on task moves if a move
  sets no date (it doesn't), so it is untouched.

## Anti-goals

- **Noise**: warning on every task that merely overlaps a day off. The half-span rule exists for this.
- **A different rule per feature**: every path calls the one check.
- **Leaking what an absence is**: the AI sees only "absent" and the dates — never the type or note (the chat's
  `list_absences` already hides them; the summary follows the same rule).
- **Prompt injection** through a person's name in the summary: names one line and quoted, as §769 does.
- **A heavier call for small projects**: the summary is capped and omitted when nobody is away in the window.

## The shared pieces (new, pure, i18n-free)

- **`absence-clash.ts`** (name is the builder's): given the person (a resource, or an unlinked typed name matched the
  way `absencesForResource` and the due-date reminders match), the absences, the holiday set and the dates being set,
  return the clashes: which person, which absence date range(s), and why (`date-on-absence` or
  `absent-most-of-span`). Absence days use the same per-day expansion the due-date reminders use
  (`due-dates.ts`), so "absent" means the same everywhere.
- **The summary builder**: "who is away" for a window (proposal: today to four weeks ahead; for the WBS plan, the
  project window up to a cap), one line per person — `#id "Name" away 2026-11-03..2026-11-07, 2026-11-20` — capped
  (builder sets the cap, start near 60 lines), with a truncation line, and omitted entirely when nobody is away.
- **Notice text**: one EN and DE formatter for the warning ("Maya Patel is absent 3–7 Nov" / "…is away for most of
  this task's working days"), used by every preview.

## Where it is called

Writers (warn):
- **Chat** — the task and milestone write tools (`create_task`, `update_task`, the milestone create/update tools):
  when a written date clashes, the tool result carries the clash (so Claude can propose another date), and the
  confirmation/preview the user sees shows the warning. A staged chat plan shows it per step.
- **Inline AI edit** — for task and milestone date fields: the proposal preview shows the warning beside the date.
- **Plan the WBS with AI** — the digest gets the summary for the project window; the review window marks a proposed
  task or split piece whose dates clash for its assignee.
- **Chat guide** — the rule "a clash or availability answer, and any date you set for a person's work, needs
  `list_absences` (and the calendar events for a clash)" moves from the Calendar-only section of
  `lib/app-feature-guide.md` to a part every view receives.

Readers (summary only):
- **Analyze with AI and scheduled analysis** share one digest: `buildWideContext` (use-ai-orchestration.ts) and the
  background run (scheduled-job-run.ts) both go through `buildProjectAnalysisInput` (project-analysis-input.ts) and
  `buildProjectDigest` (project-digest.ts). One change covers both. The digest is capped at `DIGEST_MAX_CHARS` and
  drops lines from the END, so the summary must sit where it survives the cap; the background run has no holiday
  calendar (`NO_HOLIDAYS`). (`buildAnalysisContext` in action-ai.ts now feeds only the weight-suggestion call.)
- **Insight recommendations** (`insights/recommend-context.ts`, `buildRecommendContext`) get the summary, and they are
  ALSO writers: `ALLOWED_REC_TOOLS` includes the task and milestone create/update tools, applied after the review
  modal, so they get the warning too (see Constraints).
- **The steering report** (`committee-report/report-draft.ts`, `buildMeetingReportPrompt(model, agenda, lang)`, called
  from report-call.ts; it takes only the `DashboardModel`, so its signature and caller gain the absences). The parallel session
  confirmed (2026-10-30) that its PR #920 leaves this file and the prompt unchanged, but it does change
  `use-meeting-report-actions.ts` (the caller): touch only `report-draft.ts`, or expect a conflict until #920 merges.

## Constraints

- i18n: every new string in EN and DE; DE edited by node utf8 script, real umlauts.
- The AI master switch, popout guards and the load hold are unchanged.
- The chat staged card (`describeProposal`), the inline AI edit popover and the insight review modal already share one
  preview builder, `describeEntityCalls` (`inline-ai-edit/plan.ts`) and its `EditPlan`: the clash is added THERE, so
  all three show it; none receives a holiday set today, so it is threaded in. The WBS review window is separate.
- PR #920 (parallel session) touches use-chat-dispatcher.ts, use-chat-dispatcher-wiring.ts, chat-dispatcher-types.ts,
  i18n, task-manager.tsx and the chat dispatcher test fixture: expect conflicts there until it merges.
- `src/app/*` files are CRLF; the guide markdown follows its own generator (check how `lib/*.md` reach the app —
  `operating-guide-builtin.generated.ts` suggests a generated file that must be regenerated, not hand-edited).
- Token budgets: each digest's growth stays within the call's existing budget; a size test for the WBS digest.

## Calls I made (owner may override)

- The summary window is today plus four weeks for the readers, the project window for the WBS plan.
- A milestone's people are the owners of its linked tasks; a milestone with no linked tasks gets no check.
- An unlinked (typed-name) owner is matched to absences by name, as the due-date reminders do.
- No AI path sets a task `startDate` today; the half-span rule uses the stored start date with the new due date.
- WBS split pieces copy the original task's due date and owner, so a clash there already existed: only new tasks the
  WBS plan proposes are marked (no noise on clashes the AI did not create).
- "The person": a linked task (`resourceId` set) is matched to absences the way `absencesForResource` does (by
  `resourceId` when the absence has one, else by name); an unlinked task by its typed name, case-insensitive. One
  matcher, used by every path.
- The availability rule also goes into the descriptions of the date-writing chat tools and `list_absences`
  (`chat-tool-defs.ts`), because the Overview guide can be switched off by the user.
- Holidays are not absences: a date on a public holiday is not a clash (the rule is about people being away).
- Half-span uses strictly MORE than half of the working days.

## Left to the builder

- Module names and exact signatures; the summary's line cap; how each preview lays out its warning.
- Finding the exact chat tool handlers and inline-edit preview points (the register entry names them only by tool).

## Done means

- Unit tests for the clash rule: date on an absence day, the half-span boundary (exactly half → no clash, more → clash),
  weekends and holidays excluded from the span, milestone via linked tasks, unlinked typed owner, no absence → nothing.
- A test per writer path that a clashing date shows the warning (and, for the chat, that the tool result carries it),
  each failing before its code.
- A test per reader path that the summary appears when someone is away and is absent when nobody is.
- The guide rule reaches a non-Calendar view (test on the per-view guide output).
- tsc, eslint, the static gate green; the full suite in CI.
