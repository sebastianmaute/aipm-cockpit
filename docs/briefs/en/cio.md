# AI brief for the CIO

## In one paragraph

The app's AI runs on each user's own Anthropic API key (E2, *tested (unit)*). Project data is kept where the
user or the deployment chooses (the browser, a file on the device, SharePoint or Turso), and the app's server,
run where the organisation deploys it, keeps none of it (E44, *read in code*). Model
requests go to Anthropic straight from the browser, or through the app's server, which can forward them to
the organisation's gateway (E4, *tested (unit)*; E5, *tested (unit)*). You decide the route, whose keys are
accepted, the switches and how to watch spend: nothing in the app stops interactive AI at a spend limit (E38,
*read in code*).

## What leaves, and who approves it

- **To Anthropic or your gateway:** the AI request with the project content each feature sends
  ([AI paths](appendix.md#ai-paths); E1, *read in code*).
- **From the app's server:** workspace data goes only to services the user or the organisation sets up
  (Anthropic or its gateway, Atlassian, Timelog, a speech service); the exchange-rate request and the desktop
  update check carry none ([server destinations](appendix.md#server-destinations); E34, *read in code*). Where
  the server-side chat deletion is configured, the server holds a Turso address and token and deletes saved
  chats past their retention (E44, *read in code*; E29, *read in code*).

## What you control

- **Route:** with no gateway address and no key restriction the browser calls Anthropic itself; with either
  set it calls the app's relay, which forwards to your gateway when one is set (E4, *tested (unit)*; E5,
  *tested (unit)*). The gateway route is configured, not proven live (§802; E12, *not proven*).
- **Keys:** with `AIPM_AI_ORGANIZATION_ID` set, the relay accepts only keys of your Anthropic organisation,
  and optionally of listed workspaces, and forwards nothing for others (E7, *tested (unit)*). A pass is kept
  for up to 15 minutes, so a key that stops qualifying keeps working that long (E9, *tested (unit)*).
- **Model:** each user picks it from the models Anthropic lists for their key, Claude Sonnet 5 by default; no
  deployment switch sets it (E45, *read in code*), and the figures are for claude-sonnet-5 only (E33,
  *measured*).
- **Switches:** AI off, or people protection forced on in every project (E19, *tested (unit)*); no switch turns
  off a single AI feature (E42, *read in code*).
- **Cost at scale:** about $25, $67 or $165 a month for a team of five at light, typical or heavy use; the
  arithmetic multiplies by the number of users, and the calls per user are assumed (E25, *estimated*).

## Not yet proven / open gaps

1. **§802:** the gateway route has never run against a real gateway (E12, *not proven*).
2. **§805:** the relay adds the gateway token for any caller that reaches the server; the server routes do not
   authenticate callers (E13, *read in code*).
3. **§798:** most AI calls have no time limit of their own, and none is retried on a rate limit or overload
   (E40, *read in code*).
4. **§814:** six paths have no measured cost or behaviour, a refused key among them (E39, *not proven*).
5. **§806:** the AI relay and the dictation route have no request limit (E54, *read in code*).

## What to check or ask for before saying yes

- Choose the route and write down the [deployment switches](appendix.md#deployment-switches) you set. Whenever
  the relay is used, put the app's server behind your own access control: the relay checks no caller and has
  no request limit (§806; E13, *read in code*; E54, *read in code*).
- Before relying on a gateway, ask for one run of the live proof through a test gateway of yours (§802; E12,
  *not proven*).
- Ask whether spend limits and usage reports can be set on the Anthropic organisation or workspaces the keys
  belong to; the app counts usage only in each user's browser and cannot stop interactive spend (E38,
  *read in code*).
- Decide where project data lives (E44, *read in code*) and, if chats are to be saved, who holds the recovery
  key and which retention applies (E28, *read in code*; E29, *read in code*).

## Where to read more

- [Appendix](appendix.md): [the two routes](appendix.md#two-routes-to-the-model), the evidence table and the
  generated tables.
- The [operating guide](../../RUNBOOK.md): restricting AI to your keys, routing AI through a gateway, saved
  chats.
- [TOM sheet](../../compliance/en/tom-sheet.md) and [vendor touchpoints](../../compliance/en/vendor-touchpoints.md).
- The other briefs: [CEO](ceo.md), [CISO](ciso.md), [COO](coo.md), [DPO](dpo.md).
