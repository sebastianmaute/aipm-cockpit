# AI brief for the CISO

## In one paragraph

The AI sends project content to Anthropic, or to the organisation's gateway, from the browser or the app's
server (E4, *tested (unit)*; E5, *tested (unit)*). The model reads text others wrote, such as attached mail,
Jira-synced tasks and Confluence pages picked for a new project, and the chat and the project wizard turn its
answers into changes (E47, *tested (unit)*; E48, *read in code*; E49, *read in code*). The server enforces the
organisation key check and the refusal while AI is off (E7, *tested (unit)*; E19, *tested (unit)*). People
protection runs in the browser, so a modified copy of the app, or another client using the same key, can send
without it (E15, *read in code*).

## What leaves, and who approves it

- **From the browser:** only to the hosts in the page's Content Security Policy, which the server sends and the
  browser enforces; api.anthropic.com is in it only on the direct route with AI on (E53, *tested (unit)*).
  Turso, SharePoint and OneDrive hosts are allowed by wildcard, and so is any local port
  ([browser hosts](appendix.md#browser-hosts); §800; E34, *read in code*).
- **From the server:** the relay forwards four Anthropic headers, plus the gateway token when one is set, and
  no cookies, and logs no key, token, body or URL (E6, *tested (unit)*); the other
  [server destinations](appendix.md#server-destinations) are listed (E34, *read in code*).
- **Keys:** each user's key is stored in the browser as AES-256-GCM ciphertext; loaded for use, it is held in
  plain text in the page's memory (E46, *tested (unit)*).
- **People:** with protection on, known people's names, e-mail addresses and phone numbers are replaced before
  sending (E14, *tested (unit)*); an unknown name is sent as written (E35, *read in code*).
- **Approval in the app:** each user accepts the AI disclosure on each device (E31, *tested (unit)*).

## What you control

- **Kill switch:** `ai` in `AIPM_DISABLED_INTEGRATIONS` makes the relay refuse every call (E19,
  *tested (unit)*) and drops api.anthropic.com from the policy (E53, *tested (unit)*), and the browser sends
  nothing once the server says AI is off (E3, *tested (unit)*). It acts on this deployment only and revokes no
  key (E52, *read in code*).
- **Keys:** the key restriction refuses, on the server, keys of other organisations or workspaces (E7,
  *tested (unit)*); a pass stays valid for up to 15 minutes (E9, *tested (unit)*).
- **Injected instructions:** while an attached file or e-mail is in the chat, every change the model proposes
  waits on a review card; without one, a single ordinary write applies at once (E47, *tested (unit)*). Text the chat reads
  through its tools, such as Jira-synced tasks, does not start that hold (E48, *read in code*). The wizard's
  proposal only fills in a form the user completes (E49, *read in code*).
- **Installer:** each desktop release carries an SBOM, with attestations while the repository is public (E50,
  *read in code*); the installer is not code-signed yet (E51, *read in code*). The desktop update check can be
  switched off with `AIPM_DISABLE_UPDATE_CHECK` (E34, *read in code*).

## Not yet proven / open gaps

1. **§797:** text the chat reads through its tools does not start the review hold (E48, *read in code*).
2. **§794:** a single chat write applies without the review card (E47, *tested (unit)*).
3. **§805:** the relay adds the gateway token for any caller that reaches the server (E13, *read in code*).
4. **§487:** the Windows installer is unsigned, and the uninstaller would stay unsigned with signing on (E51,
   *read in code*).
5. **§800:** the policy allows whole host families by wildcard (E34, *read in code*).

## What to check or ask for before saying yes

- On a test deployment, set `ai` and confirm that the page's policy lacks api.anthropic.com and that the relay
  refuses with 503 (E19, *tested (unit)*; E53, *tested (unit)*).
- Attach a mail that carries an instruction and check that the proposed change waits on the review card; then
  put the same text into a Jira-synced task and see that it does not (E47, *tested (unit)*; E48,
  *read in code*).
- Put the app's server behind your own access control: the relay checks no caller and has no request limit,
  and the other routes' limit is keyed on a header the caller can set (§805, §806, §562; E13, *read in code*;
  E54, *read in code*).
- Check the SBOM and attestations of the release you install, and tell users about the unknown-publisher
  warning (E50, *read in code*; E51, *read in code*).
- Before lifting a forced protection, check each project's setting: each returns to its own (E43,
  *read in code*).

## Where to read more

- [Appendix](appendix.md), with the [browser hosts](appendix.md#browser-hosts),
  [server destinations](appendix.md#server-destinations) and
  [deployment switches](appendix.md#deployment-switches).
- The [security model](../../security.md) and the [operating guide](../../RUNBOOK.md).
- [TOM sheet](../../compliance/en/tom-sheet.md) and [vendor touchpoints](../../compliance/en/vendor-touchpoints.md).
- The other briefs: [CEO](ceo.md), [CIO](cio.md), [DPO](dpo.md).
