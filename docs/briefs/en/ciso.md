# AI brief for the CISO

*How to read this page:* `E<n>` is a row of the [evidence table](appendix.md#evidence-table); its
[label](appendix.md#evidence-labels) is *measured*, *tested (unit)* (a test with fakes, not a live run),
*tested (live database)*, *read in code* (these briefs cite no test or run for it), *estimated* or
*not proven*. `§N` is an open entry of the project's public [register](../../open-followups.md), listed under
[Open gaps](appendix.md#open-gaps).

## In one paragraph

The AI sends project content to Anthropic straight from the browser (the direct route), or through the app's
server and, when one is set, the organisation's gateway (the relay route;
[diagram](appendix.md#two-routes-to-the-model)) (E4, *tested (unit)*; E5, *tested (unit)*). The model reads
text others wrote, such as attached mail, Jira-synced tasks and Confluence pages picked for a new project; the
chat turns its answers into changes, while the project wizard only pre-fills a form (E47, *tested (unit)*; E48,
*tested (unit)*; E49, *read in code*). On the relay route the server refuses calls while AI is off (E19,
*tested (unit)*) and, when a key restriction is set, runs the key check (E7, *tested (unit)*); on the direct
route AI-off is the page's content policy and the app's own check, both applied by the browser (E53,
*tested (unit)*; E3, *tested (unit)*), so a modified copy is not stopped there, and another client with the
same key is not stopped on either route (E52, *read in code*). People protection also runs in the browser, with
the same limit (E15, *read in code*). These briefs reference no independent security assessment of the app.

## What leaves, and who approves it

- **From the browser:** only to the hosts in the page's Content Security Policy, which the server sends and the
  browser enforces, except dictation with the browser's own speech recognition, which in some browsers sends
  audio to the browser maker (E1, *read in code*); api.anthropic.com is in it only on the direct route with AI
  on (E53, *tested (unit)*).
  Turso, SharePoint and OneDrive hosts are allowed by wildcard, and so is any local port
  ([browser hosts](appendix.md#browser-hosts); §800; E34, *read in code*).
- **From the server:** the relay forwards four Anthropic headers, plus the gateway token when one is set, and
  no cookies, and logs no key, token, body or URL (E6, *tested (unit)*); the other
  [server destinations](appendix.md#server-destinations) are listed. Updates come from the project's GitHub
  releases, so an update installs the same unsigned installer as a first install (E34, *read in code*; E51,
  *tested (unit)*).
- **Keys:** each user's key is stored encrypted in the browser; loaded for use, it is held in plain text in the
  page's memory (E46, *tested (unit)*).
- **People:** with *people protection* on, known people's names (a one-word name only where written with a
  capital) and every e-mail address, valid IBAN and phone-shaped number are replaced before sending, but an
  unknown name is sent as written (E14, *tested (unit)*; E35, *read in code*).

## What you control

- **Deployment-scoped off switch:** `ai` in `AIPM_DISABLED_INTEGRATIONS` makes the relay refuse every call
  (E19, *tested (unit)*) and drops api.anthropic.com from the policy (E53, *tested (unit)*); it acts on this
  deployment only and revokes no key (E52, *read in code*).
- **Keys:** the key restriction refuses, on the server, keys of other organisations or workspaces (E7,
  *tested (unit)*); a *pass*, the server's memory of a positive check, stays valid for up to 15 minutes (E9,
  *tested (unit)*).
- **Gateway:** never run against a real gateway, so not yet a control you can count on (§802; E12,
  *not proven*).
- **Instructions injected through attachments:** while an attached file or e-mail is in the chat, every
  proposed change waits on a review card, except the work breakdown optimisation, which opens its own preview
  (E47, *tested (unit)*). So does a Jira-synced task the chat has read, for the rest of the conversation. Pasted
  text, and outside text with no mark of its origin, such as rows created from an imported file, do not start
  that hold (E48, *tested (unit)*).
- **Installer:** each desktop release carries an SBOM, with attestations only while the repository is public
  (E50, *tested (unit)*); the installer is not code-signed (E51, *tested (unit)*). `AIPM_DISABLE_UPDATE_CHECK`
  switches the desktop update check off (E34, *read in code*).

## Not yet proven / open gaps

1. **Unmarked outside text:** text from outside that carries no mark of its origin, such as rows created from an
   imported file, and a change sent in the same turn as a Jira read, do not start the review hold (E48,
   *tested (unit)*).
2. **§794:** a single chat write applies without the review card (E47, *tested (unit)*).
3. **§487, §793:** the Windows installer is unsigned, and the uninstaller would stay unsigned with signing on
   (E51, *tested (unit)*).
4. **§800:** the policy allows whole host families by wildcard (E34, *read in code*).
5. **§562:** the request limit of the six limited routes, the relay's and dictation's included, is keyed on a header the
   caller can set and counted per server process, so it can be avoided (E54, *read in code*).

## What to check or ask for before saying yes

- On a test deployment, set `ai` and confirm that the page's policy lacks api.anthropic.com and that the relay
  refuses with 503 (E19, *tested (unit)*; E53, *tested (unit)*).
- Attach a mail that carries an instruction and check that a single proposed change waits on the review card;
  put the same text into a synced Jira issue, let the chat read that task, and check that a single ordinary
  write it proposes afterwards waits too (E47, *tested (unit)*; E48, *tested (unit)*).
- Put the app's server behind your own access control: the app does not authenticate callers, and the relay
  adds the gateway token to every call it forwards (E13, *read in code*). The relay refuses a call without an
  origin header and, like the dictation route, limits each caller, but both checks rest on headers a caller can
  set (§562; E54, *read in code*; E69, *tested (unit)*). The dictation route refuses an endpoint whose host name
  resolves to a private address, though DNS rebinding remains (E70, *tested (unit)*).
- For incidents: the activity log names the AI as actor of its chat changes, but no entry links to the chat
  message behind it (§799; E55, *read in code*).
- Ask Anthropic what it retains of a request, for how long, and whether it trains on it.
- Check the SBOM and attestations of the release you install, and tell users about the unknown-publisher
  warning (E50, *tested (unit)*; E51, *tested (unit)*).

## Where to read more

- [Appendix](appendix.md), with the [browser hosts](appendix.md#browser-hosts),
  [server destinations](appendix.md#server-destinations) and
  [deployment switches](appendix.md#deployment-switches).
- The [security model](../../security.md) and the [operating guide](../../RUNBOOK.md).
- [TOM sheet](../../compliance/en/tom-sheet.md) and [vendor touchpoints](../../compliance/en/vendor-touchpoints.md).
- The other briefs: [CEO](ceo.md), [CIO](cio.md), [DPO](dpo.md).
