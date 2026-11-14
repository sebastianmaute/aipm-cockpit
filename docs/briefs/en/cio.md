# AI brief for the CIO

## In one paragraph

The app's AI runs on each user's own Anthropic API key (E2, *tested (unit)*). Project data is kept where the
user or the deployment chooses, and the app's own server keeps none of it (E44, *read in code*). Model
requests go to Anthropic straight from the browser, or through the app's server, which can forward them to
the organisation's gateway (E4, *tested (unit)*; E5, *tested (unit)*). You decide the route, whose keys are
accepted, the switches and how to watch spend: nothing in the app stops interactive AI at a spend limit (E38,
*read in code*).

## What leaves, and who approves it

- **Stored data:** in the browser's own database, in a file on the device, on a SharePoint site or in a Turso
  database; the app's server runs wherever the organisation deploys it, and in the desktop app on the user's
  device (E44, *read in code*).
- **To Anthropic or your gateway:** the AI request with the project content each feature sends
  ([AI paths](appendix.md#ai-paths); E1, *read in code*).
- **From the app's server:** workspace data goes only to services the user or the organisation sets up
  (Anthropic or its gateway, Atlassian, Timelog, a speech service); the exchange-rate request and the desktop
  update check carry none ([server destinations](appendix.md#server-destinations); E34, *read in code*).
- **Approval in the app:** each user switches AI on and accepts the AI disclosure on each device, again when
  the route changes (E31, *tested (unit)*); background AI needs a separate acceptance (E32, *tested (unit)*).

## What you control

- **Route:** with no gateway address and no key restriction the browser calls Anthropic itself; with either
  set it calls the app's relay, which forwards to your gateway when one is set (E4, *tested (unit)*; E5,
  *tested (unit)*). The gateway route is configured, not proven live (§802; E12, *not proven*).
- **Keys:** with `AIPM_AI_ORGANIZATION_ID` set, the relay accepts only keys of your Anthropic organisation,
  and optionally of listed workspaces, and forwards nothing for others (E7, *tested (unit)*). A pass is kept
  for up to 15 minutes, so a key that stops qualifying keeps working that long (E9, *tested (unit)*). Keys are
  stored encrypted in the browser (E46, *tested (unit)*).
- **Model:** each user picks it from the models Anthropic lists for their key, Claude Sonnet 5 by default; no
  deployment switch sets it (E45, *read in code*). All measured figures are for claude-sonnet-5 (E33,
  *measured*).
- **Switches:** AI off, or people protection forced on in every project (E19, *tested (unit)*); no switch turns
  off a single AI feature (E42, *read in code*).
- **Cost at scale:** about $25, $67 or $165 a month for a team of five at light, typical or heavy use; the
  arithmetic multiplies by the number of users, and the calls per user are assumed (E25, *estimated*). Usage
  is counted only in each user's browser (E38, *read in code*).

## Not yet proven / open gaps

1. **§802:** the gateway route has never run against a real gateway (E12, *not proven*).
2. **§805:** the relay adds the gateway token for any caller that reaches the server; the server routes do not
   authenticate callers (E13, *read in code*).
3. **§798:** most AI calls have no time limit of their own; the relay cuts off an answer that stays silent for
   15 minutes, and a rate-limit or overload answer is not retried (E40, *read in code*).
4. **§814:** six paths have no measured cost or behaviour, a refused key among them (E39, *not proven*).
5. **§813:** erasure of saved chats is proven live only for its database statements (E30,
   *tested (live database)*).

## What to check or ask for before saying yes

- Choose the route and write down the [deployment switches](appendix.md#deployment-switches) you set. With a
  gateway, put the app's server behind your own access control, since the relay checks no caller (E13,
  *read in code*).
- Before relying on the gateway, have the written live proof run against yours (E12, *not proven*).
- Ask whether spend limits and usage reports can be set on the Anthropic organisation or workspaces the keys
  belong to; the app cannot stop interactive spend (E38, *read in code*).
- Decide where project data lives (E44, *read in code*) and, if chats are to be saved, who holds the recovery
  key and which retention applies (E28, *read in code*; E29, *read in code*).

## Where to read more

- [Appendix](appendix.md): [the two routes](appendix.md#two-routes-to-the-model), the evidence table and the
  generated tables.
- The [operating guide](../../RUNBOOK.md): restricting AI to your keys, routing AI through a gateway, saved
  chats.
- [TOM sheet](../../compliance/en/tom-sheet.md) and [vendor touchpoints](../../compliance/en/vendor-touchpoints.md).
- The other briefs: [CEO](ceo.md), [CISO](ciso.md), [COO](coo.md), [DPO](dpo.md).
