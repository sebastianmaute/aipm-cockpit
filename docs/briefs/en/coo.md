# AI brief for the COO

*How to read this page:* `E<n>` is a row of the [evidence table](appendix.md#evidence-table); its
[label](appendix.md#evidence-labels) is *measured*, *tested (unit)* (a test with fakes, not a live run),
*tested (live database)*, *read in code* (these briefs cite no test or run for it), *estimated* or
*not proven*. `§N` is an open entry of the project's public [register](../../open-followups.md), listed under
[Open gaps](appendix.md#open-gaps).

## In one paragraph

For operations, the AI is a running cost on each user's own Anthropic key (E2, *tested (unit)*) and a value
nobody has measured, so these briefs make no benefit claim (§811; E26, *not proven*). On the demo project a chat
call cost $0.0668 with people protection on and $0.0711 without, and the other features $0.0034 to $0.0314
(E24, *measured*), with a median wait of 2.0 s to 24.1 s (E37, *measured*); each figure rests on 2 to 6 calls
on one demo project with one model (E37, *measured*; E33, *measured*). With the calls per user and day assumed,
that is about $5, $13 or $33 per user and month at light, typical or heavy use, for model spend only; hosting,
administration and training are not estimated (E25, *estimated*). A pilot is how you get the number the
business case turns on.

## What leaves, and who approves it

What every feature sends is in the [AI paths](appendix.md#ai-paths) table (E1, *read in code*). The digest
summary, for example, sends status figures, the milestones due soon and the user's operating guide for the
digest, and no people's names unless a milestone name holds one (E1, *read in code*). With *people protection*
on, the names of people the project knows (a one-word name only where written with a capital) and every e-mail
address, valid IBAN and phone-shaped number are replaced by placeholders in the browser before sending (E14,
*tested (unit)*; E15, *read in code*).

## What you control

- **Whose keys:** requests through this deployment can be restricted to keys of your own Anthropic organisation
  and its workspaces, so that usage runs on those keys (E7, *tested (unit)*; E52, *read in code*); a key that
  stops qualifying stays accepted for up to 15 minutes (E9, *tested (unit)*).
- **Spend limits:** the app counts usage only in each user's browser, and its caps are the user's own
  settings: the session and weekly caps only notify, and the optional weekly hard cap pauses background AI
  only. Nothing in the app stops interactive AI at a spend limit (E38, *read in code*).
- **Off:** the deployment can switch AI off entirely (E19, *tested (unit)*).

## Not yet proven / open gaps

1. **§811:** the time the AI saves is not measured (E26, *not proven*).
2. **§812:** whether Optimize work breakdown with AI repeats its result is not measured (E27, *not proven*).
3. **§814:** six paths have no measured cost or behaviour, the weekly hard cap among them (E39, *not proven*).

## What to check or ask for before saying yes

- Measure time per task before the AI is switched on; without that baseline the value question stays open.
- Since the app cannot stop interactive spend (E38, *read in code*), ask the CIO whether a spend limit and usage
  reports can be set on the Anthropic organisation or workspaces the keys belong to.
- **Pilot, as a template:**
  - *Scope:* force people protection on, whatever a project stores (E19, *tested (unit)*; E41,
    *tested (unit)*); this hides the allocation plan proposal and the RACI suggestion and switches dictation off
    (E18, *tested (unit)*). Leave out the new project proposal, whose names cannot be protected: no switch does
    this, so tell users (E35, *read in code*; E42, *tested (unit)*). Allocation and RACI only after the works
    council and the DPO agree; lifting the lock returns each project to its own setting, so check those first
    (E43, *read in code*).
  - *Duration and size:* your choice, for example 6–12 weeks and 10–30 project managers.
  - *Measure:* spend per user per week; time per task against the baseline; how many AI proposals are accepted
    and how many need rework; repeatability of the work breakdown proposal (§812; E27, *not proven*).
  - *Stop and sign-off:* stop when spend, rework or a protection finding passes a limit you set beforehand (the
    briefs give no values; none is measured); sign-off by the works council, the DPO, the CISO and the budget
    owner.

## Where to read more

- [Measured figures](appendix.md#measured-figures) and the
  [team-month estimate](appendix.md#team-month-estimate), with their arithmetic.
- [Appendix](appendix.md), with the [deployment switches](appendix.md#deployment-switches).
- [Compliance pack](../../compliance/en/README.md) and its
  [works-council annex](../../compliance/en/works-council-annex.md).
- The other briefs: [CEO](ceo.md), [CIO](cio.md), [PM](pm.md).
