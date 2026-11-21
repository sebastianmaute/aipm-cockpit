# Compliance pack

## About this pack

This pack is for organisations that want to use AI PM Cockpit and must first do their own review of it.
It is written for four readers: the data protection officer, the works council, the information security
officer and the person responsible for AI. It gives them the facts about the app and the questions they
have to answer. It does not give the answers that only the organisation, or its lawyer, can give.

This pack is input for your own work. It is not legal advice, and it reaches no legal conclusion about
the app or about your use of it.

**Who provides it.** AI PM Cockpit is a free, non-commercial open-source project. The person who
provides this pack is its maintainer, the repository owner named in the README's Code signing section.
There is no contract between the maintainer and you, no service level and no support period. The one
duty the maintainer takes on is to handle vulnerability reports as [`SECURITY.md`](../../../SECURITY.md)
describes: reported privately through GitHub, with a first answer within a week, and fixes only in the
latest release. [vendor statement]

## Text last reviewed

Text last reviewed for version 1.20.1 on 2026-11-13.

This line says when a person last re-read the hand-written text against the app. The tables between
`PACK:` markers are not covered by it: they are generated from the code and checked on every change (see
[How to read the labels](#how-to-read-the-labels)). The pack you read at a release tag of the repository
is the pack for that release. Read at any other commit, it describes the code from that commit on,
which can be ahead of the latest release: behaviour changes listed under "Unreleased" in the
[CHANGELOG](../../../CHANGELOG.md) reach users with the next release.

## Scope

The pack covers the app in this repository at the version you read it in: the web app, its own server
routes, and the Windows desktop app, which runs the same web app on the user's computer. It describes
what the app stores, what it sends where, what an operator can switch on or off, and which known gaps
are still open.

It does not cover:

- the services the app talks to (Anthropic, Microsoft 365, Turso, Atlassian, Timelog, a speech-to-text
  service, an AI gateway). Their terms and their own measures are theirs; where the pack cites them, it
  labels the statement and gives the source.
- the computers, browsers, networks and storage accounts you run the app on.
- your purposes, legal bases, retention decisions and works agreements. Those are yours; the documents
  mark each as a **question for you**.

## Documents

| Document | What it is for | Main readers |
|---|---|---|
| [Vendor touchpoints](vendor-touchpoints.md) | What reaches the maintainer (nothing from the app at runtime), and every host the browser, the server and the desktop app contact | DPO, CISO |
| [Record of processing input](record-of-processing-input.md) | The fields of a record of processing (GDPR Art 30(1)), with the parts the maintainer can supply filled in | DPO |
| [DPIA input](dpia-input.md) | A description of the processing in the structure a data protection impact assessment expects | DPO |
| [Technical and organisational measures](tom-sheet.md) | The app's security measures, each with what it does not cover | CISO, DPO |
| [Works council annex](works-council-annex.md) | Which features record or evaluate staff, and what an operator can switch off | Works council |
| [AI Act readiness](ai-act-readiness.md) | The roles under the EU AI Act as the maintainer reads them, and the open questions | AI officer |
| [Model notices](model-notices.md) | Templates for informing staff and external stakeholders | DPO |
| [AI literacy](ai-literacy.md) | Plain-language material for the people who use the app | Everyone using the AI |

One-page AI briefs per role, which link into these documents, are in [docs/briefs](../../briefs/README.md).

## Open gaps

These are known gaps that are still open. Each is an entry of the project's public register of open
items, [`docs/open-followups.md`](../../open-followups.md). The table is generated from that register,
and the pack's check fails when a listed entry is closed or missing. [verified:
`scripts/compliance/pack-config.mjs` (the cited list), `scripts/check-compliance-pack.mjs` (the check)]

<!-- PACK:open-gaps:BEGIN -->
| Register entry | Title |
|---|---|
| §487 | The Windows installer is unsigned: no signing provider is chosen, so every install shows an unknown-publisher warning |
| §802 | The AI gateway route has never been run against a real gateway |
| §811 | The time the AI features save is not measured |
| §814 | Dictation and voice commands have no recorded cost or observed behaviour from a measured run |
| §815 | AI starter content applied when a project is created writes no activity entry |
<!-- PACK:open-gaps:END -->

What each gap means for you. Each sentence restates its register entry in `docs/open-followups.md`,
which has the detail. [verified: the register entries in `docs/open-followups.md`]

- **§487** — No installer released so far is code-signed, so Windows cannot show you who published it.
  Check each download with the GitHub attestation commands in `SECURITY.md` instead.
- **§802** — Routing AI through an organisation's gateway has been tested against fakes and a local
  server only. How a real gateway behaves with the app has not been confirmed by a run.

Seven limits remain that have no open register entry:

- **Request limits.** The limit on the Jira, Confluence, Timelog, exchange-rate, AI and dictation routes no
  longer trusts a header the caller sets. By default all callers of a route share one count, so one caller
  can use it up for everyone; `AIPM_TRUSTED_PROXY_HOPS`, set behind reverse proxies that append the caller's
  address to `x-forwarded-for`, counts each caller separately. Jira and Confluence share one count. Only the
  AI and dictation limits can be raised; the others are fixed at 60 a minute. The count is kept in each server
  process's memory and starts again from zero when the server restarts. [verified: `clientKey` and
  `rateLimit` in `src/app/api/jira/_rate-limit.ts` and its tests in `_rate-limit.test.ts`; the Confluence
  route's import of the Jira route's helpers in `src/app/api/confluence/page/route.ts`]
