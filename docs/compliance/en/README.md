# Compliance pack

## About this pack

This pack is for organisations that want to use AI PM Cockpit and must first do their own review of it.
It is written for four readers: the data protection officer, the works council, the information security
officer and the person responsible for AI. It gives them the facts about the app and the questions they
have to answer. It does not give the answers that only the organisation, or its lawyer, can give.

This pack is input for your own work. It is not legal advice, and it reaches no legal conclusion about
the app or about your use of it.

**Who provides it.** AI PM Cockpit is a free, non-commercial open-source project. The person who
provides this pack is its maintainer, the repository owner named in the README's code signing policy.
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

## Open gaps

These are known gaps that are still open. Each is an entry of the project's public register of open
items, [`docs/open-followups.md`](../../open-followups.md). The table is generated from that register,
and the pack's check fails when a listed entry is closed or missing. [verified:
`scripts/compliance/pack-config.mjs` (the cited list), `scripts/check-compliance-pack.mjs` (the check)]

<!-- PACK:open-gaps:BEGIN -->
| Register entry | Title |
|---|---|
| §487 | The Windows installer is still unsigned: the signing pipeline exists but is switched off, so every install shows an unknown-publisher warning |
| §562 | The shared proxy rate limiter is bypassable by a client-supplied header, and its store is in-memory |
| §793 | The installer's uninstaller is not code-signed |
| §794 | A single AI chat write applies without the review card |
| §795 | Background AI runs are consented once, not approved run by run |
| §796 | Tasks created by Plan with AI's work breakdown cannot be undone |
| §797 | External text that the chat's tools read does not trigger the review hold |
| §798 | Most AI requests have no client time limit, and none is retried on a rate limit or overload |
| §799 | An activity entry written by the AI does not link to the chat message that caused it |
| §800 | The Content Security Policy allows whole host families by wildcard |
| §801 | Text the AI writes carries no machine-readable marking |
| §802 | The AI gateway route has never been run against a real gateway |
| §804 | Plan with AI always sends internal hourly rates; there is no option to leave them out |
| §810 | Hiding a project's Resources function keeps neither the chat's people tools nor the absence list from the AI |
<!-- PACK:open-gaps:END -->

What each gap means for you. Each sentence restates its register entry in `docs/open-followups.md`,
which has the detail. [verified: the register entries in `docs/open-followups.md`]

- **§487** — No installer released so far is code-signed, so Windows cannot show you who published it.
  Check each download with the GitHub attestation commands in `SECURITY.md` instead.
- **§562** — The request limit on the Jira, Confluence, Timelog, exchange-rate, AI and dictation routes
  can be avoided by a caller who sets a forwarding header, and it starts again from zero when the server
  restarts.
- **§793** — Even once signing is switched on, the uninstaller that setup puts on the computer will not be
  signed, so a tool that checks every program on the machine will flag it.
- **§794** — When the AI chat makes exactly one change and none of the conditions that force a review
  applies, the change is made at once, without a review card. It is logged as the AI's, and most such
  changes can be undone, but no person approved it first.
- **§795** — The three background AI features send project data on every run under one consent given in
  advance. Nobody approves each run.
- **§796** — After a person applies an AI work breakdown, undo reverts the changes to existing tasks but
  not the tasks it created. Those must be deleted by hand.
- **§797** — The chat holds its proposed changes for review when a file is attached, but not when it has
  read outside text through its tools (for example content synced from Jira), although such text could
  carry instructions too.
- **§798** — Most AI requests wait until the user cancels or the connection fails, and a request refused
  because the service is busy is not tried again. Users see a failure or a long wait.
- **§799** — The activity log shows that the AI changed something and what changed, but not which chat
  message asked for it. A reviewer cannot trace an AI change back to its request from the log.
- **§800** — The browser's security policy allows any Turso database, any SharePoint or OneDrive file host
  and any local port, not only the ones your deployment uses.
- **§801** — Text the AI writes into tasks, documents and exports carries no marker a machine can read.
  Once copied or exported, it cannot be told apart from text a person wrote.
- **§802** — Routing AI through an organisation's gateway has been tested against fakes and a local
  server only. How a real gateway behaves with the app has not been confirmed by a run.
- **§804** — Plan with AI always sends the internal hourly rate of each internal person's role. The only
  way to keep rates from the AI is people protection, which hides the feature.
- **§810** — Hiding a project's Resources function hides its views but does not keep their data from the
  AI. While people protection is off, the AI chat can still read people, absences and allocations, and
  change people and absences, in that project. And five AI features (the steering committee report draft,
  Analyze next actions, the scheduled job analysis, the insight recommendations and the WBS proposal) send
  the list of who is away, by name and absent days, whatever the function's state. People protection switches
  the chat's people tools off and replaces known names with placeholders; the absent days are still sent.

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
