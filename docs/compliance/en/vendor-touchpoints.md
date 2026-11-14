# Vendor touchpoints

## About this document

This document says what reaches the maintainer of AI PM Cockpit when your organisation uses it, and
lists every outside host the app contacts. It is for the data protection officer, who must decide whether
the maintainer receives any personal data, and for the information security officer, who must know where
the app connects. The hand-written text was last reviewed as the README's
[review line](README.md#text-last-reviewed) states.

This document is input for your own work. It is not legal advice.

## What reaches the maintainer

Nothing the app does at runtime sends data to the maintainer. The maintainer runs no server, no AI
gateway, no telemetry or analytics service and no crash-report service for the app. [vendor statement]

The code bears this out. The hosts a browser page of the app may connect to are fixed by its Content
Security Policy, listed in the first table below; none of them is run by the maintainer. [verified:
`src/proxy.ts`, pinned by `src/proxy.test.ts`] Everything the app's own server and the desktop app
contact is listed in the second table. A test walks the shipped source and fails when a server route
directory, or a desktop file that makes network calls, is missing from that list; none of the listed
destinations is run by the maintainer. [verified: `src/app/outbound-destinations.ts`,
`src/app/outbound-destinations.test.ts`]

The project's README states the same for the desktop app in its privacy statement: no account, no
backend that stores your data, no telemetry, no usage analytics and no crash reports. [vendor statement]

### Updates

The desktop app checks the project's GitHub releases for updates. The request goes to GitHub, not to the
maintainer. [verified: `desktop/src/updater.ts`]

- **When.** In a packaged desktop app, 10 seconds after start and whenever the user chooses Check for
  updates. Setting the environment variable `AIPM_DISABLE_UPDATE_CHECK` to `1` stops all checks.
  [verified: `STARTUP_CHECK_DELAY_MS` in `desktop/src/lib/update-policy.ts`, used in `desktop/src/main.ts`;
  `desktop/src/updater.ts`; `src/app/deployment-variables.ts`]
- **What GitHub sees.** The request itself, which carries the computer's IP address, the update
  library's user agent (electron-builder), and a fixed identifier in the header `x-user-staging-id`.
  That identifier is the same value for every installation, so it does not tell installations apart. The
  update library also stores a random identifier of its own in the app's data folder; the app does not
  send it. No project data is sent. [verified: `desktop/src/updater.ts`; the test "sends one fixed staging
  id, never a per-installation one" in `desktop/src/updater.test.ts`]
- **Downloads.** An installer is downloaded only after the user accepts the update. [verified:
  `desktop/src/updater.ts`]
- **What the maintainer can see.** GitHub keeps a download count for each release file and makes it
  available as a number per file (`download_count`). [external: GitHub REST API, "Release assets",
  https://docs.github.com/en/rest/releases/assets, read 2026-11-13] The maintainer receives nothing else
  about who checked or downloaded. [vendor statement]
- **Signature check.** A copy installed from a signed release refuses an update whose installer is not
  signed by SignPath Foundation. No release has been signed so far (§487), so this check does not yet
  protect any installed copy. [verified: `README.md`, section "Code signing policy";
  `.github/workflows/release.yml`]

A web deployment of the app has no updater. Your organisation deploys new versions itself. [verified:
`src/app/outbound-destinations.ts` lists the updater only for `desktop/src/updater.ts`]

What GitHub does with the requests it receives is governed by GitHub's own terms, not by the
maintainer. [vendor statement] Whether those terms are acceptable for the update checks your computers
make, or whether you turn the checks off, is for you to decide. [question for you]

### Support and vulnerability reports

Support happens in public, through the GitHub issues of the repository. A vulnerability is reported
privately through GitHub's "Report a vulnerability" function, as `SECURITY.md` describes. [verified:
`SECURITY.md`]

Both contain only what the person reporting writes into them. The app has no function that sends logs,
project data or diagnostics to the maintainer. [vendor statement] The diagnostic log the app keeps is
stored in the browser (capped at 200 events) and is not sent anywhere. [verified: `src/app/diagnostics.ts`]
If your staff attach screenshots, logs or exported files to an issue, that content is
public. Decide whether staff may report problems in public, and what they may include. [question for you]

The maintainer has no remote access to any installation and asks for none. [vendor statement]

## Hosts the browser may contact

The table below lists every outside host that the app's Content Security Policy allows a page of the
app to contact. It is read from the same constants the server uses to build the policy. [verified:
`src/proxy.ts`] How to read it:

- **Directive.** "Connections" are requests the page makes itself (data, sign-in tokens). "Embedded
  frames" are pages the app may load inside itself; here only the Microsoft sign-in page, which renews
  tokens in a hidden frame. [verified: `src/proxy.ts`]
- **Condition.** "Always allowed" means the policy permits the host on every deployment. The page
  contacts it only when the user sets up the matching feature: Turso storage, Microsoft 365 sign-in, or a
  Turso database on the user's own computer for the two local addresses. [vendor statement; the use of
  each host is described in `src/proxy.ts`]
- **Who runs each host.** `api.anthropic.com` is Anthropic. `*.turso.io` is Turso, holding a database in
  an account that the user or your organisation created. `graph.microsoft.com`, `*.sharepoint.com`,
  `*.files.1drv.com` and `login.microsoftonline.com` are Microsoft, acting for the Microsoft 365 tenant
  the user signs in to. `localhost` and `127.0.0.1` are the user's own computer. [verified: `src/proxy.ts`]
- **Not in the table.** Every page may also contact its own origin: the server of your deployment, or
  in the desktop app, the local server the desktop app starts on the user's computer. [verified:
  `src/proxy.ts` (`connect-src 'self'`)] The policy does not govern browser dictation, which uses the
  speech recognition built into the browser and in some browsers sends the audio to the browser maker.
  It does not govern windows the app opens either, such as the Microsoft sign-in window, or links the
  user follows. [verified: `src/proxy.ts`, comment on `frame-src`; `docs/security.md`]

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

