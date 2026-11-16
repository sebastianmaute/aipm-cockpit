# AI brief for the Chief AI Officer

*How to read this page:* `E<n>` is a row of the [evidence table](appendix.md#evidence-table); its
[label](appendix.md#evidence-labels) is *measured*, *tested (unit)* (a test with fakes, not a live run),
*tested (live database)*, *read in code* (these briefs cite no test or run for it), *estimated* or
*not proven*. `§N` is an open entry of the project's public [register](../../open-followups.md), listed under
[Open gaps](appendix.md#open-gaps).

## In one paragraph

The app's AI drafts, analyses and proposes project-management work in 17 features, three of them running in
the background (E1, *read in code*). Outside the chat, a feature that proposes changes applies nothing until a
person does, a reading of the code that no test pins; the chat applies a single ordinary write at once unless
the project or the deployment has every AI write reviewed (E56, *read in code*; E47, *tested (unit)*; E71,
*tested (unit)*). Two features propose changes to people's work: the allocation plan
proposal ("Plan with AI") proposes people's planned hours and moves of open tasks between them, and the RACI
suggestion proposes a role per person and milestone (E56, *read in code*). How these, and your use of them, read
against Annex III of the AI Act is your organisation's classification; this page gives the facts for it, not a
conclusion. Nothing in these briefs measures the accuracy, bias or repeatability of those proposals, and the
app does nothing to make a request give the same answer twice (§812; E27, *not proven*; E61, *read in code*).

## What leaves, and who approves it

- **Most person-related requests:** the allocation request carries each person's role, external status,
  planned and available hours and, unless the project or the deployment keeps rates out, the internal hourly
  rate of their role (E72, *tested (unit)*); the RACI request carries
  stakeholders' influence and interest; insights from Timelog name one person with findings about their logged
  working time and, while people protection is off, go to the chat, the row edit and the insight
  recommendations ([AI paths and people data](appendix.md#ai-paths-and-people-data); E1, *read in code*);
  while it is on, to none of them, except that the chat sends the earlier messages of a conversation again as
  they were (E67, *tested (unit)*; the resending *read in code*).
- **Where a person approves:** each allocation and RACI change is shown with its current and proposed value
  and can be deselected (E56, *read in code*). The chat holds changes on a *review card* for the user in set
  cases, such as a deletion or more than one write, and every change while a file is attached, except the work
  breakdown optimisation, which opens its own preview; a reopened saved chat keeps no attachment (E47,
  *tested (unit)*). Background AI results change no project record until someone confirms
  (E56, *read in code*).
- **Where nobody approves first:** a single ordinary chat write, and one made after reading outside text that
  carries no mark of its origin, such as rows created from an imported file (E47, *tested (unit)*; E48,
  *tested (unit)*), unless the project or the deployment has every AI write reviewed: then every change to
  project data the chat proposes waits on the review card, even alone, and a read never waits (E71,
  *tested (unit)*).

## What you control

- **People-related AI off:** `ai-people` forces people protection on in every project (E19, *tested (unit)*),
  which hides the allocation proposal and the RACI suggestion and switches dictation off (E18,
  *tested (unit)*); while it is on, an AI answer applies nothing person-related (E17, *tested (unit)*).
- **Limits of that switch:** protection runs in the browser, so a modified copy can send without it (E15,
  *read in code*); names the project does not know are sent as written, and a new project's names cannot be
  protected (E35, *read in code*); lifting the lock returns each project to its stored setting (E43,
  *read in code*). No switch turns off a single feature (E42, *tested (unit)*).
- **Review and rates:** `ai-direct-writes` sends every chat write in every project to the review card, and
  `ai-rates` keeps hourly rates out of Plan with AI and the chat's forecast and dashboard figures; without them, each project can set either in Settings → AI,
  and both are off until set (E71, *tested (unit)*; E72, *tested (unit)*).
- **For Article 50 (transparency):** the screens name the AI ("AI Assistant", "Ask Claude", "AI-generated — review
  before acting.") and the activity log shows its chat changes with the actor "AI assistant"; machine-readable
  marking of the text it writes is absent (§801; E55, *read in code*).
- **Article 4 literacy:** see the [AI-literacy material](../../compliance/en/ai-literacy.md) and the
  [model notices](../../compliance/en/model-notices.md) in the compliance pack.

## Not yet proven / open gaps

1. **§801:** text the AI writes carries no machine-readable marking, so decide how it is labelled once it
   leaves the app in reports and exports (E55, *read in code*).
2. **§812:** whether the work breakdown optimisation repeats its result is not measured (E27, *not proven*).
3. **Unmarked outside text:** outside text with no mark of its origin does not start the review hold; a
   Jira-synced task does (E48, *tested (unit)*). Only reviewing every write covers it (E71, *tested (unit)*).
4. **§795:** background AI is consented once, not approved run by run (E32, *tested (unit)*).

## What to check or ask for before saying yes

- Write down the purpose for which your organisation will use allocation and RACI, and read it, beside the
  maintainer's [intended-purpose statement](../../compliance/en/ai-act-readiness.md#roles), against Annex III
  point 4(b) (under employment, among others AI used to allocate tasks based on individual behaviour or
  personal traits, or to monitor and evaluate workers) and Article 6(3) with the
  [readiness note](../../compliance/en/ai-act-readiness.md#allocation-and-raci-suggestions-annex-iii); until
  that is settled, force protection on (E18, *tested (unit)*; E19, *tested (unit)*).
- Answer for your organisation: is it provider or deployer of what it builds on the app, who oversees
  allocation and RACI, how long logs are kept, and how workers are informed? The app's activity log names the
  AI as actor of its chat changes, report drafts and applied work breakdowns (E55, *read in code*; E62,
  *read in code*; E66, *read in code*).
- In a test project, ask the chat for one due-date change on a task whose assignee is not away then: it applies
  without a card and the activity log shows it as the AI's; with a file attached, or with "Review every AI
  write" on in Settings → AI, the same request waits (E47, *tested (unit)*; E55, *read in code*; E71,
  *tested (unit)*).
- Ask Anthropic what it retains of a request, whether it trains on it, and which terms apply to your account.

## Where to read more

- [AI Act readiness note](../../compliance/en/ai-act-readiness.md),
  [model notices](../../compliance/en/model-notices.md) and [AI literacy](../../compliance/en/ai-literacy.md).
- [Works-council annex](../../compliance/en/works-council-annex.md#what-the-ai-may-do-without-a-person-approving-it).
- [Appendix](appendix.md): the evidence table, the two routes and the generated tables.
- The other briefs: [CEO](ceo.md), [DPO](dpo.md), [PM](pm.md).
