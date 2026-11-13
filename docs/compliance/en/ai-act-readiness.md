# AI Act readiness note

## About this document

This note sets out how the EU AI Act may bear on AI PM Cockpit: the roles as the maintainer reads them, the
transparency duties and where the app stands on them, the open question whether the allocation and RACI
suggestions fall under the high-risk list, and what a deployer would owe if it decides they do. It is for
the person responsible for AI in your organisation, and for the data protection officer and works council
where they share that work. The hand-written text was last reviewed as the README's
[review line](README.md#text-last-reviewed) states.

This note is input for your own work. It is not legal advice. It reaches no conclusion on how the app or any
of its features is classified; that classification is yours, and it depends on how you use the app.
[question for you]

The AI Act is Regulation (EU) 2024/1689. [external: Official Journal, L series, 2024/1689 of 12 July 2024,
read from the EU Publications Office at
http://publications.europa.eu/resource/cellar/dc8116a1-3fe6-11ef-865a-01aa75ed71a1 on 2026-11-13] It was
amended by Regulation (EU) 2026/1744 ("Digital Omnibus on AI") of 8 July 2026, which entered into force on
the third day after its publication in the Official Journal on 24 July 2026. [external: Official Journal, L
series, 2026/1744 of 24 July 2026, read from the EU Publications Office at
http://publications.europa.eu/resource/cellar/b459c07f-86fb-11f1-bf5e-01aa75ed71a1 on 2026-11-13] Where
this note gives a date or a duty, it names the article; read the article itself before relying on it.
[vendor statement]

## Roles

The Act defines a provider as whoever develops an AI system and places it on the market or puts it into
service under its own name, "whether for payment or free of charge" (Art 3(3)), and a deployer as whoever
uses an AI system under its authority, other than in a personal non-professional activity (Art 3(4)). It
does not apply to AI systems released under free and open-source licences, unless they are placed on the
market or put into service as high-risk AI systems or as systems that fall under Article 5 or 50 (Art
2(12)). [external: Regulation (EU) 2024/1689, Art 2(12), Art 3(3) and (4), read 2026-11-13 as above]

The maintainer's reading, which is not a legal conclusion: [vendor statement]

- **The maintainer** offers the app free of charge under the European Union Public Licence 1.2 [verified:
  `LICENSE`, `package.json`] and may count as the provider of an AI system that interacts with people and
  generates text. On that reading, the open-source exclusion does not lift the transparency duties of
  Article 50, which are described below.
- **Your organisation** is the deployer when its staff use the app under its authority.
- **Anthropic** provides the general-purpose AI models the app calls. The app sends its requests to
  Anthropic's API, directly or through your organisation's gateway. [verified: `src/app/ai-disclosure.ts`,
  `src/app/outbound-destinations.ts`]

A deployer that changes the intended purpose of an AI system that was not classified as high-risk, so that
it becomes high-risk, is treated as its provider and takes on the provider's obligations (Art 25(1)(c)).
[external: Regulation (EU) 2024/1689, Art 25(1), read 2026-11-13 as above] What your organisation uses the
app for therefore matters to your role. [question for you]

The maintainer has made no conformity assessment of the app, holds no technical documentation in the
form the Act sets for high-risk systems, has not registered the app in the EU database and offers no
contract or support period. [vendor statement]

## Transparency (Article 50)

Article 50 applies from 2 August 2026, the Act's general date of application (Art 113). It asks providers
to make sure that people are told when they interact directly with an AI system, unless that is obvious
(Art 50(1)), and that the synthetic text, audio, image or video their systems generate is marked in a
machine-readable format and detectable as artificially generated (Art 50(2)). The marking duty does not
apply to the extent a system performs an assistive function for standard editing or does not substantially
alter the input data provided by the deployer or its semantics. [external: Regulation (EU) 2024/1689, Art
50(1), (2) and Art 113, read 2026-11-13 as above] For systems placed on the market before 2 August 2026,
the providers must take the steps needed to meet Art 50(2) by 2 December 2026. [external: Regulation (EU)
2026/1744, the paragraph it adds to Art 111 of Regulation (EU) 2024/1689, read 2026-11-13 as above]
Deployers have their own duty under Art 50(4) for text published to inform the public on matters of public
interest, which does not apply where the text has had human review or editorial control and someone holds
editorial responsibility. [external: Regulation (EU) 2024/1689, Art 50(4), read 2026-11-13 as above]
Whether you publish AI-written text from the app in that way is for you to decide. [question for you]

### What the app tells users

- AI is off until a user switches it on in Settings and accepts a disclosure that lists every AI feature
  and what it sends. [verified: `isInteractiveAiAllowed` in `src/app/ai-consent.ts`,
  `src/app/ai-disclosure.ts`]
- The AI's controls and output carry its name: the chat is "AI Assistant", row edits and other entry
  points read "Ask Claude", and the analysis of next actions is marked "AI-generated — review before
  acting." [verified: `aiDataChatLabel`, `inlineAiEdit`, `aiAskClaude` and `actionAiDisclaimer` in
  `src/app/i18n.ts`]
- Changes the chat proposes appear in the chat under "Proposed changes", and changes the chat applies are
  logged in the activity log with the AI as their actor. [verified: `chatProposalTitle` in
  `src/app/i18n.ts`; `ActivityActor` in `src/app/activity-log.ts`; the register entry §794]

People outside your organisation, such as steering-committee members, do not use the app. They meet the
AI's work only in what your users pass on: reports, e-mails and exports. [vendor statement] How you inform
them is for you to decide; the [model notices](model-notices.md) offer a template. [question for you]

### Marking of generated text

The app does not mark text the AI writes in a machine-readable way. Once that text is in a task, a
document, a report or an export, nothing in it shows that the AI wrote it (§801). [verified: the register
entry §801 in `docs/open-followups.md`] Whether some of the app's AI paths are assistive editing in the
sense of the exception above, for example a one-row edit the user asked for, is an open question; the
maintainer has not settled it. [vendor statement; question for you]

## Allocation and RACI suggestions (Annex III)

Annex III lists, under employment and workers' management, AI systems "intended to be used to make
decisions affecting terms of work-related relationships, the promotion or termination of work-related
contractual relationships, to allocate tasks based on individual behaviour or personal traits or
characteristics or to monitor and evaluate the performance and behaviour of persons in such
relationships" (point 4(b)). [external: Regulation (EU) 2024/1689, Annex III, point 4(b), read 2026-11-13
as above] An Annex III system is excepted when it poses no significant risk of harm, including by not
materially influencing the outcome of decision-making, and meets one of four conditions: a narrow
procedural task; improving the result of a completed human activity; detecting decision-making patterns
without replacing human assessment; or a preparatory task to an assessment. A system that performs
profiling of natural persons is always high-risk. A provider relying on that exception must document its
assessment and register the system (Art 6(3) and (4)). [external: Regulation (EU) 2024/1689, Art 6(3) and
(4), read 2026-11-13 as above]

Two features are closest to point 4(b): the allocation proposal ("Plan with AI"), which proposes people's
planned hours per period and moves of open tasks between people, and the RACI suggestion, which proposes
who is responsible, accountable, consulted or informed for each milestone. [verified:
`src/app/alloc-plan/alloc-plan.ts`, `src/app/alloc-plan/alloc-ground-moves.ts`,
`src/app/raci-suggest/raci-suggest.ts`] The maintainer has not classified them. [vendor statement]

### Arguments for and against

Arguments that they could fall under point 4(b): [vendor statement; the facts: verified as named]

- They allocate work to named people: the allocation proposal moves tasks and sets planned hours, and the
  RACI suggestion assigns roles. [verified: as above]
- Outside these two features, the chat and the row edit can also assign tasks to people while people
  protection is off. [verified: `PERSON_FIELDS_BY_TOOL` in `src/app/ai-person-fields.ts`]
- The app evaluates logged working time per person through its Timelog rules, and those findings, which
  name the person, go to the AI in chat requests and insight recommendations. [verified: the chat and
  insight rows of the table [below](#ai-features-and-the-data-they-send); `src/app/timelog-policy.ts`]
- Classification follows the intended purpose and the use. A deployer that uses the proposals to decide
  who does which work may be in the area the annex describes, whatever the inputs. [vendor statement]

Arguments that they might not: [vendor statement; the facts: verified as named]

- The allocation request carries role, external status, planning mode, planned and available hours and
  role rates, not behaviour, performance ratings or personal traits; absences are used only to work out
  available hours. The RACI request carries stakeholders' titles, organisations, categories and influence
  and interest ratings. [verified: the allocation and RACI rows of the table below] Whether an influence or
  interest rating is a personal trait in your use is a question in itself. [question for you]
- Both features propose. A person sees each proposed change with its current and new value, can deselect
  any of them, and applies them. [verified: `src/app/alloc-plan-modal.tsx`, `src/app/raci-suggest-modal.tsx`]
  That may support the preparatory-task condition of Art 6(3), which still requires that the system does
  not materially influence the decision and does not profile.
- Both are optional: AI is off until switched on, and both features are hidden while people protection,
  which is on by default, is on. [verified: `src/app/ai-consent.ts`, `src/app/use-alloc-plan.tsx`,
  `src/app/ai-people-protection.ts`]

What decides it is your purpose and your use, which the maintainer cannot see. [question for you]

### People-related AI features

People protection can force these features off. An operator who sets `AIPM_DISABLED_INTEGRATIONS=ai-people`
turns protection on in every project, which hides the allocation proposal and the RACI suggestion, keeps
the AI from setting, changing or clearing a person on any record, and withdraws the chat's tools for
people, absences and allocations. Setting `ai` instead switches all AI off. [verified:
`src/app/ai-people-protection.ts`, `src/app/use-alloc-plan.tsx`, `src/app/ai-person-fields.ts`,
`PEOPLE_TOOLS` in `src/app/chat-tool-defs.ts`, `src/app/deployment-variables.ts`] Protection is enforced in
the app in the browser, so a modified client could bypass it. [verified: the TOM sheet row "People
protection"] A deployer that does not want to use these features at all can therefore switch them off for
the whole deployment, and record that in its own assessment. [question for you]

The table lists the AI features whose requests can carry data about people, and what protection does to
each. [verified: `PEOPLE_PATH_IDS` in `src/app/compliance/pack-blocks.ts`]

<!-- PACK:ai-paths-people:BEGIN -->
| Feature | Consent | What is sent | With people protection on |
|---|---|---|---|
| AI Assistant chat | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Your messages; the files and e-mails you attach (an e-mail with its body and its sender and recipient names and addresses); your operating guides; and the project data the assistant reads to answer: tasks with their descriptions and note logs, milestones, RAID items, changes, stakeholders, people in the resource directory, absences (only as “absent”, with the person and the dates), budget figures, calendar events, documents and project details, and, when it searches them, the activity history and your other chats in this project. With every message it also gets the number of your other chats in this project and the titles and last-activity times of up to three of the most recent ones (an unnamed chat is titled with the start of its first message; chats are kept only with a Turso database), and the project’s open insights: up to ten current ones and up to five you acted on with their measured result, one line each. An insight from Timelog names one person (or their Timelog user number when no one in the resource directory is linked) with their logged working time: on how many days a single entry or a day’s total went over a limit, they logged more than their defined hours, they logged time on a non-working day or on a day they were absent (vacation, sick or training), or time in a closed month was changed, with the worst hours, the limit where there is one, and for a closed month the net change. People’s names are included. List results carry no e-mail addresses: the assistant reads one address at a time, only when it needs it, though addresses can still appear in attachments, documents and logged edits. The whole conversation is sent again with every new message. Saved chats are encrypted so that only the person who wrote them and the operator holding the recovery key can read them, and each is deleted when the retention period has passed since its last change (30 days unless the operator sets another). Exceptions: chats saved by an earlier version of the app, which others in the project can read until they expire, and the AI gateway’s own logs where your organisation uses one. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending, and the assistant cannot assign, move or rate anyone. Images and PDFs are refused while protection is on. Names the project does not know, typed into free text or contained in text attachments, may still be sent. |
| Inline AI edit on a row | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Your instruction, the one row you edit and a short project context (today’s date, task count, groups and labels, and the same open-insight lines the chat gets, so a Timelog insight can name a person with their logged working time), plus your operating guide for inline edits if you have one. The row includes names, dates and descriptions, and for a task its blocker log with the name of whoever logged each entry; for a person in the resource directory their name, job title, department, company, role, whether they are external, whether they are active, and their planned workload per period and whether it is planned in percent or hours. Never sent: e-mail addresses, note logs, a person’s phone number, location, birthday, notes and absence hours, a stakeholder’s notes, influence and interest, and an absence’s type and note. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Forecast import from a spreadsheet | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The sheet you choose, with its name (for a CSV file, the file name without its extension), as a table of its non-empty cells (a sheet too large for one request is not sent), plus your operating guide for the import if you have one. Whatever the sheet holds is sent: usually people’s names and planned hours, and their e-mail addresses and hourly rates when the sheet has them. No other project data. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Insight recommendation, on request | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The project name, today’s date, the insight’s type, severity and figures, the titles of up to 30 tasks, the names of up to 30 people (active resources and assignees of open tasks), and the item the insight is about: a milestone with its description, a RAID item with its owner and mitigation, or a person’s job title, department and company. For a working-time insight from Timelog the figures are about one person: their name and Timelog user number, on how many days a single entry or a day’s total went over a limit, they logged more than their defined hours, they logged time on a non-working day or on a day they were absent (vacation, sick or training), or time in a closed month was changed, with the worst hours, the limit where there is one and, for a closed month, the net change, and the first and last dates concerned. Also who is absent from today to 28 days ahead: each person’s name (with their number in the resource directory when they are in it) and the days they are away, not the type or reason of the absence, and your operating guide for recommendations if you have one. No e-mail addresses and no resource notes. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Analyze next actions with AI | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The project name, today’s date, the project mode and enabled modules, planned, actual and forecast budget, the next-actions queue (titles and reasons), open tasks (title, status, priority, assignee, due date), active RAID items (category, severity, status, owner, target date, date last changed), milestones, pending changes, stakeholder names with their title, organisation or category, and who is absent from today to 28 days ahead: each person’s name (with their number in the resource directory when they are in it) and the days they are away, not the type or reason of the absence; plus your operating guide for analyses if you have one. No descriptions, notes or e-mail addresses. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Allocation plan proposal | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Your request, your operating guide if you have one, the plan window and periods, the workday length and the plan currency, and for each person in the resource directory: their name (or their number in the resource directory if no name is set), role, whether they are external, whether their workload is planned in percent or in hours, their planned and available hours per period, and for an internal person with a role the internal hourly rate of that role. Absences are used to work out available hours and are not sent. Also up to 150 open tasks, each with its title, owner (a name where the owner is not one of the people listed), remaining estimate, start and due dates, status, whether it is synced from Jira, the open tasks it waits for, its milestones and its hours per period; up to 40 milestones with their name, date and whether they are achieved; and which of the listed people are responsible or accountable for each milestone. When the project shares a Turso database with other projects and a person here is matched to a person in another project that does not protect its people from the AI, it also sends that project's name, the hours booked for that person there per period, and their open-task count and remaining hours there (no task titles). The names of other projects that could not be read, or that were left out because they protect their people, are sent too. | Not available: the feature is hidden while protection is on. Where it is available, other projects that protect their people are left out of the hours counted from them. |
| RACI suggestion | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Stakeholder names, titles, organisations, categories, influence and interest; milestone names, dates and descriptions; the existing RACI assignments; and your operating guide if you have one. No e-mail addresses. | Not available: the feature is hidden while protection is on. |
| Duplicate task check | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | For each task: its number, status, due date, title, assignee and the first 200 characters of its description, plus your operating guide if you have one. No e-mail addresses or note logs. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Work breakdown (WBS) proposal | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Your instruction, your operating guide if you have one, the project name and window, groups, milestones, for each task: name, group, status, start and due dates, estimate, dependencies, assignee and a shortened description; and who is absent in the project window (from today, or the project start if that is later, to the project end; the next 28 days from today when the project has no end date, or its end date is before today or before the project start): each person’s name (with their number in the resource directory when they are in it) and the days they are away, not the type or reason of the absence. No e-mail addresses or note logs. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Next-actions weight suggestion | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The project name, the titles of tasks, RAID items, milestones and changes, the next-actions queue, your current weights and learning counts, a trend summary, and stakeholder names, plus your operating guide for weight suggestions if you have one. No descriptions, notes or e-mail addresses. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| New project proposal (project wizard) | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Only what you give the wizard: the brief you type, the files you attach (an e-mail with its body and its sender and recipient names and addresses), and the SharePoint files and Confluence pages you pick, plus your operating guide if you have one. No data from existing projects. | Email addresses, phone numbers and IBANs are always replaced by placeholders. Names cannot be: a new project has no known people yet, so names in your brief and in files you add to the wizard are sent. Images and scanned or PDF documents are sent too, unless your organisation forces protection; then they are refused. The AI’s proposal is applied without any people: no sponsor, project manager, stakeholders, resources, assignees or owners. |
| Speech-to-text dictation | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | When you choose a speech-to-text service, the audio you record and that service’s API key go through this app’s own server route to the speech service you configured, not to Anthropic. Without this consent, while AI is switched off, or while that service’s address or key is missing or cannot be read on this device, dictation with that service is unavailable; it never switches to another engine on its own. Only when you choose browser dictation instead, or this deployment has switched speech-to-text off, does it use the browser’s built-in speech recognition, which in some browsers sends audio to the browser maker’s service. | Not available: the feature is switched off while protection is on. |
| Scheduled job analysis | Asked separately on each device, and only counts together with the interactive consent; asked again on the same changes | The job’s instruction and, for the project it covers, the same summary as “Analyze next actions with AI”: the project name, today’s date, the project mode and enabled modules, planned, actual and forecast budget, the next-actions queue (titles and reasons), open tasks (title, status, priority, assignee, due date), active RAID items (category, severity, status, owner, target date, date last changed), milestones, pending changes, stakeholder names with their title, organisation or category, and who is absent from today to 28 days ahead: each person’s name (with their number in the resource directory when they are in it) and the days they are away, not the type or reason of the absence; plus your operating guide for analyses if you have one. No descriptions, notes or e-mail addresses. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Automatic insight recommendations | Asked separately on each device, and only counts together with the interactive consent; asked again on the same changes | The project name, today’s date, the insight’s type, severity and figures, the titles of up to 30 tasks, the names of up to 30 people (active resources and assignees of open tasks), and the item the insight is about: a milestone with its description, a RAID item with its owner and mitigation, or a person’s job title, department and company. For a working-time insight from Timelog the figures are about one person: their name and Timelog user number, on how many days a single entry or a day’s total went over a limit, they logged more than their defined hours, they logged time on a non-working day or on a day they were absent (vacation, sick or training), or time in a closed month was changed, with the worst hours, the limit where there is one and, for a closed month, the net change, and the first and last dates concerned. Also who is absent from today to 28 days ahead: each person’s name (with their number in the resource directory when they are in it) and the days they are away, not the type or reason of the absence, and your operating guide for recommendations if you have one. No e-mail addresses and no resource notes. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
<!-- PACK:ai-paths-people:END -->

## AI features and the data they send

Every AI feature of the app, with the consent it needs, what it sends, and what people protection does.
It is generated from the same table the app's consent dialog shows. [verified: `src/app/ai-disclosure.ts`]
What each feature may change without a person approving it is listed in the
[works council annex](works-council-annex.md#what-the-ai-may-do-without-a-person-approving-it).

<!-- PACK:ai-paths:BEGIN -->
| Feature | Consent | What is sent | With people protection on |
|---|---|---|---|
| AI Assistant chat | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Your messages; the files and e-mails you attach (an e-mail with its body and its sender and recipient names and addresses); your operating guides; and the project data the assistant reads to answer: tasks with their descriptions and note logs, milestones, RAID items, changes, stakeholders, people in the resource directory, absences (only as “absent”, with the person and the dates), budget figures, calendar events, documents and project details, and, when it searches them, the activity history and your other chats in this project. With every message it also gets the number of your other chats in this project and the titles and last-activity times of up to three of the most recent ones (an unnamed chat is titled with the start of its first message; chats are kept only with a Turso database), and the project’s open insights: up to ten current ones and up to five you acted on with their measured result, one line each. An insight from Timelog names one person (or their Timelog user number when no one in the resource directory is linked) with their logged working time: on how many days a single entry or a day’s total went over a limit, they logged more than their defined hours, they logged time on a non-working day or on a day they were absent (vacation, sick or training), or time in a closed month was changed, with the worst hours, the limit where there is one, and for a closed month the net change. People’s names are included. List results carry no e-mail addresses: the assistant reads one address at a time, only when it needs it, though addresses can still appear in attachments, documents and logged edits. The whole conversation is sent again with every new message. Saved chats are encrypted so that only the person who wrote them and the operator holding the recovery key can read them, and each is deleted when the retention period has passed since its last change (30 days unless the operator sets another). Exceptions: chats saved by an earlier version of the app, which others in the project can read until they expire, and the AI gateway’s own logs where your organisation uses one. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending, and the assistant cannot assign, move or rate anyone. Images and PDFs are refused while protection is on. Names the project does not know, typed into free text or contained in text attachments, may still be sent. |
| Inline AI edit on a row | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Your instruction, the one row you edit and a short project context (today’s date, task count, groups and labels, and the same open-insight lines the chat gets, so a Timelog insight can name a person with their logged working time), plus your operating guide for inline edits if you have one. The row includes names, dates and descriptions, and for a task its blocker log with the name of whoever logged each entry; for a person in the resource directory their name, job title, department, company, role, whether they are external, whether they are active, and their planned workload per period and whether it is planned in percent or hours. Never sent: e-mail addresses, note logs, a person’s phone number, location, birthday, notes and absence hours, a stakeholder’s notes, influence and interest, and an absence’s type and note. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Steering committee report draft | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The meeting agenda you typed, your operating guide for this report if you have one, a status summary: overall status (RAG), task counts, overdue and due-soon counts, RAID and change counts, up to five change titles, and the names and dates of overdue, at-risk and due-soon milestones; and who is absent from today to 28 days ahead: each person’s name (with their number in the resource directory when they are in it) and the days they are away, not the type or reason of the absence. No e-mail addresses, and no other people’s names unless they are in a title or the agenda. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Digest summary, on request | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Overall status (RAG), the number of overdue tasks, the numbers of open and high-severity RAID items, and the names and dates of milestones due soon, plus your operating guide for the digest if you have one. No people’s names, notes or e-mail addresses, unless they are in a milestone name. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Forecast import from a spreadsheet | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The sheet you choose, with its name (for a CSV file, the file name without its extension), as a table of its non-empty cells (a sheet too large for one request is not sent), plus your operating guide for the import if you have one. Whatever the sheet holds is sent: usually people’s names and planned hours, and their e-mail addresses and hourly rates when the sheet has them. No other project data. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Insight recommendation, on request | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The project name, today’s date, the insight’s type, severity and figures, the titles of up to 30 tasks, the names of up to 30 people (active resources and assignees of open tasks), and the item the insight is about: a milestone with its description, a RAID item with its owner and mitigation, or a person’s job title, department and company. For a working-time insight from Timelog the figures are about one person: their name and Timelog user number, on how many days a single entry or a day’s total went over a limit, they logged more than their defined hours, they logged time on a non-working day or on a day they were absent (vacation, sick or training), or time in a closed month was changed, with the worst hours, the limit where there is one and, for a closed month, the net change, and the first and last dates concerned. Also who is absent from today to 28 days ahead: each person’s name (with their number in the resource directory when they are in it) and the days they are away, not the type or reason of the absence, and your operating guide for recommendations if you have one. No e-mail addresses and no resource notes. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Analyze next actions with AI | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The project name, today’s date, the project mode and enabled modules, planned, actual and forecast budget, the next-actions queue (titles and reasons), open tasks (title, status, priority, assignee, due date), active RAID items (category, severity, status, owner, target date, date last changed), milestones, pending changes, stakeholder names with their title, organisation or category, and who is absent from today to 28 days ahead: each person’s name (with their number in the resource directory when they are in it) and the days they are away, not the type or reason of the absence; plus your operating guide for analyses if you have one. No descriptions, notes or e-mail addresses. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Allocation plan proposal | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Your request, your operating guide if you have one, the plan window and periods, the workday length and the plan currency, and for each person in the resource directory: their name (or their number in the resource directory if no name is set), role, whether they are external, whether their workload is planned in percent or in hours, their planned and available hours per period, and for an internal person with a role the internal hourly rate of that role. Absences are used to work out available hours and are not sent. Also up to 150 open tasks, each with its title, owner (a name where the owner is not one of the people listed), remaining estimate, start and due dates, status, whether it is synced from Jira, the open tasks it waits for, its milestones and its hours per period; up to 40 milestones with their name, date and whether they are achieved; and which of the listed people are responsible or accountable for each milestone. When the project shares a Turso database with other projects and a person here is matched to a person in another project that does not protect its people from the AI, it also sends that project's name, the hours booked for that person there per period, and their open-task count and remaining hours there (no task titles). The names of other projects that could not be read, or that were left out because they protect their people, are sent too. | Not available: the feature is hidden while protection is on. Where it is available, other projects that protect their people are left out of the hours counted from them. |
| RACI suggestion | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Stakeholder names, titles, organisations, categories, influence and interest; milestone names, dates and descriptions; the existing RACI assignments; and your operating guide if you have one. No e-mail addresses. | Not available: the feature is hidden while protection is on. |
| Duplicate task check | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | For each task: its number, status, due date, title, assignee and the first 200 characters of its description, plus your operating guide if you have one. No e-mail addresses or note logs. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Work breakdown (WBS) proposal | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Your instruction, your operating guide if you have one, the project name and window, groups, milestones, for each task: name, group, status, start and due dates, estimate, dependencies, assignee and a shortened description; and who is absent in the project window (from today, or the project start if that is later, to the project end; the next 28 days from today when the project has no end date, or its end date is before today or before the project start): each person’s name (with their number in the resource directory when they are in it) and the days they are away, not the type or reason of the absence. No e-mail addresses or note logs. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Next-actions weight suggestion | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | The project name, the titles of tasks, RAID items, milestones and changes, the next-actions queue, your current weights and learning counts, a trend summary, and stakeholder names, plus your operating guide for weight suggestions if you have one. No descriptions, notes or e-mail addresses. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| New project proposal (project wizard) | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | Only what you give the wizard: the brief you type, the files you attach (an e-mail with its body and its sender and recipient names and addresses), and the SharePoint files and Confluence pages you pick, plus your operating guide if you have one. No data from existing projects. | Email addresses, phone numbers and IBANs are always replaced by placeholders. Names cannot be: a new project has no known people yet, so names in your brief and in files you add to the wizard are sent. Images and scanned or PDF documents are sent too, unless your organisation forces protection; then they are refused. The AI’s proposal is applied without any people: no sponsor, project manager, stakeholders, resources, assignees or owners. |
| Speech-to-text dictation | Asked on each device before the first use, and again when the disclosure, the AI route or the key restriction changes | When you choose a speech-to-text service, the audio you record and that service’s API key go through this app’s own server route to the speech service you configured, not to Anthropic. Without this consent, while AI is switched off, or while that service’s address or key is missing or cannot be read on this device, dictation with that service is unavailable; it never switches to another engine on its own. Only when you choose browser dictation instead, or this deployment has switched speech-to-text off, does it use the browser’s built-in speech recognition, which in some browsers sends audio to the browser maker’s service. | Not available: the feature is switched off while protection is on. |
| Scheduled job analysis | Asked separately on each device, and only counts together with the interactive consent; asked again on the same changes | The job’s instruction and, for the project it covers, the same summary as “Analyze next actions with AI”: the project name, today’s date, the project mode and enabled modules, planned, actual and forecast budget, the next-actions queue (titles and reasons), open tasks (title, status, priority, assignee, due date), active RAID items (category, severity, status, owner, target date, date last changed), milestones, pending changes, stakeholder names with their title, organisation or category, and who is absent from today to 28 days ahead: each person’s name (with their number in the resource directory when they are in it) and the days they are away, not the type or reason of the absence; plus your operating guide for analyses if you have one. No descriptions, notes or e-mail addresses. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Automatic insight recommendations | Asked separately on each device, and only counts together with the interactive consent; asked again on the same changes | The project name, today’s date, the insight’s type, severity and figures, the titles of up to 30 tasks, the names of up to 30 people (active resources and assignees of open tasks), and the item the insight is about: a milestone with its description, a RAID item with its owner and mitigation, or a person’s job title, department and company. For a working-time insight from Timelog the figures are about one person: their name and Timelog user number, on how many days a single entry or a day’s total went over a limit, they logged more than their defined hours, they logged time on a non-working day or on a day they were absent (vacation, sick or training), or time in a closed month was changed, with the worst hours, the limit where there is one and, for a closed month, the net change, and the first and last dates concerned. Also who is absent from today to 28 days ahead: each person’s name (with their number in the resource directory when they are in it) and the days they are away, not the type or reason of the absence, and your operating guide for recommendations if you have one. No e-mail addresses and no resource notes. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
| Digest summary, scheduled | Asked separately on each device, and only counts together with the interactive consent; asked again on the same changes | Overall status (RAG), the number of overdue tasks, the numbers of open and high-severity RAID items, and the names and dates of milestones due soon, plus your operating guide for the digest if you have one. No people’s names, notes or e-mail addresses, unless they are in a milestone name. | The names, email addresses and phone numbers of people the project knows are replaced by placeholders before sending. Names the project does not know, typed into free text or contained in attachments, may still be sent. |
<!-- PACK:ai-paths:END -->

## What a deployer would owe from 2 December 2027

The obligations for high-risk systems (Chapter III, Sections 1 to 3) were to apply from 2 August 2026 under
the original text. Regulation (EU) 2026/1744 moved them to 2 December 2027 for systems classified as
high-risk under Art 6(2) and Annex III, and to 2 August 2028 for systems under Art 6(1) and Annex I.
[external: Regulation (EU) 2024/1689, Art 113, and Regulation (EU) 2026/1744, the replaced Art 113 third
paragraph point (c), both read 2026-11-13 as above]

If your organisation classifies the allocation or RACI suggestions as high-risk, the deployer duties of
Art 26 would apply to it from that date. In summary: [external: Regulation (EU) 2024/1689, Art 26, read
2026-11-13 as above]

- use the system according to the provider's instructions for use, with appropriate technical and
  organisational measures (Art 26(1));
- assign human oversight to people with the necessary competence, training, authority and support
  (Art 26(2));
- where it controls the input data, make sure the data is relevant and sufficiently representative for the
  intended purpose (Art 26(4));
- monitor the system's operation, inform the provider and the market surveillance authority of risks and
  serious incidents, and suspend use where the system presents a risk (Art 26(5));
- keep the logs the system generates automatically, as far as they are under its control, for a period
  appropriate to the purpose and of at least six months unless other law provides otherwise (Art 26(6));
- before using it at the workplace, inform the workers' representatives and the affected workers
  (Art 26(7));
- if it is a public authority, meet the registration duties (Art 26(8));
- use the provider's information when carrying out a data protection impact assessment (Art 26(9)).

People affected by a decision taken on the basis of a high-risk Annex III system's output that produces
legal effects or similarly significantly affects them would have a right to an explanation from the
deployer (Art 86). [external: Regulation (EU) 2024/1689, Art 86(1), read 2026-11-13 as above] The
fundamental rights impact assessment of Art 27 is required of deployers that are bodies governed by public
law or private entities providing public services, and of deployers of the systems in Annex III points
5(b) and (c). [external: Regulation (EU) 2024/1689, Art 27(1), read 2026-11-13 as above] Whether it applies
to you is for you to check. [question for you]

What the app offers towards these duties today, and where it falls short: [verified as named; the
assessment of whether it is enough: question for you]

- **Instructions for use.** There are none in the form the Act sets for high-risk systems. This pack, the
  Help in the app and `docs/security.md` describe the app. [vendor statement]
- **Human oversight.** Allocation and RACI proposals are applied by a person, change by change.
  [verified: `src/app/alloc-plan-modal.tsx`, `src/app/raci-suggest-modal.tsx`] A single chat change can
  apply without review (§794). [verified: the register entry §794]
- **Logs.** The activity log keeps the newest 500 entries per project, a count rather than a period, and
  does not link an AI change to the chat message that caused it (§799). Saved AI chats are deleted after
  the retention period the operator sets: 30 days by default, at most 3650. Whether either covers six
  months depends on how busy the project is and on the period you set. [verified: `ACTIVITY_MAX_ENTRIES` in `src/app/activity-log.ts`,
  `src/app/ai-chat-retention-config.ts`]
- **Switching off.** An operator can force the two features off with `ai-people`, or all AI off with `ai`.
  [verified: `src/app/deployment-variables.ts`]
- **Provider duties.** If the features were high-risk, the provider's obligations (conformity assessment,
  technical documentation, registration) would fall to whoever is their provider; the maintainer has
  fulfilled none of them (see [Roles](#roles)). [vendor statement]

Independently of any classification, providers and deployers must take measures to support the AI
literacy of their staff and others who operate or use AI systems on their behalf (Art 4, as replaced by
Regulation (EU) 2026/1744). [external: Regulation (EU) 2026/1744, the replaced Art 4, read 2026-11-13 as
above] The [AI literacy](ai-literacy.md) material is a starting point for that. [question for you]
