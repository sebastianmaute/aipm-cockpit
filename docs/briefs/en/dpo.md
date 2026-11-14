# AI brief for the Data Protection Officer

## In one paragraph

Depending on the feature, the AI sends personal data to Anthropic, directly or through the organisation's
gateway: names in tasks, RAID items and stakeholders, people in the resource directory, absences as days
away, and attached files and e-mails with their senders and recipients (E1, *read in code*; E4,
*tested (unit)*; E5, *tested (unit)*). Who is controller and who processor, the legal basis, your contract and
data processing agreement with Anthropic, transfers and a works agreement are questions only your organisation
can answer; this page gives the facts for them.

## What leaves, and who approves it

- **Per feature:** what each feature sends about people is in
  [AI paths and people data](appendix.md#ai-paths-and-people-data) (E1, *read in code*). Among them: the
  allocation proposal sends each person's planned and available hours and the internal hourly rate of their
  role (E1, *read in code*); insights from Timelog name one person with findings about their logged working
  time (E1, *read in code*); five features send who is away even while the Resources function is hidden (E59,
  *read in code*).
- **Minimisation:** list results in the chat carry no e-mail addresses, though addresses can still appear in
  attachments, documents and logged edits, and the row edit never sends a person's phone number, birthday or
  notes (E1, *read in code*).
- **Protection and its limits:** people protection is on in every project unless the project allows people
  (E41, *tested (unit)*); with it on, known people's names, every e-mail address, valid IBAN and phone-shaped
  number are replaced (E14, *tested (unit)*); names the project does not know are sent as written, and a new
  project's names cannot be protected (E35, *read in code*); it is applied in the browser, so a modified copy
  of the app can send without it (E15, *read in code*).
- **Region:** all 96 measured requests reported Anthropic's inference_geo value `global` (E22, *measured*), and
  the app sets no such parameter itself (E58, *read in code*); what that means for transfers is your question,
  and Anthropic's to answer for your account.
- **Approval in the app:** whether a user's AI consent on a device plays any part in your legal basis is for
  you to decide (E31, *tested (unit)*).

## What you control

- **Protection everywhere:** `ai-people` forces protection on in every project (E19, *tested (unit)*), hiding
  the allocation proposal and the RACI suggestion (E18, *tested (unit)*); lifting that lock returns each project
  to its stored setting (E43, *read in code*).
- **Saved chats:** kept only with a Turso database and the operator's recovery key (E28, *read in code*);
  deleted 30 days after their last change unless the operator sets 1 to 3650 days, by the browser and, where it
  is set up, by the server (E29, *read in code*).
- **Erasure and lookup:** users can delete all their own chats, except their own chats from before the upgrade
  to private chats, which belong to no one and stay until they expire; the search for a person also reaches
  this project's older shared chats, which can hold other people's conversations, and can delete them; the
  operator can search and delete across the database (E57, *read in code*).

## Not yet proven / open gaps

1. **§813:** chat erasure is proven live only for its database statements, not for the screens, the sweeps
   with real credentials, the provider's backups or what the model vendor keeps (E30, *tested (live database)*).
2. **§810:** hiding the Resources function does not keep people and absences from the AI (E59,
   *read in code*).
3. **§804:** the allocation proposal always sends internal hourly rates (E1, *read in code*).
4. **§795:** background AI is consented once, not approved run by run (E32, *tested (unit)*).
5. **§814:** the refusal of images and PDFs while protection is on, and the hours from other projects in the
   allocation proposal, have no observed behaviour from a measured run (E39, *not proven*).

## What to check or ask for before saying yes

- Record your answers to the controller, processor, legal basis, transfer and works-agreement questions, using
  the [DPIA input](../../compliance/en/dpia-input.md#questions-for-your-assessment); set the key restriction so
  that requests through this deployment run on your organisation's keys (E7, *tested (unit)*; E52,
  *read in code*); a key that no longer passes is still accepted for up to 15 minutes (E9, *tested (unit)*).
- Ask Anthropic what it keeps of a request; the app's erasure proof does not cover it (E30,
  *tested (live database)*).
- In a test project on Turso, search the saved chats for a name, delete the matches and check that the
  server's deletion is configured (E57, *read in code*; E29, *read in code*).
- For a person's data outside saved chats, use the list of places in the
  [record-of-processing input](../../compliance/en/record-of-processing-input.md#retention-and-erasure).
- Share the [works-council annex](../../compliance/en/works-council-annex.md) before allocation or RACI is
  used.

## Where to read more

- [DPIA input](../../compliance/en/dpia-input.md),
  [record-of-processing input](../../compliance/en/record-of-processing-input.md),
  [TOM sheet](../../compliance/en/tom-sheet.md) and
  [vendor touchpoints](../../compliance/en/vendor-touchpoints.md).
- [Appendix](appendix.md): the evidence table, the two routes and the generated tables.
- The other briefs: [CEO](ceo.md), [CAIO](caio.md), [CISO](ciso.md).
