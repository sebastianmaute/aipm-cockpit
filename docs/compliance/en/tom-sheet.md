# Technical and organisational measures

## About this document

This document lists the security measures built into AI PM Cockpit, for your own description of
technical and organisational measures (GDPR Art 32). It is for the information security officer and the
data protection officer. Each measure names its evidence and says what it does not cover; the last
section names what lies outside the app altogether. The hand-written text was last reviewed as the
README's [review line](README.md#text-last-reviewed) states.

This document is input for your own work. It is not legal advice. Whether these measures are appropriate
to the risk of your processing is for you to judge. [question for you]

## Measures

| Measure | What it does | Evidence | What it does not cover |
|---|---|---|---|
| Secrets sealed at rest | API keys and tokens entered in Settings (Anthropic, Turso, Jira, Timelog, speech-to-text) are stored encrypted with AES-256-GCM under a non-extractable WebCrypto key kept in the browser's IndexedDB. The settings are written with these fields blanked. Some secrets can also be locked with a passphrase (PBKDF2, 600,000 iterations). | verified: `src/app/secrets.ts`, `src/app/secrets-store.ts`, `writeSettings` in `src/app/use-settings.ts` | Where WebCrypto or IndexedDB is unavailable, the app keeps the secrets in memory as plain text for the session and does not save them (`src/app/use-settings.ts`). While the app is open, the decrypted secrets are in memory and anyone or anything running in that browser profile can use them. A Turso token set at build time (`NEXT_PUBLIC_TURSO_AUTH_TOKEN`) is built into the app's code and is not secret (`docs/security.md`). Identifying fields such as the Jira site address and e-mail address are stored unencrypted. |
| Content Security Policy | Each page carries a policy that runs only scripts bearing a per-request nonce, and the scripts those load (`'strict-dynamic'`); it allows connections only to the app's own origin and the hosts listed [below](#hosts-the-browser-may-contact), forbids embedding the app in other sites and forbids plug-in objects. Anthropic's host is dropped when AI goes through a gateway, is restricted to the organisation's keys, or is switched off. | verified: `src/proxy.ts`, `src/proxy.test.ts` | Whole host families are allowed by wildcard (§800). Inline style attributes are allowed. Requests made by the app's own server are not governed by it; they are listed [below](#destinations-of-the-server-and-the-desktop-app). Browser dictation, windows the app opens and links a user follows are outside it. A development server runs a looser policy. |
| Access to project data is your storage's | The app has no user accounts or roles of its own. Who can read and change a project is decided by where it is stored: the browser profile, a file and its folder permissions, a Turso database and whoever holds its token, or a SharePoint library and its permissions. | vendor statement; `docs/security.md`, section "Security model" | Within a project, everyone with access sees and can change everything. Anyone holding the Turso token the app uses can read and change every project in that database. The app's server does not authenticate callers (verified: the 15 route files under `src/app/api`): anyone who can reach it can send AI requests through your gateway under its token (§805) and use the integration routes with credentials of their own. Run the server behind your own access control, such as a reverse proxy with sign-in, single sign-on or a network restriction. Setting up and reviewing access is yours. [question for you] |
| Organisation key restriction | With `AIPM_AI_ORGANIZATION_ID` (and optionally `AIPM_AI_WORKSPACE_IDS`) set, the server checks which Anthropic organisation and workspace each API key belongs to before it forwards an AI request, and refuses other keys. A malformed or misspelled setting switches AI off. | verified: `src/app/ai-key-restriction-config.ts`, `src/app/api/ai/_relay.ts` and their tests | The check proves which account a key belongs to, not what your contract with Anthropic covers. A person with a key can still use it outside the app. An operator with access to the server environment can change or remove the setting. Results are cached per server process, so a key is not re-checked on every request. (`docs/security.md`, section "AI features") |
| AI gateway route | With `AIPM_AI_GATEWAY_URL` set, AI requests go from the browser to the app's server and through your organisation's gateway; the gateway token stays on the server. An invalid setting switches AI off instead of falling back to a direct call. | verified: `src/app/api/ai/_relay.ts`, `src/app/deployment-variables.ts` | It has never been run against a real gateway (§802). What the gateway logs and keeps is set by your organisation, not by the app. |
| Switches for integrations and AI | `AIPM_DISABLED_INTEGRATIONS` switches off Jira, Confluence, Timelog, exchange rates, speech-to-text or all AI for a deployment: the server routes refuse with an error and the app hides the controls. Before each AI request the app asks the server for the current setting. | verified: `src/app/api/_shared/integration-switch.ts`, `confirmAiDeployment` in `src/app/ai-transport.ts`, `src/app/deployment-variables.ts` | A change needs a server restart. Browser dictation stays available. Data already sent stays where it went. Users' stored settings are kept, so removing a name from the list brings an integration back as it was. |
| People protection | On by default in every project; an operator can force it on for all projects (`ai-people`). The names, e-mail addresses and phone numbers of people the project knows are replaced by placeholders before an AI request; the allocation and RACI features are hidden; cloud dictation is off. The per-feature effect is in the record of processing's AI table. | verified: `src/app/ai-people-protection.ts`, `src/app/ai-disclosure.ts` | Names the project does not know, typed into free text or contained in attachments, may still be sent. The new-project wizard sends the names in what the user gives it. It is enforced in the app; only the dictation route also refuses on the server (`src/app/api/stt/_helpers.ts`), so a modified client could bypass it. |
| AI consent per device | AI is off until a user switches it on and accepts a disclosure that lists what each AI feature sends. Background AI needs a second consent. Both are asked again when the disclosure, the AI route or the key restriction changes. | verified: `src/app/ai-disclosure.ts` | A device consent is a record that the user saw the disclosure; whether it is a legal basis for anything is for you to decide. [question for you] Background runs are not approved run by run (§795). |
| Review before AI changes | The chat holds proposed changes on a review card when they delete something, send mail to meeting attendees, set a date that falls on someone's absence, change more than one item, or come from a tool that always asks for review, and whenever a file is attached to the conversation. | verified: `shouldStage` in `src/app/chat-proposal.ts` | A single change outside those cases is applied at once (§794). Outside text read through the chat's tools does not trigger the hold (§797). Tasks created by an applied work breakdown cannot be undone (§796). |
| Activity log | Each project keeps a log of changes with time, kind, the fields changed with old and new values, and whether a user, the AI or an integration made the change. It keeps the newest 500 entries. It is stored with the project and left out of every export; the one way out is an internal audit download in Settings (expert mode), as JSON. | verified: `src/app/activity-log.ts` (`ACTIVITY_MAX_ENTRIES`), `src/app/activity-log.test.ts`, `src/app/activity-audit.ts` | It does not name the person who made a change. It does not link an AI change to the chat message behind it (§799). Older entries are dropped beyond 500. Anyone who can write the project's storage can change it. The audit download is not access-controlled: the app has no roles, and anyone can switch expert mode on. |
| Saved AI chats: encryption, retention, erasure | Chats are saved only on Turso storage and only with an operator recovery key set. Each chat is encrypted (AES-256-GCM); its key is stored for the writer and, with RSA-OAEP to a key of at least 3072 bits, for the operator. A chat is deleted when the retention period (30 days by default) has passed since its last change, by the browser, by the server daily and by the operator's script. Users can delete all their chats or find chats that mention a person; the operator can search and delete across the database. | verified: `src/app/chat-crypto.ts`, `src/app/ai-chat-retention-config.ts`, `src/app/use-chat-retention-sweep.ts`, `src/app/api/ai/_chat-sweep.ts`, `scripts/chat-erasure.mjs` | Chats saved by older versions are not encrypted and readable by anyone in the project until they expire. Anyone with the Turso token sees each chat's project, random owner id and times, and can delete rows. An invalid retention setting pauses deletion for age. An AI gateway's own logs, and what Anthropic keeps, are outside the app. |
| Release integrity | Releases are built only by the repository's release workflow from a version tag on `main`. Each release with an SBOM carries GitHub attestations: build provenance for its files and an SBOM attestation for the installer. A code-signing pipeline exists. | verified: `.github/workflows/release.yml`; `README.md`, section "Code signing policy"; `SECURITY.md` | Signing is switched off: no installer released so far is signed (§487), and the uninstaller will not be signed when it is switched on (§793). A copy installed before the first signed release takes that release without a signature check, and an installer such a copy had already downloaded and cached is installed once without a check. A web deployment is built by you, and these attestations do not cover your build. |
| Checks on every change | Every pull request and every push to `main` runs these jobs: static checks, unit tests (twice, once shuffled), the build, an SBOM build, end-to-end tests with an accessibility scan, a smoke test against a production server, Semgrep (failing on error severity) and `npm audit` (failing on high severity in production dependencies). | verified: `.github/workflows/ci.yml`, kept in line with the gate list by `scripts/ci-workflow.test.mjs` | That `main` cannot take a change while one of these is red is a GitHub repository setting, not code. [vendor statement] Scanners find known patterns only. No external penetration test or certification has been done. [vendor statement] |
| Server-side request guards | The server routes for Jira and Confluence forward only to addresses under `atlassian.net`, Timelog only under `timelog.com`, and speech-to-text only over https to an address that is not private; they do not follow redirects. Requests to Jira, Confluence, Timelog and the exchange-rate route are limited per caller. | verified: `src/app/api/_shared/proxy-ssrf.ts`, `src/app/api/jira/_helpers.ts`, `src/app/api/timelog/_helpers.ts`, `src/app/api/stt/_helpers.ts`, `src/app/api/ecb/route.ts` (the `rateLimit` calls) | The AI routes and the dictation route have no request limit, and dictation forwards to whatever public https address the caller names (§806). The private-address check does not resolve host names (§803). The limit on the other routes can be avoided with a forwarding header and resets on restart (§562). No route authenticates its caller (§805). |
| Vulnerability handling | Reports go privately through GitHub. The maintainer gives a first answer within a week and fixes the latest release. | vendor statement; `SECURITY.md` | There is no contract, no service level and no support period. Older releases get no fixes. There is no notification channel other than the releases page. |

## Hosts the browser may contact

The same table as in the [vendor touchpoints](vendor-touchpoints.md#hosts-the-browser-may-contact),
which explains how to read it. It is the host list of the Content Security Policy above. [verified:
`src/proxy.ts`]

<!-- PACK:browser-hosts:BEGIN -->
| Host | Directive | Condition |
|---|---|---|
| https://api.anthropic.com | Connections (connect-src) | Only when all three hold: the deployment sends AI requests directly to Anthropic (no AI gateway), it does not restrict AI to its organisation's keys, and the AI integration is not switched off |
| https://*.turso.io | Connections (connect-src) | Always allowed |
| https://graph.microsoft.com | Connections (connect-src) | Always allowed |
| https://*.sharepoint.com | Connections (connect-src) | Always allowed |
| https://*.files.1drv.com | Connections (connect-src) | Always allowed |
| https://login.microsoftonline.com | Connections (connect-src) | Always allowed |
| http://localhost:* | Connections (connect-src) | Always allowed |
| http://127.0.0.1:* | Connections (connect-src) | Always allowed |
| https://login.microsoftonline.com | Embedded frames (frame-src) | Always allowed |
<!-- PACK:browser-hosts:END -->

## Destinations of the server and the desktop app

The same table as in the
[vendor touchpoints](vendor-touchpoints.md#destinations-of-the-server-and-the-desktop-app), which explains
how to read it. [verified: `src/app/outbound-destinations.ts`]

<!-- PACK:server-destinations:BEGIN -->
| Run by | Code that sends it | What is sent | What triggers it |
|---|---|---|---|
| Anthropic | src/app/api/ai/_relay.ts | The caller's own Anthropic API key and the AI request itself (the conversation, including any project content the assistant was given), forwarded to api.anthropic.com, plus the model-list request, and before each such request a one-item model-list request with the same key that checks which organisation the key belongs to. | When the deployment restricts AI keys to an Anthropic organisation (AIPM_AI_ORGANIZATION_ID), sets no gateway address and a user sends an AI request; without that restriction the browser calls Anthropic itself, which the browser-side host list covers. |
| The deploying organisation | src/app/api/ai/_relay.ts | The same requests the Anthropic relay would send (the caller's Anthropic API key, the AI request itself and the model-list request), addressed to the deployment's gateway, with the gateway token added when one is set; when keys are restricted to an organisation, each is preceded by a one-item model-list request with the same key that checks the key's organisation. | When the deployment sets a gateway address (AIPM_AI_GATEWAY_URL) and a user sends an AI request. |
| Turso | src/app/api/ai/_chat-sweep.ts | Statements that create the saved-chats table if it is missing and delete saved chats older than the retention period, sent to the Turso database the server is configured with together with its Turso auth token; the statements carry the number of days and read no chat content. | Once when the server starts and every 24 hours after, while Turso credentials for the sweep (or the app's public Turso address) are set and the retention setting is valid. |
| Atlassian | src/app/api/jira | The user's Jira e-mail address and API token as basic authentication, and the request the user triggered (for example a search query, or the fields of an issue being created, updated or transitioned, and the lookups behind these such as projects, issue types and users), sent to the user's own Atlassian Cloud site (an address under atlassian.net). | When Jira is enabled in the project settings, the integration is not switched off for the deployment, and a user uses a Jira function such as search, import or sync. |
| Atlassian | src/app/api/confluence | The user's Atlassian e-mail address and API token as basic authentication and the id of the one Confluence page the user asked for, sent to the user's own Atlassian Cloud site (an address under atlassian.net). | When a user imports a Confluence page and the integration is not switched off for the deployment. |
| Timelog | src/app/api/timelog | The user's Timelog access token as a bearer token, the Timelog tenant name in the address, and the request the user triggered (a path, a query and, for writes, the time-registration data), sent to the user's own Timelog host (an address under timelog.com). | When Timelog is configured in the settings, the integration is not switched off for the deployment, and a user uses a Timelog function such as booking time or loading registrations. |
| A service the user enters | src/app/api/stt | The recorded audio of the dictation (as a webm file), the speech model name and the user's speech-to-text API key as a bearer token, sent over https to the endpoint address the user entered in the dictation settings, unless that address is a private IP address. | When a user dictates with a speech-to-text endpoint configured, and neither the dictation integration, the AI integration nor the people-protection lock is switched off for the deployment, and the deployment's AI gateway setting is not invalid. |
| European Central Bank | src/app/api/ecb | A plain request for the European Central Bank's daily euro reference rates, carrying no workspace data and no credentials. | When the app loads or refreshes exchange rates and the ecb integration is not switched off for the deployment. |
| GitHub | desktop/src/updater.ts | Requests to github.com for the app's releases feed (releases.atom), the latest release tag and its update information file (latest.yml) and, when the user accepts an update, a download of the installer (and of its block map, when the release has one) from GitHub's release-asset hosts; the update checks and downloads carry the requester's IP address, the update library's User-Agent (electron-builder) and a fixed identifier (header x-user-staging-id) that is the same for every installation, and no workspace data; the library still stores a random per-installation identifier in the app's data folder, but it stays on the device and is not sent. | In a packaged desktop app 10 seconds after start and whenever the user chooses Check for updates, unless AIPM_DISABLE_UPDATE_CHECK is set to 1; the installer download starts only when the user accepts the update. |
<!-- PACK:server-destinations:END -->

## Deployment switches

Every setting an operator gives the app's server, or the desktop app, as an environment variable. The
table is generated from the app's list of these variables; a test fails when the code reads an `AIPM_`
name that the list does not hold. [verified: `src/app/deployment-variables.ts`,
`src/app/deployment-variables.test.ts`] The values are read from the process environment, so a change
takes effect when the server or the desktop app restarts. [vendor statement; `docs/security.md`, section
"Environment variables"] Which of these your deployment
sets, and who may change them, is yours to decide and record. [question for you]

<!-- PACK:deployment-switches:BEGIN -->
| Variable | Also accepted as | Applies to | Allowed values | Effect |
|---|---|---|---|---|
| AIPM_AI_GATEWAY_URL | - | Server | - | Sends this deployment's AI requests to the given https gateway address instead of directly to Anthropic; an unusable value makes AI requests fail until it is fixed. |
| AIPM_AI_GATEWAY_TOKEN | - | Server | - | Token the server sends to the AI gateway with each request; it never reaches the browser, and without a gateway address it is an invalid setting. |
| AIPM_AI_ORGANIZATION_ID | - | Server | - | Restricts AI use to API keys of this Anthropic organisation: the server checks each key's organisation before forwarding a request and refuses other keys; a set variable whose name, in any letter case, starts with AIPM_AI_ and contains ORG or WORKSPACE but is not exactly this name or the workspace-ids name makes AI requests fail. |
| AIPM_AI_WORKSPACE_IDS | - | Server | - | With the organisation id, further restricts AI use to keys of the listed Anthropic workspaces (comma-separated); without the organisation id it is an invalid setting, and a set variable whose name, in any letter case, starts with AIPM_AI_ and contains ORG or WORKSPACE but is not exactly this name or the organisation-id name makes AI requests fail. |
| AIPM_DISABLED_INTEGRATIONS | - | Server | jira, confluence, timelog, ecb, stt, ai, ai-people | Comma-separated integrations this deployment switches off: the server refuses their requests and the app hides them, and the value ai-people forces people protection on in every project. |
| AIPM_AI_CHAT_RETENTION_DAYS | - | Server | - | Days a saved AI chat is kept before it is deleted for age, by the browser and by the server's daily deletion where that is configured (1 to 3650, 30 when unset); an invalid value pauses deletion for age until it is fixed. |
| AIPM_AI_CHAT_RECOVERY_PUBLIC_KEY | - | Server | - | Operator's RSA public key (base64, at least 3072 bits) that saved AI chats are also encrypted to for recovery; while it is unset or unusable, no chat is saved. |
| AIPM_CHAT_SWEEP_TURSO_URL | - | Server | - | Turso database address the server's daily deletion of expired AI chats connects to; when unset, the app's public Turso address is used instead, and a remote address without a sweep token means the daily deletion does not run. |
| AIPM_CHAT_SWEEP_TURSO_TOKEN | - | Server | - | Auth token used only together with the sweep database address (ignored when that is unset, as the public Turso pair is then used); a remote sweep address without it means the daily deletion does not run. |
| AIPM_DISABLE_UPDATE_CHECK | - | Desktop app | - | Set to 1, the desktop app makes no update checks and shows no update dialog. |
<!-- PACK:deployment-switches:END -->

## What these measures do not cover

The measures above are the app's. These lie outside it:

- **The device and the browser profile.** The browser profile is the security boundary: anyone with
  access to it can use every stored credential while the app is open. Device security, screen locks,
  malware protection and who may use which computer are yours. [vendor statement; `docs/security.md`,
  section "Security model"; the measures: question for you]
- **Your storage.** Backups, access rights and encryption of files, Turso databases and SharePoint
  libraries are set by you and by those providers. [question for you]
- **The services the app sends to.** Anthropic, Microsoft, Turso, Atlassian, Timelog, a speech-to-text
  service and an AI gateway apply their own measures under their own terms. Check them against your
  contracts with each. [question for you]
- **Where AI requests are processed.** The app does not set Anthropic's `inference_geo` request
  parameter. [verified: no use of `inference_geo` in `src/`] Anthropic documents two values for it,
  `global` (the default, where inference may run in any available geography) and `us`, and a workspace
  setting that can fix the default and the allowed values. [external: Claude Platform Docs, "Data
  residency", https://platform.claude.com/docs/en/manage-claude/data-residency, read 2026-11-13] The
  same page describes a separate workspace geo, which controls where data is stored at rest and where
  endpoint processing such as image transcoding happens, and states that `us` is currently the only
  workspace geo available. [external: same page, read 2026-11-13] Which inference setting your Anthropic
  workspace uses is yours to set and record. [question for you]
- **Your network and access control.** The app's server does not authenticate its callers. [verified:
  the 15 route files under `src/app/api`] Anyone who can reach it can send AI requests through your
  gateway under its token (§805), and the AI and dictation routes have no request limit (§806). Run the
  server behind your organisation's own access control, such as a reverse proxy with sign-in, single
  sign-on or a network restriction. [vendor statement; how you do it: question for you]
- **Training and instructions.** What staff are told about the AI, and the rules they follow, are yours.
  The [AI literacy](ai-literacy.md) material is a starting point. [question for you]
- **Support.** There is no support period and no service level. [vendor statement]
