# Video guides — the demo week (project E, and what it changes in A)

## Why

The owner's test for a demo video: a video is fake or thin when it does not show a working
workflow, the app being used for its intended purpose. A's first design
(`2026-10-16-video-guides-recorder-design.md`) organised the big video as a tour of views, one
feature after another. Nothing in it shows a project lead's real week: a problem arrives, you act on
it, and the actions ripple through the plan, the people, the risks and the money.

This document does two things:

1. **Designs project E**, the demo data, around one story that a week of work can follow.
2. **Replaces A's big video and chapter videos** with that week. A's 35 short clips (tiers 3 and 4)
   stay as they are, recorded on the same data.

## The programme after this document

| Project | What | Status |
|---|---|---|
| D | Milestone drag in the Gantt | merged (#763) |
| §747 | Workload signal reads the current period (defect) | first — its own PR |
| **E** | **Demo data for the week story — this document** | **after §747** |
| A | The recorder — its big video and chapters now follow "The week" below | after E; A's spec stays authoritative for everything this document does not replace |
| B, C | Upload, in-app links | unchanged |

Filed on the owner's word while designing this, for later: §743 (early warning before a milestone
slips), §744 (a weekend activity still open on Monday), §745 (a guided tour per clip), §746 (a guided
tour per project Function). Found by the builder check and to be fixed **before** E (owner): §747
(the workload signal read the plan's first period, not the current one).

## Goals

- **The story (owner):** the demo stays the customer identity project "Customer Identity Platform"
  for Northwind Retail Group. Its MVP was due last Friday and was not delivered because it is not
  operational.
- **What "operational" means (owner, carried to customer identity):** a working installation of the
  customer lifecycle end to end — register (the customer "joiner": sign-up, email verification, MFA
  enrolment), change (the "mover": email or profile change, a B2B user moving company account),
  delete (the "leaver": account closure, GDPR erasure) — with existing customers read from the legacy
  shop database (the source) and every lifecycle event provisioned to the CRM and the customer
  directory (the targets).
- **Why it failed (owner-approved):** registration works on screen, but provisioning to the CRM
  fails: new customers never reach the CRM, and erasure requests do not propagate — a GDPR exposure
  as well as a slip. The MVP demo to the customer was called off.
- **Monday opens on the slip (owner):** on Monday morning the Dashboard hero is the MVP milestone,
  overdue. "Slipped" means the date has already passed (owner).
- **The week is the big video (owner):** Monday to Friday, each day a chapter, each day using a
  different Open Points view, with the actions the owner listed (see "The week").
- **Manual first, then AI (owner):** each action is shown done by hand, then done with the AI
  function that does the same job.
- **Every Next-actions item at T0 is intended.** The list on Monday must look triaged: a short Now
  tier, a Soon tier fed by several different sources, a few monitor items — and nothing that does not
  belong to the story.

## Non-goals

- Reframing the demo as a workforce identity project (HR → Entra ID Joiner/Mover/Leaver). The owner
  chose to keep customer identity.
- An app change to make an "at risk" milestone win the hero (that is §743). The hero here comes from
  the overdue rule as it is.
- The guided tours of §745 and §746.
- A's 35 short clips: unchanged, except that they now run on the reworked data.

## Anti-goals (a failure even if it technically works)

- A Monday list cluttered with overdue tasks that have nothing to do with the story. Today's data
  would show four of them at a Monday T0 (tasks 4, 5, 6 and 27).
- Anything the video adds by hand already existing in the data (an "Integration Engineer" discipline or role,
  Noah's vacation already logged, the DPO already a stakeholder). The viewer must see it appear.
- Real personal or client names. The repo is public; fictional names only.
- A week that only works at the recorder's pinned date. The demo is also what real users open with
  **Explore the demo**; it must still read as a coherent project on any day (see "Dates").

## Constraints

- **One master file.** `sample-workspace-small.json` is the only hand-edited sample. `-big` and
  `-huge` are regenerated with `npx vite-node scripts/generate-sample-workspace.ts`, then the golden
  fixtures (`src/app/__fixtures__/golden-*`) are regenerated through the serializers — a legitimate
  input change, so regenerating them is correct here.
- **Tests that read the sample** must be found repo-wide (`grep -rln "sample-workspace-small" src e2e
  scripts`) and each labelled keep / migrate / recompute before editing; `e2e/seed-workspace.ts`
  reads it at module top level.
- **Dates move with `DEMO_AS_OF`** (`demo-workspace.ts`, today `2026-09-18`, a Friday) by whole
  months (`demoShiftFor`, plan granularity `month`). `shiftDate` keeps a shifted date on a
  working day, but which weekday it lands on changes, so "Friday" in the master is not Friday after
  a non-zero shift.
- **No schema change.** Everything here is data in existing fields. If a need turns out to require a
  new field, stop and bring it back.

## Dates

The recorder pins the clock. Its `T0` lives in `scripts/demo-video/lib.mjs` (today
`2026-11-02T09:00:00+01:00`, as A's spec also says); at that T0 the demo
shifts by +2 months and "last Friday" maps to a Sunday in the master.

**My call:** move the recorder's `T0` to **Monday 2026-09-21, 08:30 +02:00**. The shift is then 0,
master dates are what the viewer sees, and the master's `DEMO_AS_OF` (Friday 2026-09-18) is exactly
"last Friday" — the MVP's due date. The week runs Monday 21 to Friday 25 September; the demo is
created once on Monday, and each later day advances the page clock (`page.clock.setSystemTime`) to
08:30 that day, so overdue counts, next actions, activity dates and saved versions move with it.

For real users opening the demo on another day the month shift applies as today. Until the shifted
due date (the 18th, or the next working day the shift rolls it to) of a
month the MVP is not yet overdue and the hero shows the next-best item; that is acceptable (the
project still reads as coherent) and is not fixed here.

## The week (the big video; owner-approved)

Each day starts with a caption card ("Monday — a milestone slipped"). Each **manual → AI** pair shows
the hand action first, then the AI function. Owner's list of actions per week, placed by day:

### Chapter 2 end — prologue

Connect Turso and the Claude key (as today) → the wizard to its last step, with **AI proposal** →
cancel → **Explore the demo**.

### Monday — a milestone slipped (chapter 3)

| Manual | Then AI |
|---|---|
| Dashboard: read the hero (MVP target, overdue) and its reasons; read the delta strip — what changed since Friday (`dashboard-delta.ts`) | **Digest** → **Generate now**: Claude's status narrative of the project as it stands (current RAG, overdue, RAID, milestones; its own deltas compare against its previous run, which the seed below sets) |
| Next actions: read Now / Soon / Monitor | **Analyze with AI** on Next actions |
| Open Points **Table**: open "Integrate CRM provisioning", add the blocker "CRM API rejects erasure calls" (it is not in the data), move its due date to Thursday | — |
| Knowledge: search "CRM" → the CRM interface decision from design sign-off → jump to it | — |
| Next actions: the row "Update stakeholder: Elena Fischer" (`actionCommsTitle`; the sponsor must hear about the slip) → **Draft message**, which fills the stakeholder-update email template and opens it in the mail client (`handleDraftMessageFromAction`; not AI) | **AI Assistant**: the starter prompt "Stakeholder update" (`CHAT_STARTER_PROMPTS`) writes the update from the project's current state, slip included |

### Tuesday — re-plan (chapter 4)

| Manual | Then AI |
|---|---|
| Open Points **Board**: drag "Integrate CRM provisioning" from To Do to In Progress — work restarts with the blocker known (the data plants it To Do) | — |
| Delete one of the double-logged follow-ups by hand | **Deduplicate & unify** merges the rest |
| New change request "Add a CRM provisioning connector", one-line impact typed | **Ask Claude** on the impact field |
| Next actions: the row "Update stakeholder: Maya Patel" (linked to the pending MFA change) → **Draft message** (template email, as Monday) | **AI Assistant**: "Stakeholder update" again, asked to cover the MFA change and the re-plan |
| Add milestone "MVP re-demo" (Friday 2 October), linked to the demo task; move task 25 "MVP demo to the customer" to 2 October | **Ask Claude** on its description |
| Budget: open the bucket "Identity Platform – T&M" and read its planned hours per person | **Import forecast…** on that bucket: the team's re-plan spreadsheet, columns mapped by **Ask Claude** |

### Wednesday — people (chapter 5)

| Manual | Then AI |
|---|---|
| Roles: **Add discipline** "Integration Engineer", then a new role Integration Engineer × Senior with an internal and an external rate (a role is discipline × grade and has no name of its own; `Role` in `types.ts`) | — |
| New team member from the vendor's partner, in that role | — |
| Noah's planned vacation next week (he owns the CRM integration) | — |
| Workload: Maya's "Util (now)" cell is pink (over-allocated this month) → lower it by hand | — |
| Planning: the new member's capacity for one month | **Plan with AI** proposes the rest |
| Open Points **Swimlanes** by person: **Add person lane** → the new member (a person with no tasks has no lane until it is added), then drag one of the CRM follow-up cards into it | — |

### Thursday — risks, stakeholders, money (chapter 6)

| Manual | Then AI |
|---|---|
| RAID: the GDPR erasure issue gets an owner and a status; add the risk "connector licence lead time" | **Ask Claude** on the issue's mitigation |
| New stakeholder: Northwind's data protection officer (DPO) | — |
| RACI: set the DPO's cell on "MVP re-demo" | **Suggest RACI** fills the matrix |
| Stakeholder map: drag the DPO to high influence / high interest | — |
| Steering meeting (Thursday): open it and its agenda; the meeting approves the connector change AND the pending MFA change "Add MFA to SSO scope" (scheduled after the pilot) — set both to Approved | **Draft with AI** writes the report |
| The connector change is approved → Budget: new bucket "CRM connector (CR)" | — |
| Open Points: add the task "Order the connector licence" | **AI Assistant chat** creates "Confirm licence delivery" |
| Gantt: drag the MVP target to Thursday 1 October, the day the MVP is to be operational again (project D); "MVP re-demo" on Friday 2 October is the customer demo the day after | — |

### Friday — close the week (chapter 7)

| Manual | Then AI |
|---|---|
| Open Points **Table**: mark "Integrate CRM provisioning" Done (erasure verified end to end); the GDPR RAID issue → Resolved (an Issue has no "Mitigated"; `ISSUE_STATUSES`) | — |
| Dashboard: the hero is now "Update stakeholder: <the DPO>" — the re-demo on 2 October falls inside the DPO's 14-day lead (high influence / high interest, set Thursday) → **Draft message** to tell the DPO the erasure fix is verified | **AI Assistant**: "Stakeholder update" for the DPO |
| Insights: read them | **Generate recommendation** on one → act on it |
| Restructure one rollout task by hand: split task 34 "Pilot feedback fixes" (linked to Rollout, milestone 3) into two tasks and link them | **Optimize with AI** restructures the rest (splits, regroups, adds tasks, sets estimates, links dependencies) |
| Trends, Activity (this week, day by day), History (Monday's version against today's) | **Digest** → **Generate now**: the status narrative at the week's end — closes the video |
| Help: where the walk-through, the demo and these videos live (A's former chapter 8) | — |

About 18 real Claude calls per full take (prologue 1, Monday 3, Tuesday 5, Wednesday 1, Thursday 4,
Friday 4; Draft message is a template, not a call). Rough length 20–25 minutes.

## What changes in A

- **Big video:** chapters 2–7 joined, as "The week" above. A's former chapters 3–8 and their contents
  table are replaced.
- **Chapter videos (owner):** 1 Install (by hand), 2 Connect storage and Claude (with the prologue),
  3 Monday, 4 Tuesday, 5 Wednesday, 6 Thursday, 7 Friday. Seven, each one take and one command.
- **Where a chapter starts (owner: replay off camera).** Every take still creates the demo fresh.
  Before chapter N records, the recorder replays the manual steps of the days before it, fast and
  off camera, with no AI calls: where a day's change came from an AI step, the replay applies a
  FIXED outcome for it, written once in the recorder's definitions beside that step — the merged
  duplicates, the impact and description texts, the new member's allocation, the RACI cells, the
  mitigation text, the chat's task, the imported hours, the acted-on recommendation and the
  restructured pilot tasks. AI output varies between takes; the replayed state does not. The page
  clock follows the replay day by day, so activity, versions and History are dated as in the big
  take. Each chapter stays its own command and its own retake.
- **"Since Friday" is the Dashboard delta strip, not the digest.** The strip compares against a
  per-device record keyed by PROJECT ID (`landing-state.ts`, key `aipm-cockpit:landing-state`, not
  workspace data). Explore the demo mints a new id at the end of chapter 2, so no Friday visit can
  exist; and a first Dashboard visit saves a Monday record after a few seconds, after which the strip
  shows nothing. So the recorder, right after the demo is created and BEFORE any Dashboard mount,
  writes that key off camera for the new id: `lastVisitAt` Friday 2026-09-18 plus a Friday RAG and
  metrics snapshot. The strip then shows task 25 newly overdue and any RAG flip; activity counts may be
  zero. The builder states the exact expected strip.
- **The digest is off by default** (`DEFAULT_DIGEST_CONFIG`), and with no saved digest state the
  mount effect treats it as due and generates by itself (`use-digest.ts`) — an uncounted Claude
  call. So the recorder also writes `aipm-cockpit:digest-state` (`digest-state.ts`) off camera with
  a `nextDueAt` after Friday 25 September, switches the digest on, and the take presses **Generate
  now** itself on Monday and Friday. The seeded state's prior RAG and metrics feed Monday's digest
  deltas; Friday's compare against Monday's run.
- **Clips (tiers 3 and 4):** unchanged.
- **`T0`:** as in "Dates". A's note that chapter 7 moves three weeks forward is replaced by the
  per-day clock, and A's "E checks its data at `T0` and `T0 + 3 weeks`" becomes: E checks it on each
  day, Monday 21 to Friday 25 September.
- **Video count:** 1 big video + 7 chapters + 15 AI clips + 20 feature clips = 43 videos; chapter 1
  (Install) is recorded by hand, so `--all` records 42. A's counts change accordingly.
- A's spec gets a short banner pointing here; its other sections stay authoritative.

## What E puts in the data

Numbers are the master's ids today; the builder keeps ids stable where the existing rows are reused.

### The slip

- **Milestone 5 "MVP target":** date `2026-09-18`, `achievedDate` removed, linked tasks 23, 24, 25 and
  the new CRM task. On Tuesday, when "MVP re-demo" is added, task 25 moves to that milestone and off
  this one, so after Thursday's drag (MVP target → 1 October) no linked task ends after it and it is
  not "at risk" on Friday. Its description (today "Slipped from 17 July to 21 August while the vendor's SDK
  was late") is rewritten for the new story: the MVP is the customer lifecycle working end to end,
  and it was not operational on the 18th.
- **Task 25 "MVP demo to the customer":** To Do, due `2026-09-18`, its `completedDate` cleared (today
  Done on 2026-08-21; `status` and `completedDate` must agree), a note that it was called off on
  Friday because provisioning to the CRM fails.
- **Stakeholder Elena Fischer** gets a fictional `email` (`@example.com`), so Draft message opens the
  mail client instead of the `window.prompt` for an address. Maya Patel already resolves to one
  through her linked resource (`stakeholderEmail`).
- **The forecast re-plan spreadsheet** (fixture) targets the bucket "Identity Platform – T&M"; its
  column headers are chosen so **Detect columns** cannot map them, which is what makes Ask Claude
  the step. The bucket ends 2026-09-30 today, and hours outside its dates are skipped
  (`forecastImportOutOfRange`), so E extends its end date to cover the fixture's months (October
  at least).
- **New task "Integrate CRM provisioning":** **To Do** (Tuesday drags it to In Progress), owner Noah Bennett, due `2026-09-16`
  (overdue on Monday), depends on 24; task 25 depends on it. **No blocker text** — Monday adds it
  on camera.
- **Pilot chain:** the tasks between the MVP and Pilot Go-Live (today 4–8, 27 and the pilot tasks)
  re-dated so they start after the MVP and none is overdue at T0 except what the story intends.
  Pilot Go-Live (milestone 2) stays on 2026-10-23, and **at least one of its linked tasks must end
  after that date**, so its "at risk" row fires (`isAtRisk`). The
  chain's dependency links (4→5 and 4→7, 5 and 6→8, 7 and 8→10) stay — they are why a slip ripples —
  and they raise the dep-blocked rows listed below.
- **Tasks 23 and 24** stay Done, completed before the 18th.

### Signals at T0 (Monday 2026-09-21)

The builder pins the Monday list with a unit test over `computeNextActions` on the shifted demo at
T0. Intended:

| Tier | Item | Source (score today) |
|---|---|---|
| Now — hero | MVP target overdue | milestone (67) |
| Now | "Board info pack" for Thursday's steering meeting due (`leadDays: 3`) | committee (60; provider file `committee-info.ts`) |
| Soon | "Integrate CRM provisioning" (To Do) overdue | task-due (55) |
| Soon | "MVP demo to the customer" (task 25) overdue, +1 reason: blocked by the CRM task | task-due (55) + task-attention dep-blocked (35), one row: both open `open-points:25`, so `groupNextActions` merges them |
| Soon | Maya over-allocated this period | workload (52 at ≥130 %; needs §747 fixed) |
| Soon | red issue "GDPR erasure requests do not reach the CRM", no owner yet | RAID (45) |
| Soon | change request "Add MFA to SSO scope" pending (High impact) | change-pending (45) |
| Soon | Pilot Go-Live at risk (a linked task now ends after it) — the slip's knock-on | milestone (42) |
| Soon | "Update stakeholder: Elena Fischer" — the sponsor, linked to change 1 and RAID 2 and 11 (owner: part of the story, acted on Monday) | stakeholder-comms (45) |
| Soon | "Update stakeholder: Maya Patel" — linked to change 1 (owner: part of the story, acted on Tuesday); today also to RAID 13, a link that goes once 13 is Delivered | stakeholder-comms (45) |
| Soon | pilot tasks waiting on an unfinished predecessor (today 5, 7, 8, 10) — the ripple of the slip | task-attention dep-blocked (35 each) |
| Monitor | the schedule item (SPI between 0.8 and 0.9) | schedule (5); the builder keeps SPI ≥ 0.8 so it does not rise to Soon (45), and below 0.9 so it fires at all |
| Monitor | Medium RAID items with an owner (today 2, 4, 11) — or resolved; the builder decides per item | RAID severity (22) |

Scores checked against the providers by the builder check and two reviews (2026-10-16; the second
ran the real engine on today's master at 2026-09-21). A single pending change scores 45, not 60 (60
is the aggregate at `SCOPE_PENDING_RED = 5`). The two stakeholder messages come from change 1's
stakeholder links and stay on the owner's word: on the Monday after a slip the sponsor must hear about
it. Assert on the GROUPED rows (`groupNextActions`, with their extra reasons), not the flat list —
rows are what the viewer sees.

**The rest of today's data must be cleaned so it does not fire** (checked by the review of
2026-10-16; the builder re-derives it on the reworked data):

- **Stale tasks:** 9 open tasks have `lastUpdateDate` 14 or more days before T0 and would fill
  Monitor (`STALE_DAYS = 14`). Bring every open task's `lastUpdateDate` within the fortnight,
  except any the builder argues into the story.
- **Blocked tasks 4 and 6** (task-attention "blocked", 30): drop their blocker text when the pilot
  chain is re-dated.
- **RAID 13, 8 and 9** fire first as OVERDUE REVIEWS (55, 54 and 52 respectively, Soon), with their High severity
  (37) only an extra reason, so lowering the severity does not remove them. Resolve them (Issues 8
  and 9 → `Resolved`, Dependency 13 → `Delivered`) or move their `targetDate` (the field the overdue
  review reads) past the week, so the GDPR issue
  is the one red RAID item on Monday.
- **RAID 1** (High risk, status Mitigated, which still counts as open: 37, Soon): close it, or lower
  it to a Monitor-level item.
- **Task 11 "Quarterly OKR review"** (due 2026-09-21, 45 Soon): move its due date off the week, or
  mark it Done.
- **Stale RAID reviews:** RAID 3 and 7 fire `stale` review rows (15, Monitor), and RAID 1, 2, 4 and
  11 carry stale-review extra reasons, because their last touch (`localModifiedAt`, else
  `raisedDate`; `raid-review.ts`) is older than the review interval (default 14 days). Give every
  open RAID item a `localModifiedAt` within the fortnight before T0.

The rule the Monday test enforces: **every action at T0 is a row of the table above, and every row
fires.** Anything else is removed from the data or added to the table with its reason.

**Depends on §747.** Before its fix the workload item read the plan's first period, so Maya's
overload could never fire at T0. The owner decided (2026-10-16) to fix §747 first, as its own defect
and PR (`nearTermPeriodKeys`); E starts only once that fix is on main.

### What the week needs to exist

- **Near-duplicate follow-ups:** 2–3 pairs logged by two people on Friday after the called-off demo
  ("Fix CRM sync for new registrations" / "CRM provisioning fails for sign-ups", and so on). One pair
  is deleted by hand on Tuesday; Deduplicate must still find the rest. Each new open task gets an
  assignee, a `lastUpdateDate` on the Friday and a due date after the week, or it raises its own
  unassigned, stale or overdue row.
- **Knowledge:** an item about the CRM interface decision, reachable by searching "CRM" on Monday.
- **Maya over-allocated** in the period containing T0 (September, at month granularity), planted in
  her `utilization` (the only thing the over-allocated reason of `buildWorkloadAlerts` reads; its
  other reason, overload, counts overdue tasks — so reassigning a task cannot relieve an
  over-allocation). Wednesday relieves it on screen through her
  "Util (now)" cell first, then Plan with AI plans the new member.
- **Maya present at T0:** her absence on 21–22 Sept ("Offsite leadership summit") moves out of the
  week. Noah's existing vacation (9–13 Nov) stays; it does not clash with "next week".
- **Steering committee:** a meeting on Thursday 2026-09-24 with an agenda (the existing meeting on
  2026-10-13 can stay). Its "Board info pack" reminder (`leadDays: 3`) falls due on Monday and is
  the second Now item — intended.
- **Insights** on Friday: at least one the recommendation can act on (`milestoneSlip` fits).
- **Pilot tasks** loose enough for Optimize with AI to restructure on Friday.
- **Forecast re-plan spreadsheet:** a fixture file shipped beside the recorder (path the builder's
  call, under `scripts/demo-video/`), with columns Claude has to map.
- **A's clip list** (A's "What A needs from project E" table) still holds; the items above cover most
  of it. The builder re-checks each row against the new data.
- **The week, day by day:** RAID 4, 11 and 7 have target dates of 22, 24 and 25 September, so each
  turns into an overdue review during the week — and RAID 11's would keep Elena's stakeholder row
  alive on Friday. Move all three past the 25th. E checks Monday to Friday, not only Monday.
- **Friday at 2026-09-25 (after the week's steps).** A stakeholder row stays while its source is live
  (a pending change, an overdue RAID item, a milestone inside the lead), not until a message is sent.
  With both changes approved on Thursday and RAID 4/7/11 moved, the Elena and Maya rows and the
  change-pending row are gone. Intended Friday rows, top first: "Update stakeholder: <the DPO>" (45,
  the hero — the re-demo inside the DPO's 14-day lead), then "Pilot Go-Live" at risk (42). E pins
  Friday's grouped rows in a test, as it pins Monday's.
- **Forecast simulation off at T0.** Its "unlikely on time" rows (`mergeSimActions`) join the
  grouped list only when Show simulation is on; it is off by default, and the takes leave it off.
- **The schedule row** fires only while SPI is at least 0.8 and below 0.9 (Monitor, 5); the builder
  keeps SPI in that band after re-dating, or drops the row from the table.

### What must NOT exist (the video adds it)

The "Integration Engineer" discipline and its role, the new team member, Noah's vacation next week,
the DPO stakeholder, the connector change request, the "MVP re-demo" milestone, the "CRM connector
(CR)" budget bucket, the two licence tasks, Thursday's risk "connector licence lead time", and
Monday's blocker on the CRM task. Only the Senior grade must exist; the discipline is added on camera.

## Left to the builder

- Exact dates, texts and ids of the re-dated pilot chain, the duplicates and the knowledge item.
- How the Monday-list test reaches the shifted demo (through `buildDemoWorkspace` or equivalent).
- The fixture spreadsheet's format and contents.

## Calls I made (for the owner to check)

- `T0` moves to Monday 2026-09-21 so the shift is 0 and "last Friday" is the master's as-of date.
- Monday's second Now item is the steering "Board info pack" reminder, kept because Thursday's
  meeting is in the story; the existing "Add MFA to SSO scope" change stays pending in Soon, and the
  connector change is the one Tuesday adds.
- Pilot Go-Live "at risk" stays in Soon as the slip's visible knock-on.
- Maya's 21–22 Sept absence moves out of the week; Noah's November vacation stays.
- Friday reuses the Table view (three task views for four days).
- The prologue (wizard + AI proposal + Explore the demo) closes chapter 2, so Monday opens straight
  on the Dashboard.
- Help, A's chapter 8, closes Friday.
- Real users opening the demo before the shifted MVP date (the 18th, or the working day it rolls to)
  see a different hero (a milestone dated today is not yet overdue); not fixed here.
- The CRM task is planted To Do, so Tuesday's Board drag is a real change.
- The new role is Integration Engineer × Senior; the discipline is added on camera.
- Draft message is the manual step (a template email, not AI); the AI step is the AI Assistant's
  "Stakeholder update" starter. Elena gets an example email so no address prompt appears; Maya
  already resolves to one through her linked resource.
- The new member's Swimlanes lane is added with "Add person lane", then a CRM follow-up card is
  dragged into it.
- Task 25 moves to 2 October and onto the "MVP re-demo" milestone on Tuesday, so the MVP target is
  not at risk once it is moved.
- The owner left the MFA change to me: Thursday's steering approves it, scheduled after the pilot.
  That clears its change row and the Elena and Maya rows it raised.
- The intended Friday hero is "Update stakeholder: <the DPO>": tell the DPO the erasure fix is
  verified (Draft message, then the AI "Stakeholder update"). "Pilot Go-Live" at risk follows it.
- The recorder seeds the landing-state and digest-state keys for the new project id off camera.
- The MVP target moves to Thursday 1 October; "MVP re-demo" stays Friday 2 October.
- The CRM blocker is added on camera on Monday, so it is not in the data.
