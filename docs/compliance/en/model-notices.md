# Model notices

## About this document

Two templates for telling people that your organisation uses AI PM Cockpit and its AI features: one for
staff, one for external people who appear in your projects, such as steering-committee members, customer
contacts and suppliers' staff. They are for the data protection officer, who adapts them, and they end up
in front of the people concerned. The hand-written text was last reviewed as the README's
[review line](README.md#text-last-reviewed) states.

These templates are input for your own work. They are not legal advice, and they are not complete until you
have filled every placeholder and removed what does not apply. [question for you]

A notice to people whose data you collect from them must give, among other things, the controller's
identity and contact details, the data protection officer's contact details, the purposes and legal basis,
the recipients, any transfer to a third country with its safeguard, the storage period, the person's
rights, and the existence of automated decision-making (GDPR Art 13). Where the data comes from elsewhere,
the notice must also give the categories of data and their source, and be given within a reasonable period
and at the latest within one month, or at the first communication with the person (Art 14). [external:
Regulation (EU) 2016/679, Art 13 and Art 14, Official Journal L 119 of 4 May 2016, read from the EU
Publications Office at http://publications.europa.eu/resource/cellar/3e485e15-11bd-11e6-ba9a-01aa75ed71a1
on 2026-11-13] Both templates follow that order. Which article applies to which person is for you to decide.
[question for you]

**How to fill them in.** Text in square brackets is yours to replace: `[Organisation]` is your
organisation's name, and the others say what belongs there. Statements in the templates about what the app
does are taken from the table at the end of this document and from the other documents of this pack, and
are verified there; the notes after each template name the source. Keep them in line with the table when
you switch features on or off. [verified: `src/app/ai-disclosure.ts`; the sources named in the notes]

## Notice for staff

> **How [Organisation] uses AI in project management**
>
> **Who is responsible.** [Organisation], [address], is responsible for the processing described here.
> You can reach our data protection officer at [contact details].
>
> **What we use, and why.** We manage projects with AI PM Cockpit, a project management tool. We use it
> for [purposes, for example planning tasks and resources and reporting project status]. The legal basis
> is [legal basis]. [Where you rely on legitimate interests: Our legitimate interest is [interest].]
>
> **What data about you is in it.** Depending on your role in a project: your name, [job title,
> department, company, role,] the tasks and risks assigned to you, your planned workload per period,
> [your absences with their type (vacation, sick, training or other),] [your logged working time from
> Timelog and the checks we run on it,] and what colleagues write about the work in tasks, notes and
> documents. The tool records changes in an activity log that shows what changed and whether a person,
> the AI or an integration changed it, but not which person. [Notes and blocker entries record their
> author's name and the time when the writer has set in the tool which person they are.]
>
> **AI functions.** We have switched on these AI functions: [list them from the table below]. When a
> colleague uses one of them, the data that function needs is sent to [Anthropic contracting entity, as
> named in your contract with Anthropic] [, through our AI gateway run by [operator]]. The table below
> lists, per function, what is sent. [People protection is on in all our projects: before data is sent,
> the names, e-mail addresses and phone numbers of people the project knows are replaced by placeholders,
> the AI cannot assign work to anyone, and the functions that plan staff allocation and suggest RACI roles
> are unavailable. Names written into free text or attached files can still be sent.] [Or, where
> protection is off in some projects: In [projects], the AI also sees your name and may propose how work is
> allocated to you.]
>
> **AI running in the background.** [Delete if not used.] [Scheduled analyses, automatic insight
> recommendations and the scheduled digest summary] send project data to the AI on a schedule, without a
> person starting each run.
>
> **Who decides.** The AI proposes; a person reviews and applies its proposals. One exception: a single
> change the AI chat makes can apply at once, without a review step; it is recorded as the AI's change.
> [We do not take decisions about you based solely on AI output. / Describe any such decision.]
>
> **Recipients.** [Anthropic, as our processor, for the AI functions.] [Microsoft 365, Turso, Atlassian,
> Timelog, a speech-to-text service: list those you use, with their role.]
>
> **Transfers outside the EU.** AI requests are processed in the United States or in another region
> Anthropic uses, depending on our settings with Anthropic: [our setting]. [And where our AI gateway runs:
> [location].] The safeguard is [for example
> the Standard Contractual Clauses in our data processing agreement with Anthropic].
>
> **How long we keep data.** Project data: [your retention period]. Saved AI chats: [number] days after
> their last change. Requests sent to Anthropic: [period from your contract or Anthropic's current terms].
>
> **Your rights.** You can ask us for access to your data, its correction or erasure, a restriction of
> its processing, and to receive it in a portable form, and you can object to its processing. [Where we
> rely on consent: You can withdraw your consent at any time.] You can complain to [supervisory
> authority].
>
> **Works agreement.** [Reference to the works agreement, or delete.]
>
> **Questions.** [Contact.]

Notes for the staff notice: [verified as named]

- The activity log sentence: `ActivityActor` in `src/app/activity-log.ts`.
- The notes and blocker sentence: `NoteLogEntry` and `BlockerEntry` in `src/app/types.ts`, and
  `selfResourceId` in `src/app/settings-types.ts` (set per device).
- The people protection sentence: `src/app/ai-people-protection.ts`, `src/app/ai-person-fields.ts`, and the
  last column of the table below. Protection is on by default per project; check whether a project has
  turned it off, or force it on with `AIPM_DISABLED_INTEGRATIONS=ai-people` (`src/app/deployment-variables.ts`).
- The background sentence: the three rows of the table below whose consent is "asked separately"
  (`level: "background"` in `src/app/ai-disclosure.ts`); register §795.
- The "one exception" sentence: `shouldStage` in `src/app/chat-proposal.ts`; register §794. Other
  conditions also bring a chat change to review; the [works council annex](works-council-annex.md#what-the-ai-may-do-without-a-person-approving-it)
  lists them.
- The transfer sentence: the DPIA input, [Transfers outside the EU](dpia-input.md#transfers-outside-the-eu),
  where the Anthropic statements are labelled with their source and date.
- The chat retention: `AIPM_AI_CHAT_RETENTION_DAYS`, 30 days when unset (`src/app/ai-chat-retention-config.ts`).

## Notice for external stakeholders

> **How [Organisation] processes your data in its project management**
>
> **Who is responsible.** [Organisation], [address], is responsible for the processing described here.
> You can reach our data protection officer at [contact details].
>
> **Why we hold your data.** You are [a member of the steering committee / a contact / a stakeholder] in
> our project [project]. We record you in our project management tool, AI PM Cockpit, to [purposes, for
> example plan the project's communication and decisions]. The legal basis is [legal basis]. [Where you
> rely on legitimate interests: Our legitimate interest is [interest].]
>
> **What data we hold and where it comes from.** Your name, organisation, title, e-mail address,
> [your category as a stakeholder, our assessment of your influence on and interest in the project, your
> role per milestone (responsible, accountable, consulted or informed), our notes,] [e-mails you sent us,
> where we attach them to the tool]. We received it [from you / from [source]].
>
> **AI functions.** Some functions of the tool use AI. When a colleague uses one, the data that function
> needs can be sent to [Anthropic contracting entity, as named in your contract with Anthropic]. For you,
> that can be your name, title, organisation, category, [our influence and interest assessment,] [your
> role per milestone (responsible, accountable, consulted or informed),] the other details we hold about
> you in the tool, your e-mail address (the AI assistant can look it up, one address at a time), and the
> content, senders and recipients of e-mails of yours that we attach. [People protection is on in all our projects: before
> data is sent, the names, e-mail addresses and phone numbers of people the project knows are replaced by
> placeholders. Names in free text or attached e-mails can still be sent.]
>
> **Who decides.** The AI proposes; our staff review and apply its proposals. One exception: a single
> change the AI chat makes can apply at once, without a review step; it is recorded as the AI's change.
> [We do not take decisions about you based solely on AI output.]
>
> **Recipients.** [Anthropic, as our processor, for the AI functions.] [Others you use.]
>
> **Transfers outside the EU.** AI requests are processed in the United States or in another region
> Anthropic uses, depending on our settings with Anthropic: [our setting]. [And where our AI gateway runs:
> [location].] The safeguard is [safeguard].
>
> **How long we keep data.** [Your retention period, for example until the end of the project plus
> [period].]
>
> **Your rights.** You can ask us for access to your data, its correction or erasure, a restriction of
> its processing, and to receive it in a portable form, and you can object to its processing. You can
> complain to [supervisory authority].
>
> **Questions.** [Contact.]

Notes for the stakeholder notice: [verified as named]

- The data list: `Stakeholder` in `src/app/types.ts` (name, organisation, title, e-mail, category,
  influence, interest, notes and RACI roles). Delete what you do not record.
- The AI sentence: the RACI suggestion sends stakeholders' names, titles, organisations, categories,
  influence and interest, and the existing RACI assignments per milestone; the analysis of next actions
  and the scheduled job analysis send stakeholder names with their title, organisation or category; the
  weight suggestion sends stakeholder names; Plan with AI sends which of the people it lists are the
  responsible or accountable stakeholders of each milestone; the chat can read stakeholder records, look up
  one e-mail address at a time when it needs it, and read attached e-mails with their senders and
  recipients. The sentence must not say less than the table below; check it against the table when you
  fill it in. [verified: the RACI, analysis, scheduled job, Plan with AI, weight suggestion and chat rows of
  `src/app/ai-disclosure.ts`; `raciSection` in `src/app/alloc-plan/alloc-project-digest.ts`;
  `get_contact_email` in `PEOPLE_TOOLS`, `src/app/chat-tool-defs.ts`]
- With people protection on, the RACI suggestion is unavailable and the chat cannot read stakeholder
  records; external people's names in attached e-mails that the project does not know are still sent.
  [verified: `src/app/ai-disclosure.ts`, `PEOPLE_TOOLS` in `src/app/chat-tool-defs.ts`]
- The "one exception" sentence: as for the staff notice (§794).
- When to inform external people (Art 14(3)): within a reasonable period and at the latest within one month
  of obtaining their data; where you use the data to communicate with them, at the latest at your first
  communication. [external: as cited above]

## What the AI features send

The app's own list of every AI feature, what it sends and what people protection changes, generated from
the table the consent dialog shows. Use it to fill in the AI sentences of the notices. [verified:
`src/app/ai-disclosure.ts`]

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
