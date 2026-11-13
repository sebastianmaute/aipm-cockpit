# DPIA input

## About this document

This document describes the processing in AI PM Cockpit in the order a data protection impact assessment
works through it: what is processed, about whom, who receives it, where it goes, the risks and the measures
that address them. It is for the data protection officer and whoever helps with the assessment. The
hand-written text was last reviewed as the README's [review line](README.md#text-last-reviewed) states.

This document is input for your own work. It is not legal advice and not a completed assessment. Whether
your use of the app needs an assessment, and what the assessment concludes, is for you to decide.
[question for you]

An assessment contains at least a description of the processing and its purposes, an assessment of its
necessity and proportionality, an assessment of the risks to the people concerned, and the measures
envisaged to address those risks. [external: Regulation (EU) 2016/679, Art 35(7), Official Journal L 119
of 4 May 2016, read from the EU Publications Office at
http://publications.europa.eu/resource/cellar/3e485e15-11bd-11e6-ba9a-01aa75ed71a1 on 2026-11-13] This
document supplies material for the description, the risks and the measures. Necessity and proportionality
depend on your purposes and are yours to assess. [question for you]

## Purposes

The app is a project management tool. It holds tasks, risks, issues and decisions (RAID), milestones,
changes, stakeholders, a resource directory with workload and absence planning, budgets, time bookings
imported from Timelog, and documents. [verified: `src/app/types.ts`, `src/app/nav-config.ts`] Its AI
features, all optional, draft and analyse: a chat assistant, edits of single rows, report drafts,
allocation and RACI proposals, work-breakdown proposals, duplicate checks and summaries. Each is listed
with what it sends [below](#what-the-ai-features-send). [verified: `src/app/ai-disclosure.ts`] AI is off
until a user switches it on and accepts a disclosure of what each feature sends. [verified:
`isInteractiveAiAllowed` in `src/app/ai-consent.ts`]

Which of these functions your organisation uses, for which purposes and on which legal basis, is yours to
state. In particular, say whether any purpose includes planning, monitoring or evaluating staff, because
several functions can be used that way (see the [works council annex](works-council-annex.md)).
[question for you]

## Data categories

The full list of personal data the app holds, with the code that defines each, is in the
[record of processing input](record-of-processing-input.md#record-fields), row "(c) Categories of personal
data". It is not repeated here. [verified: see that row] For the assessment, these categories deserve
attention:

- **Absences with their type.** An absence records the person, the dates and a type (vacation, sick,
  training or other), plus a note. [verified: `Absence` and `AbsenceType` in `src/app/types.ts`] Whether a
  "sick" absence is health data in your use is for you to decide. [question for you]
- **Logged working time.** With the Timelog integration, the app imports each person's logged hours and
  checks them against rules: a single entry or a day's total over a limit, more hours than the person's
  defined hours, time logged on a non-working day or on a day the person was absent, and changes in a
  closed month. Each rule that fires becomes an insight naming the person. [verified: `INSIGHT_TYPES` in
  `src/app/insights/insight.ts`, `src/app/timelog-policy.ts`]
- **Ratings of people.** Stakeholders carry an influence and an interest rating and RACI roles.
  [verified: `Stakeholder` in `src/app/types.ts`]
- **Hourly rates.** Rates are held per role, not per person, but a person with a role is linked to its
  rate, and the allocation proposal sends it (§804). [verified: `Role` in `src/app/types.ts`; the
  allocation row of the table below]
- **Free text.** Task descriptions, note logs, RAID items, changes, documents, attached files and e-mails
  can hold anything users write or attach. [verified: `src/app/types.ts`] What staff may write there is
  for you to decide. [question for you]
- **The activity log.** It keeps the old and new values of changed fields, which can include people's
  names, and records whether a user, the AI or an integration made a change, but not which user.
  [verified: `ActivityActor` and `ACTIVITY_MAX_ENTRIES` in `src/app/activity-log.ts`]

## Data subjects

- **Staff.** People in the resource directory, task assignees and owners, RAID owners, people with
  absences and with logged working time. [verified: `Resource`, `Task`, `RaidItem`, `Absence` in
  `src/app/types.ts`]
- **External people.** External people in the resource directory, stakeholders such as steering-committee
  members, and the senders and recipients of e-mails attached to a chat or to the project wizard.
  [verified: `Resource` and `Stakeholder` in `src/app/types.ts`; the chat and wizard rows of the table
  below]
- **Users of the app.** Their saved AI chats, which carry a random owner id rather than a name, and the
  settings on their device. [verified: `src/app/chat-crypto.ts`; the record of processing input,
  "Saved AI chats"] The app has no user accounts. [vendor statement; `docs/security.md`, section "Security
  model"]

Which groups occur in your use, and whether any of them is in a weaker position towards your
organisation, is for you to assess. [question for you]

## Recipients

The app sends data only to services that a user or your operator sets up, each with a key or sign-in that
belongs to the user or your organisation:

- **Anthropic**, for the AI features, directly from the browser or through the app's server and, where
  your operator sets one, your organisation's AI gateway. [verified: `src/app/ai-disclosure.ts`,
  `src/app/outbound-destinations.ts`]
- **The speech-to-text service** a user configures, for dictation. [verified: the dictation row of the
  table below]
- **Microsoft 365, Turso, Atlassian (Jira, Confluence) and Timelog**, when users or your operator set up
  those integrations. [verified: `src/proxy.ts`, `src/app/outbound-destinations.ts`]
- **The European Central Bank**, for exchange rates. It receives no project data but sees the IP address
  of the server, or in the desktop app of the user's computer. [verified:
  `src/app/outbound-destinations.ts`]

The maintainer receives nothing from the app at runtime and is not a recipient; see
[vendor touchpoints](vendor-touchpoints.md#what-reaches-the-maintainer). [vendor statement; the hosts:
verified, `src/proxy.ts`, `src/app/outbound-destinations.ts`]

Anthropic's Data Processing Addendum states that, for customer personal data, the customer is the
controller and Anthropic is the customer's processor. [external: Anthropic Data Processing Addendum,
https://www.anthropic.com/legal/data-processing-addendum, effective 24 February 2025, read 2026-11-13]
Anthropic's Commercial Terms state that Anthropic may not train models on customer content from its
services. [external: Anthropic Commercial Terms of Service, section B,
https://www.anthropic.com/legal/commercial-terms, effective 17 June 2025, read 2026-11-13] Whose
Anthropic account a key belongs to decides who that customer is; the
[vendor touchpoints](vendor-touchpoints.md#roles) explain how an operator can restrict the app to your
organisation's keys. [verified: `src/app/ai-key-restriction-config.ts`] Which contract covers each
recipient, and in which role, is yours to establish. [question for you]

## Transfers outside the EU

**AI requests.** The app does not set where Anthropic processes a request: it sends no `inference_geo`
parameter. [verified: no use of `inference_geo` in `src/`] Anthropic documents two values for that
parameter, `global` (the default; inference may run in any available geography) and `us`, and a workspace
setting that fixes the default and the allowed values. Separately, the workspace geo decides where data is
stored at rest and where endpoint processing happens, and `us` is currently the only workspace geo
available. [external: Claude Platform Docs, "Data residency",
https://platform.claude.com/docs/en/manage-claude/data-residency, read 2026-11-13] So an AI request from
the app is processed in the United States or, under `global`, in any geography Anthropic uses, and is
stored at rest in the United States. [the app's side: verified as above; Anthropic's side: external, same
page, read 2026-11-13]

Anthropic's Data Processing Addendum incorporates the Standard Contractual Clauses, Module Two and/or
Three, to the extent data protection law requires them. [external: Anthropic Data Processing Addendum,
https://www.anthropic.com/legal/data-processing-addendum, effective 24 February 2025, read 2026-11-13]

**How long Anthropic keeps requests.** Anthropic's privacy center states that it deletes inputs and
outputs on its backend within 30 days of receipt or generation, unless agreed otherwise (its example is a
zero data retention agreement); that inputs and outputs flagged by its trust and safety systems are kept
for up to 2 years and their classification scores for up to seven years; and that data may be kept longer
where the law requires or to enforce its usage policy. [external: Anthropic Privacy Center, "How long do
you store my organization's data?",
https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data, last
updated 1 July 2026, read 2026-11-13] An AI gateway your organisation runs keeps what its own settings
say. [vendor statement]

**Other services.** Where Microsoft 365, Turso, Atlassian, Timelog and a speech-to-text service process
and store data depends on your accounts and contracts with them. [question for you]

Which inference setting your Anthropic workspace uses, which transfer safeguard applies to each service,
and whether that is acceptable for your data, is for you to decide and record. [question for you]

## What the AI features send

The table is the app's own list of every feature that sends data to an AI or speech service. The consent
dialog shows the same rows, and a test fails when an AI call site listed in
`src/test/ai-activation-sites.ts` has no row. [verified: `src/app/ai-disclosure.ts`,
`src/app/ai-disclosure.test.ts`] The last column says what people protection changes. Protection is on by
default in every project; a user can turn it off for one project in Settings, and an operator can force it
on for every project with `AIPM_DISABLED_INTEGRATIONS=ai-people`. [verified:
`src/app/ai-people-protection.ts`, `src/app/settings-sections/ai-people-protection-control.tsx`,
`src/app/deployment-variables.ts`] The three rows whose consent is "asked separately" run in the
background while the app is open, without a person starting each run (§795). [verified:
`level: "background"` in `src/app/ai-disclosure.ts`; `src/app/use-scheduled-job-runner.ts`,
`src/app/use-insight-recommend-runner.ts`, `src/app/use-digest.ts`]

<!-- PACK:ai-paths:BEGIN -->
| Feature | Consent | What is sent | With people protection on |
|---|---|---|---|
| AI Assistant chat | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Your messages; the files and e-mails you attach (an e-mail with its body and its sender and recipient names and addresses); your operating guides; and the project data the assistant reads to answer: tasks with their descriptions and note logs, milestones, RAID items, changes, stakeholders, people in the resource directory, absences (only as “absent”, with the person and the dates), budget figures, calendar events, documents and project details, and, when it searches them, the activity history and your other chats in this project. With every message it also gets the number of your other chats in this project and the titles and last-activity times of up to three of the most recent ones (an unnamed chat is titled with the start of its first message; chats are kept only with a Turso database), and the project’s open insights: up to ten current ones and up to five you acted on with their measured result, one line each. An insight from Timelog names one person (or their Timelog user number when no one in the resource directory is linked) with their logged working time: on how many days a single entry or a day’s total went over a limit, they logged more than their defined hours, they logged time on a non-working day or on a day they were absent (vacation, sick or training), or time in a closed month was changed, with the worst hours, the limit where there is one, and for a closed month the net change. People’s names are included. List results carry no e-mail addresses: the assistant reads one address at a time, only when it needs it, though addresses can still appear in attachments, documents and logged edits. The whole conversation is sent again with every new message. Saved chats are encrypted so that only the person who wrote them and the operator holding the recovery key can read them, and each is deleted when the retention period has passed since its last change (30 days unless the operator sets another). Exceptions: chats saved by an earlier version of the app, which others in the project can read until they expire, and the AI gateway’s own logs where your organisation uses one. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending, and the assistant cannot assign, move or rate anyone. Images and PDFs are refused while protection is on. Names the project does not know, typed into free text or contained in text attachments, may still be sent. |
| Inline AI edit on a row | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Your instruction, the one row you edit and a short project context (today’s date, task count, groups and labels, and the same open-insight lines the chat gets, so a Timelog insight can name a person with their logged working time), plus your operating guide for inline edits if you have one. The row includes names, dates and descriptions, and for a task its blocker log with the name of whoever logged each entry; for a person in the resource directory their name, job title, department, company, role, whether they are external, whether they are active, and their planned workload per period and whether it is planned in percent or hours. Never sent: e-mail addresses, note logs, a person’s phone number, location, birthday, notes and absence hours, a stakeholder’s notes, influence and interest, and an absence’s type and note. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Steering committee report draft | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The meeting agenda you typed, your operating guide for this report if you have one, and a status summary: overall status (RAG), task counts, overdue and due-soon counts, RAID and change counts, up to five change titles, and the names and dates of overdue, at-risk and due-soon milestones. No people’s names or e-mail addresses, unless they are in a title or the agenda. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Digest summary, on request | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Overall status (RAG), the number of overdue tasks, the numbers of open and high-severity RAID items, and the names and dates of milestones due soon, plus your operating guide for the digest if you have one. No people’s names, notes or e-mail addresses, unless they are in a milestone name. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Forecast import from a spreadsheet | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The sheet you choose, with its name (for a CSV file, the file name without its extension), as a table of its non-empty cells (a sheet too large for one request is not sent), plus your operating guide for the import if you have one. Whatever the sheet holds is sent: usually people’s names and planned hours, and their e-mail addresses and hourly rates when the sheet has them. No other project data. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Insight recommendation, on request | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The project name, today’s date, the insight’s type, severity and figures, the titles of up to 30 tasks, the names of up to 30 people (active resources and assignees of open tasks), and the item the insight is about: a milestone with its description, a RAID item with its owner and mitigation, or a person’s job title, department and company. For a working-time insight from Timelog the figures are about one person: their name and Timelog user number, on how many days a single entry or a day’s total went over a limit, they logged more than their defined hours, they logged time on a non-working day or on a day they were absent (vacation, sick or training), or time in a closed month was changed, with the worst hours, the limit where there is one and, for a closed month, the net change, and the first and last dates concerned. Also your operating guide for recommendations if you have one. No e-mail addresses and no resource notes. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Analyze next actions with AI | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The project name, today’s date, planned, actual and forecast budget, the next-actions queue (titles and reasons), open tasks (title, status, priority, assignee, due date), active RAID items (category, severity, status, owner, target date), milestones, pending changes, and stakeholder names with their title or organisation, plus your operating guide for analyses if you have one. No descriptions, notes or e-mail addresses. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Allocation plan proposal | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Your request, your operating guide if you have one, the plan window and periods, the workday length and the plan currency, and for each person in the resource directory: their name (or their number in the resource directory if no name is set), role, whether they are external, whether their workload is planned in percent or in hours, their planned and available hours per period, and for an internal person with a role the internal hourly rate of that role. Absences are used to work out available hours and are not sent. Also up to 150 open tasks, each with its title, owner (a name where the owner is not one of the people listed), remaining estimate, start and due dates, status, whether it is synced from Jira, the open tasks it waits for, its milestones and its hours per period; up to 40 milestones with their name, date and whether they are achieved; and which of the listed people are responsible or accountable for each milestone. When the project shares a Turso database with other projects and a person here is matched to a person in another project that does not protect its people from the AI, it also sends that project's name, the hours booked for that person there per period, and their open-task count and remaining hours there (no task titles). The names of other projects that could not be read, or that were left out because they protect their people, are sent too. | Not available: the feature is hidden while protection is on. Where it is available, other projects that protect their people are left out of the hours counted from them. |
| RACI suggestion | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Stakeholder names, titles, organisations, categories, influence and interest; milestone names, dates and descriptions; the existing RACI assignments; and your operating guide if you have one. No e-mail addresses. | Not available: the feature is hidden while protection is on. |
| Duplicate task check | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | For each task: its number, status, due date, title, assignee and the first 200 characters of its description, plus your operating guide if you have one. No e-mail addresses or note logs. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Work breakdown (WBS) proposal | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Your instruction, your operating guide if you have one, the project name and window, groups, milestones, and for each task: name, group, status, start and due dates, estimate, dependencies, assignee and a shortened description. No e-mail addresses or note logs. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Next-actions weight suggestion | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The project name, the titles of tasks, RAID items, milestones and changes, the next-actions queue, your current weights and learning counts, a trend summary, and stakeholder names, plus your operating guide for weight suggestions if you have one. No descriptions, notes or e-mail addresses. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| New project proposal (project wizard) | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Only what you give the wizard: the brief you type, the files you attach (an e-mail with its body and its sender and recipient names and addresses), and the SharePoint files and Confluence pages you pick, plus your operating guide if you have one. No data from existing projects. | Email addresses, phone numbers and IBANs are always replaced by placeholders. Names cannot be: a new project has no known people yet, so names in your brief and in files you add to the wizard are sent. Images and scanned or PDF documents are sent too, unless your organisation forces protection; then they are refused. The AI’s proposal is applied without any people: no sponsor, project manager, stakeholders, resources, assignees or owners. |
| Speech-to-text dictation | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | When you choose a speech-to-text service, the audio you record and that service’s API key go through this app’s own server route to the speech service you configured, not to Anthropic. Without this consent, while AI is switched off, or while that service’s address or key is missing or cannot be read on this device, dictation with that service is unavailable; it never switches to another engine on its own. Only when you choose browser dictation instead, or this deployment has switched speech-to-text off, does it use the browser’s built-in speech recognition, which in some browsers sends audio to the browser maker’s service. | Not available: the feature is switched off while protection is on. |
| Scheduled job analysis | Asked separately on each device, and only counts together with the interactive consent; asked again on the same changes | The job’s instruction and, for the project it covers, the same summary as “Analyze next actions with AI”: budget figures, the next-actions queue, open tasks with assignees and due dates, active RAID items with owners, milestones, pending changes and stakeholder names with their title or organisation, plus your operating guide for analyses if you have one. No descriptions, notes or e-mail addresses. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Automatic insight recommendations | Asked separately on each device, and only counts together with the interactive consent; asked again on the same changes | The project name, today’s date, the insight’s type, severity and figures, the titles of up to 30 tasks, the names of up to 30 people (active resources and assignees of open tasks), and the item the insight is about: a milestone with its description, a RAID item with its owner and mitigation, or a person’s job title, department and company. For a working-time insight from Timelog the figures are about one person: their name and Timelog user number, on how many days a single entry or a day’s total went over a limit, they logged more than their defined hours, they logged time on a non-working day or on a day they were absent (vacation, sick or training), or time in a closed month was changed, with the worst hours, the limit where there is one and, for a closed month, the net change, and the first and last dates concerned. Also your operating guide for recommendations if you have one. No e-mail addresses and no resource notes. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Digest summary, scheduled | Asked separately on each device, and only counts together with the interactive consent; asked again on the same changes | Overall status (RAG), the number of overdue tasks, the numbers of open and high-severity RAID items, and the names and dates of milestones due soon, plus your operating guide for the digest if you have one. No people’s names, notes or e-mail addresses, unless they are in a milestone name. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
<!-- PACK:ai-paths:END -->

## Risks and measures

The risks below are the ones the maintainer sees in the app itself. Your assessment will add risks from
your purposes, your people and your environment. [vendor statement; your risks: question for you] Each
measure is described, with its evidence and its limits, in the [TOM sheet](tom-sheet.md#measures); the
"TOM sheet row" column names the row. What remains open is listed with its register entry, explained in
the [README](README.md#open-gaps). [verified: the TOM sheet rows and register entries named]

| Risk | What the app does | TOM sheet row | What remains |
|---|---|---|---|
| Personal data of staff and external people reaches the AI provider, outside the EU | AI is off until a user accepts a per-feature disclosure. People protection, on by default, replaces known people's names, e-mail addresses and phone numbers with placeholders and hides the allocation and RACI features. An operator can restrict AI to the organisation's Anthropic keys, route it through a gateway, or switch it off. [verified: `src/app/ai-consent.ts`, `src/app/ai-people-protection.ts`, `src/app/ai-key-restriction-config.ts`, `src/app/api/_shared/integration-switch.ts`] | AI consent per device; People protection; Organisation key restriction; AI gateway route; Switches for integrations and AI | Names the project does not know, in free text or attachments, are still sent. The project wizard sends the names in what the user gives it. Protection is enforced in the browser, so a modified client could bypass it. Internal hourly rates go with every allocation request (§804). The gateway has never run against a real one (§802). [verified: `src/app/ai-disclosure.ts`; TOM sheet] |
| Someone who is not entitled uses the app's server, or your AI gateway through it | Nothing in the app: its server routes do not authenticate callers. [verified: the 15 route files under `src/app/api`] | Access to project data is your storage's; What these measures do not cover | The AI relay attaches the gateway token for any caller (§805); the AI and dictation routes have no request limit (§806); the limit on the other routes can be avoided (§562). Run the server behind your own access control. [vendor statement; how: question for you] |
| Someone who is not entitled reads or changes project data | Access is decided by the storage you choose; secrets entered in Settings are encrypted at rest on the device. [verified: `src/app/secrets.ts`; `docs/security.md`, section "Security model"] | Secrets sealed at rest; Access to project data is your storage's | Within a project everyone with access sees and can change everything; the app has no roles. Anyone with the Turso token can read every project in that database. [vendor statement; `docs/security.md`] |
| The AI changes project data without a person approving it | The chat holds a proposed change on a review card when it deletes something, mails meeting attendees, edits the project record, changes more than one item, lands a date on someone's absence, or while a file is attached. The other AI features that change project data show their result first (an itemized preview, or a pre-filled form in the project wizard) and change nothing until a person applies it. Chat changes are logged as the AI's. [verified: `shouldStage` in `src/app/chat-proposal.ts`; `src/app/activity-log.ts`; the per-feature evidence is in the [works council annex](works-council-annex.md#what-the-ai-may-do-without-a-person-approving-it)] | Review before AI changes; Activity log | A single chat change outside those cases applies at once (§794). Outside text read through the chat's tools does not start the hold (§797). Tasks created by an applied work breakdown cannot be undone (§796). The log does not link an AI change to the chat message behind it (§799). |
| Wrong or made-up AI output is used in decisions about people | Allocation and RACI proposals are shown cell by cell with the current and proposed value and can be deselected one by one before Apply; both are hidden while people protection is on. [verified: `src/app/alloc-plan-modal.tsx`, `src/app/raci-suggest-modal.tsx`, `src/app/use-alloc-plan.tsx`] | People protection; Review before AI changes | The app cannot check whether a proposal is right or fair. The same request can give different proposals from run to run: the app sets no sampling temperature. [verified: no use of `temperature` in `src/app`] How people are trained to judge AI output is yours (see [AI literacy](ai-literacy.md)). [question for you] |
| Staff are monitored or evaluated through the app | The Timelog module and the resources module can be switched off per project; an operator can switch the Timelog integration off for the deployment. [verified: `src/app/feature-modules.ts`, `src/app/deployment-variables.ts`] | Switches for integrations and AI | The activity log cannot be switched off. Who may see workload, absences and logged working time is not limited inside a project. See the [works council annex](works-council-annex.md). [verified: `CORE_VIEWS` in `src/app/feature-modules.ts`] |
| AI runs send project data without anyone starting them | Background runs need a second consent on each device, apply people protection, and only advise: a recommendation applies only when a person confirms it. [verified: `src/app/ai-consent.ts`, `src/app/use-insight-recommendations.ts`, `src/app/scheduled-job-run.ts`] | AI consent per device | Runs are not approved one by one (§795). |
| Data is kept longer than needed | Saved AI chats are deleted after a retention period (30 days unless the operator sets another), and users and the operator have erasure tools. [verified: `src/app/ai-chat-retention-config.ts`, `scripts/chat-erasure.mjs`] | Saved AI chats: encryption, retention, erasure; Activity log | Project data, version history kept by hand, and data sent to other services are not deleted by age. See the record of processing input, [Retention and erasure](record-of-processing-input.md#retention-and-erasure). |
| Instructions hidden in a file or in outside text make the AI act against the user's intent | While a file is attached to the conversation, every change the chat proposes waits on the review card. [verified: `stagesWhenUntrusted` in `src/app/chat-send-record.ts`, `shouldStage` in `src/app/chat-proposal.ts`] | Review before AI changes | Outside text read through the chat's tools, such as content synced from Jira, does not start the hold (§797). |
| A tampered installer reaches users' computers | Releases carry GitHub build provenance and an SBOM attestation that can be checked. [verified: `.github/workflows/release.yml`; `SECURITY.md`] | Release integrity | No installer released so far is code-signed (§487), and the uninstaller will not be signed (§793). |
| People cannot tell AI-written text from text a person wrote | The app's own screens name the AI where its output is shown, and the activity log records AI changes as the AI's. [verified: `actionAiDisclaimer` and `chatProposalTitle` in `src/app/i18n.ts`; `src/app/activity-log.ts`] | Activity log | Text the AI writes into tasks, documents and exports carries no machine-readable marking (§801). |

Whether these measures are enough for your risks is your judgement. [question for you]

## Questions for your assessment

The Article 29 Working Party's DPIA guidelines name nine criteria of processing likely to result in a
high risk, and say that in most cases processing meeting two of them needs an assessment. [external:
Article 29 Data Protection Working Party, "Guidelines on Data Protection Impact Assessment (DPIA) and
determining whether processing is likely to result in a high risk", WP 248 rev.01, adopted 4 April 2017,
last revised and adopted 4 October 2017, https://ec.europa.eu/newsroom/just/document.cfm?doc_id=47711,
read 2026-11-13] They are listed here as questions, with the facts about the app that bear on each. The
maintainer does not score them: the answers depend on your use. [vendor statement]

1. **Evaluation or scoring.** Do you use the Timelog rules that flag a person's logged working time, the
   workload view, or stakeholders' influence and interest ratings to evaluate people? [question for you]
   The facts: those functions exist and are described in the [works council annex](works-council-annex.md).
   [verified: see that annex]
2. **Automated decision-making with legal or similar significant effect.** Do decisions about people rest
   on AI output? [question for you] The facts: the app's AI features propose; a person applies, with the
   exception of a single chat change outside the review rules (§794). [verified: `shouldStage` in
   `src/app/chat-proposal.ts`]
3. **Systematic monitoring.** Does importing logged working time and checking it against rules amount to
   monitoring in your use? [question for you] The facts: the checks run while the app is open, on the
   figures cached on the device. [verified: `src/app/timelog-policy.ts`, `src/app/use-insight-lifecycle.ts`,
   `src/app/timelog-actuals-store.ts`]
4. **Sensitive data or data of a highly personal nature.** Do you record sick absences, or let staff write
   health or other sensitive details into free text? [question for you]
5. **Data processed on a large scale.** How many people, projects and devices are involved? [question for
   you]
6. **Matching or combining datasets.** The Timelog figures are matched to people in the resource
   directory, and on a shared Turso database people can be linked across projects, with the hours booked
   for them elsewhere sent in allocation requests. [verified: `src/app/person-links-schema.ts`; the
   allocation row of the table above] Does that exceed what the people concerned expect? [question for
   you]
7. **Data concerning vulnerable data subjects.** The guidelines name employees as an example, because of
   the imbalance between them and the controller. [external: WP 248 rev.01, as above, read 2026-11-13] How
   does that apply to the staff in your projects? [question for you]
8. **Innovative use or new technological solutions.** The AI features use a large language model.
   [verified: `src/app/ai-disclosure.ts`] Do you count that as new technology in your assessment?
   [question for you]
9. **Processing that prevents people from exercising a right or using a service.** Does any use of the
   app in your organisation decide access to work, pay or a service? [question for you]

Further questions only you can answer: [question for you]

- Which legal basis covers each purpose, and does a user's AI consent on a device play any role in it?
  (The app records that a user saw the disclosure; see the TOM sheet row "AI consent per device".)
- Will you force people protection on for every project, and who may turn it off for one project?
- Which inference and storage settings does your Anthropic workspace use, and under whose account do your
  users' keys run?
- Who may use the app's server, and how is that enforced in front of it?
- Who informs staff and external people, and how? The [model notices](model-notices.md) are templates.
- Who reviews AI-written content before it leaves the project, for example in exports or reports?
- Do you need to consult the works council before introducing the app? See the
  [works council annex](works-council-annex.md).
