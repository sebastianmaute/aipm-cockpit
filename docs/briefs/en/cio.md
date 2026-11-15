# AI brief for the CIO

*How to read this page:* `E<n>` is a row of the [evidence table](appendix.md#evidence-table); its
[label](appendix.md#evidence-labels) is *measured*, *tested (unit)* (a test with fakes, not a live run),
*tested (live database)*, *read in code* (these briefs cite no test or run for it), *estimated* or
*not proven*. `§N` is an open entry of the project's public [register](../../open-followups.md), listed under
[Open gaps](appendix.md#open-gaps).

## In one paragraph

The app's AI runs on each user's own Anthropic API key (E2, *tested (unit)*). Project data is kept where the
user or the deployment chooses (the browser, a file on the device, SharePoint or Turso), and the app's server,
run where the organisation deploys it, stores no project data of its own (E44, *read in code*). Model requests
go to Anthropic straight from the browser (the direct route), or through the app's server (the relay route),
which can forward them to the organisation's gateway ([diagram](appendix.md#two-routes-to-the-model); E4,
*tested (unit)*; E5, *tested (unit)*); on the relay route each request, with the project content in it, passes
through that server (E34, *read in code*). You decide the route, whose keys are accepted, the switches and how
to watch spend: nothing in the app stops interactive AI at a spend limit (E38, *read in code*).

## What leaves, and who approves it

- **To Anthropic or your gateway:** the AI request with the project content each feature sends
  ([AI paths](appendix.md#ai-paths); E1, *read in code*).
- **From the app's server:** workspace data goes only to services the user or the organisation sets up
  (Anthropic or its gateway, Atlassian, Timelog, a speech service). The exchange-rate request carries none; the
  desktop update check carries no workspace data but does send the requester's IP address and a fixed
  identifier that is the same for every installation ([server destinations](appendix.md#server-destinations);
  E34, *read in code*). Where the server-side chat deletion is configured, the server holds a Turso address and
  token (E44, *read in code*; E29, *read in code*).

## What you control

- **Route:** with no gateway address and no key restriction the browser calls Anthropic itself; with either
  set it calls the app's relay, which forwards to your gateway when one is set (E4, *tested (unit)*; E5,
  *tested (unit)*). The gateway route is configured, not proven live (§802; E12, *not proven*).
- **Keys:** with `AIPM_AI_ORGANIZATION_ID` set, the relay accepts only keys of your Anthropic organisation,
  and optionally of listed workspaces, and forwards nothing for others (E7, *tested (unit)*). A *pass*, the
  server's memory of a positive check, is kept for up to 15 minutes, so a key that stops qualifying keeps
  working that long (E9, *tested (unit)*). The server holds no Anthropic credential, so it cannot revoke a
  user's key: that is for the Anthropic account the key belongs to (E52, *read in code*).
- **Model:** each user picks it from the models Anthropic lists for their key, Claude Sonnet 5 by default; no
  deployment switch sets it (E45, *tested (unit)*); the figures cover claude-sonnet-5 only (E33, *measured*).
- **Switches:** AI off, or people protection forced on in every project (E19, *tested (unit)*). No switch turns
  off a single AI feature (E42, *tested (unit)*); `stt` does not stop dictation but moves it to the browser's own
  speech recognition, which in some browsers sends audio to the browser maker; people protection switches
  dictation off (E1, *read in code*; E18, *tested (unit)*).
- **Monitoring:** the relay writes no log of its own, none with a key, token, body or URL, apart from a
  warning, once per server process for each reason, that the gateway or key-restriction setting is invalid;
  the chat deletion warns the same way about an invalid chat setting (the reason only). Usage is counted only
  in each browser, so per-user figures must come from Anthropic or your gateway (E65, *tested (unit)*; E6,
  *tested (unit)*; E38, *read in code*).
- **Cost at scale:** about $5, $13 or $33 per user and month at light, typical or heavy use (E25,
  *estimated*), from 2 to 6 calls per feature on one demo project (E37, *measured*).

## Not yet proven / open gaps

1. **§802:** the gateway route has never run against a real gateway (E12, *not proven*).
2. **§798:** most AI calls have no time limit of their own, and none is retried on a rate limit or overload
   (E40, *read in code*).
3. **§814:** six paths have no measured cost or behaviour, a refused key among them (E39, *not proven*).

## What to check or ask for before saying yes

- Choose the route and write down the [deployment switches](appendix.md#deployment-switches) you set. Whenever
  the relay is used, put the app's server behind your own access control: the app does not authenticate callers
  (E13, *read in code*). The relay's origin check and its limit of 120 calls a minute per caller stop a plain
  script, not a determined caller, because both rest on headers a caller can set (§562; E54, *read in code*;
  E69, *tested (unit)*).
- Before relying on a gateway, ask for one run of the live proof through a test gateway of yours (§802; E12,
  *not proven*).
- Ask Anthropic, for your organisation's account: what it retains of a request and for how long, whether it
  trains on it, which entity and region process it, which data-processing terms and transfer mechanism apply,
  whether a zero-retention option exists, and which spend limits and usage reports it offers, since the app
  has none (E38, *read in code*).
- Decide where project data lives (E44, *read in code*) and, if chats are to be saved, who holds the recovery
  key and which retention applies (E28, *read in code*; E29, *read in code*).

## Where to read more

- [Appendix](appendix.md): [the two routes](appendix.md#two-routes-to-the-model), the evidence table and the
  generated tables.
- The [operating guide](../../RUNBOOK.md): restricting AI to your keys, routing AI through a gateway, saved
  chats.
- [TOM sheet](../../compliance/en/tom-sheet.md) and [vendor touchpoints](../../compliance/en/vendor-touchpoints.md).
- The other briefs: [CEO](ceo.md), [CISO](ciso.md), [COO](coo.md), [DPO](dpo.md).
