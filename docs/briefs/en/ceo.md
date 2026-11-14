# AI brief for the CEO

*How to read this page:* `E<n>` is a row of the [evidence table](appendix.md#evidence-table); its
[label](appendix.md#evidence-labels) is *measured*, *tested (unit)* (a test with fakes, not a live run),
*tested (live database)*, *read in code* (these briefs cite no test or run for it), *estimated* or
*not proven*. `§N` is an open entry of the project's public [register](../../open-followups.md), listed under
[Open gaps](appendix.md#open-gaps).

## In one paragraph

The app's AI drafts and proposes project-management work in 17 features, three of them running in the
background (E1, *read in code*). Each user brings their own Anthropic API key, and model requests go to
Anthropic straight from the browser (the direct route) or through the app's own server (the relay route; see
the [diagram](appendix.md#two-routes-to-the-model)) (E2, *tested (unit)*; E4, *tested (unit)*); dictated audio
goes not to Anthropic but to the speech service the user sets up or the browser's own speech recognition (E1,
*read in code*). Nobody has measured how much
working time the AI saves, so these briefs make no benefit claim (§811; E26, *not proven*). The decision in front
of you is therefore not a rollout but a scoped pilot that measures it.

## What leaves, and who approves it

- **To Anthropic:** depending on the feature, tasks, RAID items, milestones, stakeholders, people in the
  resource directory, absences, and attached files and e-mails ([AI paths](appendix.md#ai-paths); E1,
  *read in code*).
- **People:** *people protection* replaces, in the browser before sending, the names of people the project
  knows (a one-word name only where it is written with a capital) and every e-mail address, valid IBAN and
  phone-shaped number with placeholders (E14, *tested (unit)*; E15, *read in code*). Names the project does not
  know, in typed text, attached mail and files or a new project's brief, are sent as written (E35,
  *read in code*).
- **Region:** all 96 measured requests reported Anthropic's inference_geo value `global` (E22, *measured*);
  what that means for transfers is the DPO's question.
- **Approval in the app:** each user accepts the AI disclosure on each device, and again when its text or the
  route changes (E31, *tested (unit)*).

Approval in the organisation is yours: the legal basis, your contract and data processing agreement with
Anthropic, transfers and a works agreement are questions only your organisation can answer.

## What you control

- **Off switch:** the deployment can switch AI off, or force people protection on in every project (E19,
  *tested (unit)*). Both act on this deployment only, and protection runs in the browser, so a modified copy,
  or another client with the same key, can send without it (E52, *read in code*; E15, *read in code*).
- **Keys:** requests through this deployment can be restricted to keys of your own Anthropic organisation;
  other keys are refused before anything is forwarded (E7, *tested (unit)*; E52, *read in code*), but a key
  that stops qualifying stays accepted for up to 15 minutes (E9, *tested (unit)*).
- **Route:** AI traffic can go through your own gateway (E5, *tested (unit)*), not yet run against a real
  gateway (§802; E12, *not proven*).
- **Retention:** saved chats exist only with a Turso database and the operator's recovery key (E28,
  *read in code*). The browser deletes them 30 days after their last change (the operator can set 1 to 3650),
  and so does the server where set up (E29, *read in code*); live proof covers only the database statements
  (§813; E30, *tested (live database)*). Ending the pilot deletes no chat: they go when retention runs out or
  the operator erases them (E29, *read in code*; E57, *read in code*).

## Not yet proven / open gaps

1. **§811:** the time the AI saves is not measured (E26, *not proven*).
2. **§802:** the gateway route has never run against a real gateway (E12, *not proven*).
3. **§814:** six paths have no measured cost or behaviour, among them the weekly hard cap (E39, *not proven*).
4. **§813:** chat erasure is proven live only for its database statements (E30, *tested (live database)*).
5. **§795:** background AI is consented once, not approved run by run (E32, *tested (unit)*).

## What to check or ask for before saying yes

- Ask the DPO and the works council to review the
  [works-council annex](../../compliance/en/works-council-annex.md) and answer the questions above, and the
  CIO which [deployment switches](appendix.md#deployment-switches) the pilot sets.
- **Pilot, as a template:**
  - *Scope:* force people protection on, whatever a project stores (E19, *tested (unit)*; E41,
    *tested (unit)*); this hides the allocation plan proposal and the RACI suggestion and switches dictation off
    (E18, *tested (unit)*). Leave out the new project proposal, whose names cannot be protected: no switch does
    this, so tell users (E35, *read in code*; E42, *tested (unit)*). Allocation and RACI only after the works
    council and the DPO agree; lifting the lock returns each project to its own setting, so check those first
    (E43, *read in code*).
  - *Duration and size:* your choice, for example 6–12 weeks and 10–30 project managers.
  - *Budget:* about $5, $13 or $33 per user and month at light, typical or heavy use, model spend only, from
    assumed usage (E25, *estimated*) and 2 to 6 calls per feature on one demo project with one model (E37,
    *measured*; E33, *measured*); nothing in the app enforces it (E38, *read in code*).
  - *Measure:* spend per user per week; time per task against a baseline; acceptance and rework rate of AI
    proposals; repeatability of the work breakdown proposal (§812; E27, *not proven*).
  - *Stop and sign-off:* stop when spend, rework or a protection finding passes a limit you set beforehand (the
    briefs give no values; none is measured); sign-off by the works council, the DPO, the CISO and the budget
    owner.

## Where to read more

- [Appendix](appendix.md): the evidence table, the two routes and the generated tables.
- [Compliance pack](../../compliance/en/README.md), including the
  [AI Act readiness note](../../compliance/en/ai-act-readiness.md).
- The other briefs: [CIO](cio.md), [CISO](ciso.md), [COO](coo.md), [DPO](dpo.md).
