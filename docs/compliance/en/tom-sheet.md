# Technical and organisational measures

## About this document

## Measures

## Hosts the browser may contact

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
