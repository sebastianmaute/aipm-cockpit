# AI brief for the project manager

*How to read this page:* `E<n>` is a row of the [evidence table](appendix.md#evidence-table); its
[label](appendix.md#evidence-labels) is *measured*, *tested (unit)* (a test with fakes, not a live run),
*tested (live database)*, *read in code* (these briefs cite no test or run for it), *estimated* or
*not proven*. `§N` is an open entry of the project's public [register](../../open-followups.md), listed under
[Open gaps](appendix.md#open-gaps).

## In one paragraph

The AI drafts and proposes work for you: most features change nothing until you apply their proposal, but a
single ordinary change in the chat applies at once unless your project reviews every AI write (E56,
*read in code*; E47, *tested (unit)*; E71, *tested (unit)*). Its answers can
differ between runs: the app does nothing to make the same request give the same answer, and whether the work
breakdown optimisation repeats has not been measured (E61, *read in code*; E27, *not proven*). AI text in your
report carries no mark, so telling a steering committee what the AI drafted is up to you (E55, *read in code*;
E62, *read in code*). Your use costs about $5, $13 or $33 a month
at light, typical or heavy use, an estimate from assumed usage (E25, *estimated*) and 2 to 6 measured calls per
feature on one demo project (E37, *measured*).

## What leaves, and who approves it

- **What leaves:** each feature sends the project data listed in the [AI paths](appendix.md#ai-paths) (E1,
  *read in code*). With *people protection* on, the names of people the project knows (a one-word name only
  where written with a capital) are replaced before sending; a name the project does not know, typed into a
  task or a chat, is sent as written (E14, *tested (unit)*; E35, *read in code*).
- **You approve:** the row edit, the allocation plan proposal ("Plan with AI"), the RACI suggestion, the work
  breakdown proposal ("Optimize work breakdown with AI"), the duplicate check, the forecast import, the weight
  suggestion and insight recommendations each change the project only when you apply, accept or confirm (E56,
  *read in code*). The new
  project proposal fills in the wizard, and nothing is created until you finish it (E49, *read in code*).
- **Applies on its own:** an ordinary chat change, one change in one send that deletes nothing, invites no one,
  puts no date on someone's absence and uses no tool that always asks for review, applies at once (E47,
  *tested (unit)*) and shows in the activity
  log as the AI's (E55, *read in code*), unless "Review every AI write" is on for your project or the
  deployment (E71, *tested (unit)*). Anything else waits on a *review card* for you, as does every change
  while a file is attached, except the work breakdown optimisation, which opens its own preview; a reopened
  saved chat keeps no attachment (E47, *tested (unit)*). A task synced from Jira that the chat has read starts
  that hold for the rest of the conversation; rows created from an imported file do not (E48, *tested (unit)*).
- **In the background:** the scheduled analyses and digests produce text and change no project record, and a
  recommendation waits for your confirmation (E56, *read in code*); you consent to background runs once, not
  run by run (E32, *tested (unit)*).

## What you control

- **Not the switches:** AI off, forced protection, the route and the key restriction are server settings of
  the deployment's operator (E19, *tested (unit)*; E4, *tested (unit)*; E7, *tested (unit)*); in the pilot the
  CEO and COO briefs suggest, protection is forced on, which hides allocation and RACI (E18, *tested (unit)*).
- **Two project settings in Settings → AI, both off until set:** "Review every AI write" sends every change to
  project data the chat proposes to the review card, even a single one, and a read never waits (E71,
  *tested (unit)*); "Keep hourly rates out of Plan with AI" leaves the internal hourly rates out of that request
  (E72, *tested (unit)*). The operator can force either on for every project.
- **Take or leave:** in the allocation, RACI, work breakdown and duplicate proposals you can deselect items, and
  the weight suggestion offers Accept for each weight; the others are applied, accepted or confirmed as a whole
  (E56, *read in code*). The steering committee draft waits under "AI draft – take sections into the report"
  until you take a section or all of them (E62, *read in code*).
- **Undo and find again:** tasks created by an applied work breakdown cannot be undone, and carry no AI mark
  (E66, *read in code*); the activity log entry for the apply names each task it created by number and title, so
  you can find them there (E68, *tested (unit)*).
- **Cross-project allocation:** hours from other projects count only on a shared Turso database, for people
  matched by your confirmation or a shared e-mail address, and only from projects that allow people, which by
  default none does (E60, *tested (unit)*; E41, *tested (unit)*). The request describes at most 120 people, 26
  periods, 150 open tasks and 40 milestones of yours; the model is told how many were left out, and "Plan with
  AI" shows you the same counts (E60, *tested (unit)*).

## Not yet proven / open gaps

1. **§812:** whether the work breakdown optimisation repeats has not been measured (E27, *not proven*).
2. **§814:** the hours from other projects in the allocation proposal have no observed behaviour from a
   measured run (E39, *not proven*).
3. **§801:** text the AI writes carries no machine-readable marking (E55, *read in code*).
4. **§796:** tasks created by an applied work breakdown cannot be undone (E56, *read in code*).

## What to check or ask for before saying yes

- Before a steering committee, mark the sections you took from the AI draft, and any AI text in slides or
  exports; the activity log shows which saves held AI-drafted text (E62, *read in code*).
- Check every name, date and number in a proposal against the project, and treat one plan as one option: ask
  again and compare before you apply (E61, *read in code*).
- Before "Plan with AI" on a shared database, answer its "same person" suggestions, or those people's hours in
  other projects are not counted (E60, *tested (unit)*).

## Where to read more

- [AI literacy](../../compliance/en/ai-literacy.md), on review cards and typical failure modes.
- [Works-council annex](../../compliance/en/works-council-annex.md#what-the-ai-may-do-without-a-person-approving-it).
- [Appendix](appendix.md): the evidence table, the two routes and the generated tables.
- The other briefs: [CEO](ceo.md), [CAIO](caio.md), [COO](coo.md).
