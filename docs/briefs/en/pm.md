# AI brief for the project manager

## In one paragraph

The AI drafts and proposes work for you: most features change nothing until you apply their proposal, but a
single ordinary change in the chat applies at once (E56, *read in code*; E47, *tested (unit)*). Its answers can
differ between runs: the app does nothing to make the same request give the same answer, and whether the work
breakdown optimisation repeats has not been measured (E61, *read in code*; E27, *not proven*). Text the AI
writes carries no mark of its own once it is in your report, so telling a steering committee which parts the AI
drafted is up to you (E55, *read in code*; E62, *read in code*).

## What leaves, and who approves it

- **What leaves:** each feature sends the project data listed in the [AI paths](appendix.md#ai-paths) (E1,
  *read in code*). With people protection on, the names of people the project knows are replaced before
  sending; a name the project does not know, typed into a task or a chat, is sent as written (E14,
  *tested (unit)*; E35, *read in code*).
- **You approve:** the row edit, the allocation plan proposal, the RACI suggestion, the work breakdown
  proposal, the duplicate check, the forecast import, the weight suggestion and insight recommendations each
  change the project only when you apply, accept or confirm; allocation and RACI show each change with its
  current and proposed value (E56, *read in code*). The new project proposal fills in the wizard, and nothing
  is created until you finish it (E49, *read in code*).
- **Applies on its own:** one ordinary chat change, such as a single due date, applies at once and is logged
  as the AI's (§794; E47, *tested (unit)*). The chat holds changes on a review card in set cases, for
  example a deletion, an invitation, a date on someone's absence or more than one write, and holds every change while a file is
  attached (E47, *tested (unit)*). Text the chat reads through its tools, such as a Jira-synced task, does not
  start that hold (E48, *read in code*).
- **In the background:** the scheduled analyses and digests produce text and change no project record, and a
  recommendation waits for your confirmation (E56, *read in code*); you consent to background runs once, not
  run by run (E32, *tested (unit)*).

## What you control

- **Take or leave:** in every proposal you can deselect items (E56, *read in code*). The steering committee
  draft waits under "AI draft – take sections into the report" until you take a section or all of them (E62,
  *read in code*).
- **Force a review:** attach a file to the chat conversation and every change it proposes waits on the review
  card, except the work breakdown optimisation, which opens its own preview (E47, *tested (unit)*).
- **Undo:** tasks created by an applied work breakdown cannot be undone; delete them by hand (E56,
  *read in code*).
- **Cross-project allocation:** hours from other projects count only on a Turso database shared with them, for
  people matched by your confirmation or a shared e-mail address; projects that protect their people are left
  out, and the request describes at most 120 people, 26 periods, 150 open tasks and 40 milestones of yours
  (E60, *read in code*).

## Not yet proven / open gaps

1. **§794:** a single chat change applies without the review card (E47, *tested (unit)*).
2. **§812:** whether the work breakdown optimisation repeats has not been measured (E27, *not proven*).
3. **§814:** the hours from other projects in the allocation proposal have no observed behaviour from a
   measured run (E39, *not proven*).
4. **§801:** text the AI writes carries no machine-readable marking (E55, *read in code*).
5. **§796:** tasks created by an applied work breakdown cannot be undone (E56, *read in code*).

## What to check or ask for before saying yes

- Before a steering committee, mark the sections you took from the AI draft, and any AI text in slides or
  exports; the activity log shows which saves held AI-drafted text (E62, *read in code*).
- Check every name, date and number in a proposal against the project, and treat one plan as one option: ask
  again and compare before you apply (E61, *read in code*).
- Before Plan with AI on a shared database, answer its "same person" suggestions, or those people's hours in
  other projects are not counted (E60, *read in code*).

## Where to read more

- [AI literacy](../../compliance/en/ai-literacy.md), on review cards and typical failure modes.
- [Works-council annex](../../compliance/en/works-council-annex.md#what-the-ai-may-do-without-a-person-approving-it).
- [Appendix](appendix.md): the evidence table, the two routes and the generated tables.
- The other briefs: [CEO](ceo.md), [CAIO](caio.md), [COO](coo.md).
