# AI brief for the Chief AI Officer

## In one paragraph

The app's AI drafts, analyses and proposes project-management work in 17 features, three of them running in
the background (E1, *read in code*). Outside the chat, a feature that proposes changes applies nothing until a
person does; the chat applies a single ordinary write at once (E56, *read in code*; E47, *tested (unit)*). Two
features touch decisions about people at work: the allocation plan proposal proposes people's planned hours
and moves of open tasks between them, and the RACI suggestion proposes a role per person and milestone (E56,
*read in code*). How these, and your use of them, read against the AI Act's Annex III is your organisation's
classification; this page gives the facts for it, not a conclusion.

## What leaves, and who approves it

- **Intended purpose per feature:** drafting (chat, row edit, steering committee report, digest), analysis
  (next actions, insights, scheduled jobs) and planning (work breakdown, allocation, RACI, duplicates,
  weights, forecast import, new project); the [AI paths](appendix.md#ai-paths) say what each sends (E1,
  *read in code*).
- **Closest to Annex III:** the allocation request carries each person's role, external status, planned and
  available hours and the internal hourly rate of their role; the RACI request carries stakeholders' influence
  and interest; insights from Timelog name one person with findings about their logged working time and go to
  the chat, the row edit and the insight recommendations
  ([AI paths and people data](appendix.md#ai-paths-and-people-data); E1, *read in code*).
- **Where a person approves:** each allocation and RACI change is shown with its current and proposed value
  and can be deselected (E56, *read in code*). The chat holds changes on a review card in set cases, such as
  a deletion or more than one write, and holds every change while a file is attached (E47, *tested (unit)*).
- **Where nobody approves first:** a single ordinary chat write applies at once, logged as the AI's (E47,
  *tested (unit)*); text the chat reads through its tools, such as a Jira-synced task, does not start the hold
  (E48, *read in code*). Background AI is consented once, not run by run, and its results change no project
  record until someone confirms (E32, *tested (unit)*; E56, *read in code*).

## What you control

- **People-related AI off:** `ai-people` forces people protection on in every project (E19, *tested (unit)*),
  which hides the allocation proposal and the RACI suggestion and switches dictation off (E18,
  *tested (unit)*); while it is on, an AI answer applies nothing person-related (E17, *tested (unit)*).
- **Limits of that switch:** protection runs in the browser, so a modified copy can send without it (E15,
  *read in code*); names the project does not know are sent as written, and a new project's names cannot be
  protected (E35, *read in code*); lifting the lock returns each project to its stored setting (E43,
  *read in code*). No switch turns off a single feature (E42, *read in code*).
- **Consent:** each user accepts the disclosure on each device, and again when its text or the route changes
  (E31, *tested (unit)*).
- **Article 50 labelling:** the screens name the AI ("AI Assistant", "Ask Claude", "AI-generated — review
  before acting.") and the activity log shows its changes with the actor "AI assistant"; the text it writes
  carries no machine-readable marking (E55, *read in code*).
- **Article 4 literacy:** the [AI-literacy material](../../compliance/en/ai-literacy.md) and the
  [model notices](../../compliance/en/model-notices.md) are templates for staff and for people outside.

## Not yet proven / open gaps

1. **§794:** a single chat write applies without the review card (E47, *tested (unit)*).
2. **§801:** text the AI writes carries no machine-readable marking (E55, *read in code*).
3. **§795:** background AI is consented once, not approved run by run (E32, *tested (unit)*).
4. **§797:** text the chat reads through its tools does not start the review hold (E48, *read in code*).
5. **§810:** hiding a project's Resources function does not keep its people and absences from the AI (E59,
   *read in code*).

## What to check or ask for before saying yes

- Write down the purpose for which your organisation will use allocation and RACI, and read it against
  Annex III point 4(b) and Article 6(3) with the
  [readiness note](../../compliance/en/ai-act-readiness.md#allocation-and-raci-suggestions-annex-iii); until
  that is settled, force protection on (E18, *tested (unit)*; E19, *tested (unit)*).
- In a test project, ask the chat for one due-date change and see it apply without a card and appear in the
  activity log as the AI's; then attach a file and see the same request wait (E47, *tested (unit)*; E55,
  *read in code*).
- Decide how AI-written text is labelled once it leaves the app in reports and exports (E55,
  *read in code*).

## Where to read more

- [AI Act readiness note](../../compliance/en/ai-act-readiness.md),
  [model notices](../../compliance/en/model-notices.md) and [AI literacy](../../compliance/en/ai-literacy.md).
- [Works-council annex](../../compliance/en/works-council-annex.md#what-the-ai-may-do-without-a-person-approving-it).
- [Appendix](appendix.md): the evidence table, the two routes and the generated tables.
- The other briefs: [CEO](ceo.md), [DPO](dpo.md), [PM](pm.md).
