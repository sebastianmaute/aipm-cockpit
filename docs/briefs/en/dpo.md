# AI brief for the Data Protection Officer

*How to read this page:* `E<n>` is a row of the [evidence table](appendix.md#evidence-table); its
[label](appendix.md#evidence-labels) is *measured*, *tested (unit)* (a test with fakes, not a live run),
*tested (live database)*, *read in code* (these briefs cite no test or run for it), *estimated* or
*not proven*. `§N` is an open entry of the project's public [register](../../open-followups.md), listed under
[Open gaps](appendix.md#open-gaps).

## In one paragraph

Depending on the feature, the AI sends personal data to Anthropic, directly or through the app's server and the
organisation's gateway; the route, the [CIO's](cio.md) choice, decides who handles each request on the way (E4,
*tested (unit)*; E5, *tested (unit)*). The people concerned can be those in the resource directory,
stakeholders, task assignees and RAID owners, senders and recipients of attached e-mails, people named
in typed text, files or an imported spreadsheet, and the person a Timelog insight is about (E1,
*read in code*). Controller and processor roles, the legal basis, your contract and data processing agreement
with Anthropic, transfers and a works agreement are questions only your organisation can answer.

## What leaves, and who approves it

- **Per feature:** see [AI paths and people data](appendix.md#ai-paths-and-people-data). The allocation
  proposal sends each person's planned and available hours and, unless the project or the deployment keeps
  rates out, their role's internal hourly rate, and Timelog insights name one person with findings about their
  logged working time (E1, *read in code*; E72, *tested (unit)*).
- **Hidden Resources function:** while a project hides it, no AI feature is offered that function's tools (the
  resource directory, absences, allocations and contact e-mail look-ups), no prompt carries the list of who is
  away, insight recommendations name only people already assigned to open tasks, no insight about one person
  is sent, and the chat's forecast results do not name a person from the directory; the stakeholder tools
  follow the Stakeholders function, and history search, chat search, the status inquiry and RAID escalation
  stay available; a chat date write that lands on someone's
  absence is still held for review, so the model can tell it was held but learns nothing about who is away or
  when. Turning the function back on through the AI always waits for review. Hiding it does not take names out
  of tasks and other records; that is people protection's job. And a forecast what-if that names a directory person by id still reports, without the name, their weekly hours, whether they are external or have no rate, and whether they are already on the team or gone from the directory (E59,
  *tested (unit)*).
- **Absence types (possible special-category data):** no AI path sends an absence's stored type: the chat
  lists each as "absent", and the row edit and the lists of who is away leave it out (E63, *tested (unit)*;
  E1, *read in code*). One hint remains while people protection is off: the Timelog insight for time booked on
  an absence day names the person as absent "(vacation, sick or training)", without saying which, and can reach
  the chat (its insight lines and its `get_app_state` tool), the row edit and both insight recommendations
  (E63, *tested (unit)*; E1, *read in code*). With people protection on, none of these paths adds it to a
  request, but the chat sends the earlier messages of a conversation again as they were, including a tool reply
  from before protection was switched on (E67, *tested (unit)*; the resending *read in code*); none sends it while
  `timelog` is switched off or Timelog is hidden in the project, and a type a user writes, such as "sick", is
  sent as written (E64, *read in code*).
- **Dictation:** audio goes not to Anthropic but to the speech service the user sets up or, with browser
  dictation, to the browser's own recognition, which in some browsers sends it to the browser maker (E1,
  *read in code*).
- **Minimisation:** chat list results carry no e-mail addresses (attachments, documents and logged edits can),
  and the row edit never sends a person's phone number, birthday or notes (E1, *read in code*).
- **Protection and its limits:** *people protection* is on unless a project allows people (E41,
  *tested (unit)*); it replaces known people's names (a one-word name only where written with a capital) and
  every e-mail address, valid IBAN and phone-shaped number (E14, *tested (unit)*); unknown names, and a new
  project's names, are sent as written (E35, *read in code*); it runs in the browser, so a modified copy can
  send without it (E15, *read in code*).
- **Region:** all 96 measured requests reported inference_geo `global`, and the app sets no such parameter
  (E22, *measured*; E58, *read in code*); what that means for transfers is for you to assess.
- **Approval in the app:** users accept the AI disclosure on each device; whether that matters for your legal
  basis is yours to decide (E31, *tested (unit)*).

## What you control

- **Protection everywhere:** the deployment's operator, not the DPO, sets `ai-people`, which forces protection
  on in every project (E19, *tested (unit)*) and hides allocation and RACI (E18, *tested (unit)*); lifting it
  returns each project to its stored setting (E43, *read in code*).
- **Rates:** a project's "Keep hourly rates out of Plan with AI and the chat's forecast and dashboard figures"
  setting, or `ai-rates` for the whole deployment, keeps the rates out of that request, keeps the role rate of a
  person from the directory out of the forecast results the chat reads, and keeps the planned and booked rate
  averages out of the dashboard figures the chat reads; the people, their roles and their hours are still sent.
  A placeholder's rate that a saved scenario stores (a figure entered for it, or the team's mean internal rate)
  is still sent with that scenario, and a scenario's or what-if's cost at finish beside As is, with the added
  person's weekly hours, lets the model roughly work out that person's rate (E72, *tested (unit)*).
- **Saved chats:** kept only with a Turso database and the operator's recovery key (E28, *read in code*);
  deleted 30 days after their last change (the operator can set 1 to 3650), by the browser and, where set up,
  by the server (E29, *read in code*).
- **Erasure and lookup:** users can delete all their own chats except those from before chats became private,
  which stay until they expire; the search for a person also reaches, and can delete, this project's older
  shared chats, which can hold others' conversations; the operator can search and delete across the database
  (E57, *read in code*).

## Not yet proven / open gaps

1. **§813:** chat erasure is proven live only for its database statements, not for the screens, real sweeps,
   the provider's backups or what the model vendor keeps (E30, *tested (live database)*).
2. **§795:** background AI is consented once, not approved run by run (E32, *tested (unit)*).
3. **§814:** the refusal of images and PDFs under protection, and the other projects' hours in allocation, have
   no observed behaviour from a measured run (E39, *not proven*).

## What to check or ask for before saying yes

- Record your answers to the controller, processor, legal basis, transfer and works-agreement questions, using
  the [DPIA input](../../compliance/en/dpia-input.md#questions-for-your-assessment).
- Ask Anthropic, for your account: what it retains of a request and for how long, whether it trains on it,
  which entity and region process it, which data-processing terms and transfer mechanism apply, and whether a
  zero-retention option exists; the app's erasure proof does not cover it (E30, *tested (live database)*).
- In a test project on Turso, search the saved chats for a name, delete the matches and check that the
  server's deletion is configured (E57, *read in code*; E29, *read in code*).
- For a person's data outside saved chats, use the list in the
  [record-of-processing input](../../compliance/en/record-of-processing-input.md#retention-and-erasure); share
  the [works-council annex](../../compliance/en/works-council-annex.md) before allocation or RACI is used.

## Where to read more

- [DPIA input](../../compliance/en/dpia-input.md),
  [record-of-processing input](../../compliance/en/record-of-processing-input.md),
  [TOM sheet](../../compliance/en/tom-sheet.md) and
  [vendor touchpoints](../../compliance/en/vendor-touchpoints.md).
- [Appendix](appendix.md): the evidence table, the two routes and the generated tables.
- The other briefs: [CEO](ceo.md), [CAIO](caio.md), [CISO](ciso.md).
