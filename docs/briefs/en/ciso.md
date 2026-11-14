# AI brief for the CISO

## In one paragraph

The AI sends project content to Anthropic, or to the organisation's gateway, from the browser or the app's
server (E4, *tested (unit)*; E5, *tested (unit)*). The model reads text others wrote, such as attached mail,
Jira-synced tasks and Confluence pages picked for a new project; the chat turns its answers into changes, while
the project wizard only pre-fills a form (E47, *tested (unit)*; E49, *read in code*). On the relay route the
server enforces the key check and the AI-off refusal (E7, *tested (unit)*; E19, *tested (unit)*); on the direct
route AI-off is the page's content policy and the app's own check, both applied by the browser (E53,
*tested (unit)*; E3, *tested (unit)*), so a modified copy or another client with the same key is not stopped.
People protection also runs in the browser, with the same limit (E15, *read in code*).

## What leaves, and who approves it

- **From the browser:** only to the hosts in the page's Content Security Policy, which the server sends and the
  browser enforces; api.anthropic.com is in it only on the direct route with AI on (E53, *tested (unit)*).
  Turso, SharePoint and OneDrive hosts are allowed by wildcard, and so is any local port
  ([browser hosts](appendix.md#browser-hosts); §800; E34, *read in code*).
- **From the server:** the relay forwards four Anthropic headers, plus the gateway token when one is set, and
  no cookies, and logs no key, token, body or URL (E6, *tested (unit)*); the other
  [server destinations](appendix.md#server-destinations) are listed (E34, *read in code*).
- **Keys:** each user's key is stored encrypted in the browser; loaded for use, it is held in plain text in the
  page's memory (E46, *tested (unit)*).
- **People:** with protection on, known people's names and every e-mail address, valid IBAN and phone-shaped number
  are replaced before sending, but an unknown name is sent as written (E14, *tested (unit)*; E35,
  *read in code*).

## What you control

- **Kill switch:** `ai` in `AIPM_DISABLED_INTEGRATIONS` makes the relay refuse every call (E19,
  *tested (unit)*) and drops api.anthropic.com from the policy (E53, *tested (unit)*); it acts on this
  deployment only and revokes no key (E52, *read in code*).
- **Keys:** the key restriction refuses, on the server, keys of other organisations or workspaces (E7,
  *tested (unit)*); a pass stays valid for up to 15 minutes (E9, *tested (unit)*).
- **Injected instructions:** while an attached file or e-mail is in the chat, every proposed change waits on a
  review card, except the work breakdown optimisation, which opens its own preview (E47, *tested (unit)*).
  Pasted text, and text the chat reads through its tools such as Jira-synced tasks, do not start that hold
  (E48, *read in code*).
- **Installer:** each desktop release carries an SBOM (E50, *read in code*); the installer is not code-signed
  (E51, *read in code*). `AIPM_DISABLE_UPDATE_CHECK` switches the desktop update check off (E34,
  *read in code*).

## Not yet proven / open gaps

1. **§797:** text the chat reads through its tools does not start the review hold (E48, *read in code*).
2. **§794:** a single chat write applies without the review card (E47, *tested (unit)*).
3. **§805:** the relay adds the gateway token for any caller that reaches the server (E13, *read in code*).
4. **§487, §793:** the Windows installer is unsigned, and the uninstaller would stay unsigned with signing on
   (E51, *read in code*).
5. **§800:** the policy allows whole host families by wildcard (E34, *read in code*).

## What to check or ask for before saying yes

- On a test deployment, set `ai` and confirm that the page's policy lacks api.anthropic.com and that the relay
  refuses with 503 (E19, *tested (unit)*; E53, *tested (unit)*).
- Attach a mail that carries an instruction and check that a single proposed change waits on the review card.
  Then put the same text into a synced Jira issue's description and see that a single ordinary write it
  prompts applies at once; destructive or inviting proposals wait either way (E47, *tested (unit)*; E48,
  *read in code*).
- Put the app's server behind your own access control: the relay checks no caller and has no request limit,
  and the other routes' limit is keyed on a header the caller can set (§805, §806, §562; E13, *read in code*;
  E54, *read in code*).
- Check the SBOM and attestations of the release you install, and tell users about the unknown-publisher
  warning (E50, *read in code*; E51, *read in code*).

## Where to read more

- [Appendix](appendix.md), with the [browser hosts](appendix.md#browser-hosts),
  [server destinations](appendix.md#server-destinations) and
  [deployment switches](appendix.md#deployment-switches).
- The [security model](../../security.md) and the [operating guide](../../RUNBOOK.md).
- [TOM sheet](../../compliance/en/tom-sheet.md) and [vendor touchpoints](../../compliance/en/vendor-touchpoints.md).
- The other briefs: [CEO](ceo.md), [CIO](cio.md), [DPO](dpo.md).
