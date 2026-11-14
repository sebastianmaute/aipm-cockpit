# AI brief for the COO

## In one paragraph

For operations, the AI is a running cost on each user's own Anthropic key (E2, *tested (unit)*) and a value
nobody has measured yet. On the demo project a chat call cost $0.0668 with people protection on and $0.0711
without, and the other features $0.0034 to $0.0314 (E24, *measured*), with a median wait of 2.0 s to 24.1 s
(E37, *measured*). For a team of five that is about $25, $67 or $165 a month at light, typical or heavy use,
with the calls per user and day assumed (E25, *estimated*). The working time the AI saves has not been
measured (E26, *not proven*). A pilot is how you get the number the business case turns on.

## What leaves, and who approves it

What every feature sends is in the [AI paths](appendix.md#ai-paths) table (E1, *read in code*). The digest
summary sends the least: status figures, the milestones due soon and the user's operating guide for the digest,
and no people's names unless a milestone name holds one (E1, *read in code*).

## What you control

- **Whose keys:** AI can be restricted to keys of your own Anthropic organisation and its workspaces. With that
  restriction set, only keys of your organisation are accepted, so usage runs on those keys (E7,
  *tested (unit)*); a key that stops qualifying stays accepted for up to 15 minutes (E9, *tested (unit)*).
- **Spend limits:** the app counts usage only in each user's browser, and its caps are the user's own
  settings: the session and weekly caps only notify, and the optional weekly hard cap pauses background AI
  only. Nothing in the app stops interactive AI at a spend limit (E38, *read in code*).

## Not yet proven / open gaps

1. **§811:** the time the AI saves is not measured (E26, *not proven*).
2. **§812:** whether Optimize work breakdown with AI repeats its result is not measured (E27, *not proven*).
3. **§814:** six paths have no measured cost or behaviour, the weekly hard cap among them (E39, *not proven*).
4. **§798:** only two AI calls, the on-request digest and the browser-side key test, have a time limit of their
   own; the relay adds a 15-minute idle timeout, and a rate-limit or overload answer is not retried (E40,
   *read in code*).
5. **§795:** background runs are consented once, not approved run by run (E32, *tested (unit)*).

## What to check or ask for before saying yes

- Measure time per task before the AI is switched on; without that baseline the value question stays open.
- Since the app cannot stop interactive spend (E38, *read in code*), ask the CIO whether a spend limit and usage
  reports can be set on the Anthropic organisation or workspaces the keys belong to.
- **Pilot, as a template:**
  - *Scope:* force people protection on, whatever a project stores (E19, *tested (unit)*; E41,
    *tested (unit)*); this hides the allocation plan proposal and the RACI suggestion and switches dictation off
    (E18, *tested (unit)*). Names the project does not know are still sent as written (E35, *read in code*).
    Leave out the new project proposal, whose names cannot be protected: no switch does this, so tell users
    (E42, *read in code*). Allocation and RACI only after the works council and the DPO agree; lifting the lock
    returns each project to its own setting, so check each project's setting first (E43, *read in code*).
  - *Duration and size:* your choice, for example 6–12 weeks and 10–30 project managers.
  - *Measure:* spend per user per week; time per task against the baseline; how many AI proposals are accepted
    and how many need rework; repeatability of the work breakdown proposal (§812; E27, *not proven*).
  - *Stop and sign-off:* stop when spend, rework or a protection finding passes a limit set beforehand; the
    deployment can switch AI off entirely (E19, *tested (unit)*); sign-off by the works council, the DPO, the CISO and the budget owner.

## Where to read more

- [Measured figures](appendix.md#measured-figures) and the
  [team-month estimate](appendix.md#team-month-estimate), with their arithmetic.
- [Appendix](appendix.md), with the [deployment switches](appendix.md#deployment-switches).
- [Compliance pack](../../compliance/en/README.md) and its
  [works-council annex](../../compliance/en/works-council-annex.md).
- The other briefs: [CEO](ceo.md), [CIO](cio.md), [PM](pm.md).