The wildcard entries allow any Turso database and any SharePoint or OneDrive file host, not only yours
(§800). [verified: `src/proxy.ts`; the register entry §800 in `docs/open-followups.md`]

## Destinations of the server and the desktop app

Some requests do not come from the browser page but from the app's own server (on a web deployment, or
the local server inside the desktop app) or from the desktop app itself. The Content Security Policy
cannot see these, so they are listed separately. [verified: `src/app/outbound-destinations.ts`] How to
read the table:

- **Run by** names who runs the receiving service. "The deploying organisation" is your own AI gateway.
  "A service the user enters" is any speech-to-text endpoint a user types into the settings.
- **Code that sends it** is the server route or desktop module that makes the request, so your
  reviewers can read it.
- **What is sent** and **What triggers it** describe the request as the code builds it. Credentials
  listed there (API keys, tokens) belong to the user or your organisation; the server forwards them and
  does not store them. [verified: `src/app/outbound-destinations.ts`; for the AI relay, `docs/security.md`
  section "AI features"]

<!-- PACK:server-destinations:BEGIN -->
| Run by | Code that sends it | What is sent | What triggers it |
|---|---|---|---|
| Anthropic | src/app/api/ai/_relay.ts | The caller's own Anthropic API key and the AI request itself (the conversation, including any project content the assistant was given), forwarded to api.anthropic.com, plus the model-list request, and, when the server holds no recent result for that key, a one-item model-list request with the same key that checks which organisation the key belongs to; the server keeps a passed check in memory for up to 15 minutes, and a refusal for up to five minutes, so later requests with the same key are usually not checked again. | When the deployment restricts AI keys to an Anthropic organisation (AIPM_AI_ORGANIZATION_ID), sets no gateway address and a user sends an AI request; without that restriction the browser calls Anthropic itself, which the browser-side host list covers. |
| The deploying organisation | src/app/api/ai/_relay.ts | The same requests the Anthropic relay would send (the caller's Anthropic API key, the AI request itself and the model-list request), addressed to the deployment's gateway, with the gateway token added when one is set; when keys are restricted to an organisation, a request whose key the server holds no recent result for is preceded by a one-item model-list request with the same key that checks the key's organisation; the server keeps a passed check in memory for up to 15 minutes, and a refusal for up to five minutes, so later requests with the same key are usually not checked again. | When the deployment sets a gateway address (AIPM_AI_GATEWAY_URL) and a user sends an AI request. |
| Turso | src/app/api/ai/_chat-sweep.ts | Statements that create the saved-chats table if it is missing and delete saved chats older than the retention period, sent to the Turso database the server is configured with together with its Turso auth token; the statements carry the number of days and read no chat content. | Once when the server starts and every 24 hours after, while Turso credentials for the sweep (or the app's public Turso address) are set and the retention setting is valid. |
| Atlassian | src/app/api/jira | The user's Jira e-mail address and API token as basic authentication, and the request the user triggered (for example a search query, or the fields of an issue being created, updated or transitioned, and the lookups behind these such as projects, issue types and users), sent to the user's own Atlassian Cloud site (an address under atlassian.net). | When Jira is enabled in the project settings, the integration is not switched off for the deployment, and a user uses a Jira function such as search, import or sync. |
| Atlassian | src/app/api/confluence | The user's Atlassian e-mail address and API token as basic authentication and the id of the one Confluence page the user asked for, sent to the user's own Atlassian Cloud site (an address under atlassian.net). | When a user imports a Confluence page and the integration is not switched off for the deployment. |
| Timelog | src/app/api/timelog | The user's Timelog access token as a bearer token, the Timelog tenant name in the address, and the request the user triggered (a path, a query and, for writes, the time-registration data), sent to the user's own Timelog host (an address under timelog.com). | When Timelog is configured in the settings, the integration is not switched off for the deployment, and a user uses a Timelog function such as booking time or loading registrations. |
| A service the user enters | src/app/api/stt | The recorded audio of the dictation (as a webm file), the speech model name and the user's speech-to-text API key as a bearer token, sent over https to the endpoint address the user entered in the dictation settings, unless that address is a private IP address. | When a user dictates with a speech-to-text endpoint configured, and neither the dictation integration, the AI integration nor the people-protection lock is switched off for the deployment, and the deployment's AI gateway setting is not invalid. |
| European Central Bank | src/app/api/ecb | A plain request for the European Central Bank's daily euro reference rates, carrying no workspace data and no credentials. | When the app loads or refreshes exchange rates and the ecb integration is not switched off for the deployment. |
| GitHub | desktop/src/updater.ts | Requests to github.com for the app's releases feed (releases.atom), the latest release tag and its update information file (latest.yml) and, when the user accepts an update, a download of the installer (and of its block map, when the release has one) from GitHub's release-asset hosts; the update checks and downloads carry the requester's IP address, the update library's User-Agent (electron-builder) and a fixed identifier (header x-user-staging-id) that is the same for every installation, and no workspace data; the library still stores a random per-installation identifier in the app's data folder, but it stays on the device and is not sent. | In a packaged desktop app 10 seconds after start and whenever the user chooses Check for updates, unless AIPM_DISABLE_UPDATE_CHECK is set to 1; the installer download starts only when the user accepts the update. |
<!-- PACK:server-destinations:END -->

The private-address check for speech-to-text judges the address as typed and does not resolve a host
name (§803). [vendor statement; register §803]

**The server does not check who is calling.** None of the app's server routes authenticates its caller;
there is no sign-in on the server side. [verified: the 15 route files under `src/app/api`] Anyone who can
reach the server can therefore use these routes: send AI requests through your organisation's gateway
under its token (§805), and send requests to the integrations with credentials they hold themselves. The
AI and dictation routes have no request limit (§806), and the limit on the other routes can be avoided
(§562). [vendor statement; register §805, §806 and §562] Run the server
behind your organisation's own access control, such as a reverse proxy with sign-in, single sign-on or a
network restriction. [vendor statement; how you do it: question for you]

An operator can switch off each server-side integration with `AIPM_DISABLED_INTEGRATIONS`;
the [TOM sheet](tom-sheet.md#deployment-switches) lists the switches. [verified:
`src/app/deployment-variables.ts`, `src/app/api/_shared/integration-switch.ts`]

## Roles

**The maintainer.** AI PM Cockpit is a free, non-commercial open-source project. The maintainer provides
it without a contract, a service level or a support period. Fixes go into the latest release only. The
maintainer handles vulnerability reports as `SECURITY.md` describes. [vendor statement; `SECURITY.md`]

**Your organisation.** You decide where the app runs, which storage and integrations it uses, which AI
route and keys it uses, and who may use it. Whether that makes your organisation the controller for the
data in the app, and on what legal basis it processes it, is for you to decide. [question for you]

**The services the app connects to.** Anthropic, Microsoft, Turso, Atlassian, Timelog, a speech-to-text
service and an AI gateway receive data only through accounts that the user or your organisation sets up,
with keys or sign-ins that belong to the user or your organisation. The contract for each runs between
that service and whoever holds the account, not through the maintainer. [verified: the credentials in
each row of the table above, `src/app/outbound-destinations.ts`; contract roles: question for you]

For Anthropic, its Commercial Terms incorporate its Data Processing Addendum by reference. [external:
Anthropic Commercial Terms of Service, https://www.anthropic.com/legal/commercial-terms, effective
17 June 2025, read 2026-11-13] That addendum states that, for customer personal data, the customer is the
controller and Anthropic is the customer's processor. [external: Anthropic Data Processing Addendum,
https://www.anthropic.com/legal/data-processing-addendum, effective 24 February 2025, read 2026-11-13]
Who the "customer" is depends on whose Anthropic account the API key belongs to: your organisation's, or
an employee's own. An operator can make the app accept only keys of your organisation's Anthropic
account (`AIPM_AI_ORGANIZATION_ID`). [verified: `src/app/ai-key-restriction-config.ts`] Whether you set
it, and whether your contract with Anthropic covers this use, is for you to check. [question for you]

**GitHub.** GitHub hosts the code, the releases and the issues, and receives the update checks described
above. [verified: `desktop/src/updater.ts`] The maintainer has no agreement with GitHub on your behalf.
[vendor statement]