- **A placeholder's rate in a saved forecast scenario.** A project, or the deployment with `ai-rates`, can
  keep hourly rates out of Plan with AI and the chat's forecast and dashboard figures (the dashboard figures then
  carry no planned or booked rate average); the forecast then leaves out the role rate of a
  person from the directory that a scenario or what-if adds. A saved scenario's own changes are still sent as
  stored, so a placeholder's rate (a figure entered for the scenario, or the team's mean internal rate when it
  was drafted from the Forecast view's Explore) still reaches the AI. [verified: `buildForecastReport` in
  `src/app/forecast-ai-report.ts`; `placeholderWho` in `src/app/forecast-levers.ts`]
- **Forecast cost figures with rates withheld.** The chat's forecast still reports each scenario's and
  what-if's cost at finish (P50, P80, P95) beside As is, and the sizing of a person it adds keeps their weekly
  hours. From the difference and those hours the model could roughly work out that person's rate, although
  the rate itself is left out. [verified: `buildForecastReport` in `src/app/forecast-ai-report.ts`]
- **Forecast what-if with a hidden Resources function.** While a project hides Resources, a forecast what-if that names a directory person by id still reports, without the name, the internal hourly rate of their role (unless the rates switch is on), whether they are external or have no rate, whether they are already on the team or gone from the directory, and forecast figures (dates, chances, cost) shaped by their shift and their absences.
  [verified: `directorySizing` and `resolveAddedPeople` in `src/app/forecast-added-people.ts`; `buildForecastReport` in
  `src/app/forecast-ai-report.ts`]
- **A hidden Resources function.** While a project hides it, the AI is offered none of that function's tools
  (the resource directory, absences, allocations and contact e-mail look-ups), no prompt lists who is away, and
  insight recommendations name only people already assigned to open tasks. No AI feature is sent an insight
  about one person (a Timelog check names a directory person or their Timelog user number), and the chat's
  forecast results report a person from the directory that a scenario or what-if adds without their name. The
  stakeholder tools follow the
  Stakeholders function instead; history search, chat search, the status inquiry and RAID escalation stay
  available. A chat date change that lands on someone's absence is still
  held on the review card, so the AI can tell that the change was held, but learns nothing about who is away
  or when. Hiding the function does not take people's names out of tasks and other records; people
  protection does that. [verified: `toolWithheldBy` in `src/app/chat-tool-defs.ts`;
  `buildAiAwaySummary` in `src/app/absence-clash.ts`; `src/app/chat-panel.absence-clash.test.tsx`]
- **Pausing background AI.** A project, or the deployment with `ai-background`, can pause the three background AI
  runs (the scheduled job analysis, the automatic insight recommendations and the scheduled digest summary); AI a
  person starts is not affected, and the pause does not withdraw anyone's background consent. The app enforces it
  in the browser, so a modified client could bypass it; no server route refuses. A client that has not been
  upgraded drops the project's setting when it saves a shared project, and also ignores the `ai-background` id (its parser drops the unknown id), so the deployment id protects fully only once every client is upgraded. A scheduled job decides from its own project, so a paused project's job is tried at most once an hour on
  each device and then stops without a report or anything sent to the AI; the scheduled-jobs settings say that a
  job does not run while its project is paused, not which project is. On the device where the switch is turned
  on, the jobs of the open project pause at once, before the save lands; other devices follow once it is saved. Background AI on the open project is also paused until the app has loaded a project, and when the switch is turned back off that device tries the jobs again at the next check and other devices within an hour.
  A run that does start still sends what it always sent, and no one approves it first. [verified:
  `assertBackgroundConsentLive` in `src/app/ai-consent.ts`; `backgroundOff` in `src/app/settings-overrides.ts`]

- **Marking of AI text is partial.** A project document an AI tool wrote or changed carries a stored mark, and its
  downloads carry it: a Word or PowerPoint file has the property `DigitalSourceType` and a description holding the
  IPTC digital source type URI, an HTML file has a `digital-source-type` meta tag, and each says "Contains
  AI-generated content." in its visible text. A PDF is the printed HTML and carries only that line. A digest
  e-mail with the AI summary has the header `X-AI-Generated` and the same line. Nothing else is marked: text copied
  out of the app, tasks, report text, chat replies, the workspace exports, other e-mails and documents the AI wrote
  before this release. A client that has not been upgraded drops the mark when it saves a shared project. A person
  can remove the mark, and the app does not check whether AI text remains. [verified: `aiGenerated` in
  `src/app/document-model.ts`; `applyDocMutation` in `src/app/document-mutations.ts`; `AI_SOURCE_TYPE_URI` in
  `src/app/ai-content-mark.ts`; `src/app/ooxml-ai-mark.ts`; `src/app/doc-render-html.ts`; `buildGraphMessage` in
  `src/app/graph-mail.ts`]

## How to read the labels

Every statement of fact in the hand-written text carries one of four labels:

- **[verified: `file`]** — checked against the code or a test in this repository; the label names the
  file or the test. If you doubt it, read that file at the release tag you use.
- **[vendor statement]** — the maintainer's own word, for example what he does with reports. Nothing in
  the code proves it.
- **[external: source, date read]** — a third party's published terms or documentation, with the address
  and the date the maintainer read it. The third party can change it; re-read it before you rely on it.
- **[question for you]** — something only your organisation can answer.

A label at the end of a paragraph covers every statement in that paragraph. The generated tables, each
framed by a pair of `PACK:` comment markers, carry no label per row. They are verified as a
whole: a script renders them from the code (`src/proxy.ts`, `src/app/outbound-destinations.ts`,
`src/app/deployment-variables.ts`, `src/app/ai-disclosure.ts` and the register), and the test
`src/app/compliance/pack-drift.test.ts` fails when a table differs from what the code would render.
[verified: `src/app/compliance/pack-drift.test.ts`]
