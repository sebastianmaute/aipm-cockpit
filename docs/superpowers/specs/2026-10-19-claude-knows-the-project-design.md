# Claude knows the whole project — design

Date: 2026-10-19. Owner decision, same day: "ai-project-proposal.ts must know all fields of projects when
creating or updating it later", with the approach "Proposal + update_project".

## Why

The demo's new-project brief says "GDPR erasure", yet the proposal leaves the GDPR box unticked. The cause
is structural, not a model slip: `PROPOSAL_TOOL` (`ai-project-proposal.ts`) offers eight of the project's
fields (name, customer, project manager, products, start and end date, description, Jira URL). The
regulatory requirements, identity types, deployment, sponsor, NACE section, platform, timezone and the
rest have no slot, so nothing Claude reads in a brief can reach them.

After creation it is worse: no chat tool reads or writes the project record. `get_app_state` returns the
date, language, backend and task count; there is no `get_project` and no `update_project`. A user who
tells the assistant "this project is now under NIS2 too" gets nothing done.

## Goals

1. **Creation.** The proposal can fill every project field Claude can reasonably infer from a brief, in
   the same validated form the Step-1 form accepts. GDPR in the brief → the GDPR box ticked.
2. **Later.** The AI Assistant can read the project record (`get_project`) and change it
   (`update_project`), through the same safeguards as the six existing `update_*` tools: a write token,
   the preview card, the activity log, undo.
3. **One field list.** Both tools take their field set and validation from one place, so a field added
   to `ProjectMeta` later is either offered to Claude or excluded with a written reason, and a test fails
   when neither is done (the `tool-input-coverage.test.ts` pattern).

## Non-goals

- Inline "Ask Claude" on the project (the per-item popover): not asked for.
- Changing what the project form shows or validates.
- Portfolio-level edits (several projects at once).

## Anti-goals (a failure even if it works)

- Claude inventing people or contact details. The proposal prompt already says "Do not invent owners or
  emails"; contact persons stay out of both tools (below).
- A model value the form would refuse being stored anyway. Every write goes through the project
  validation the form uses, and a refused field shows on the preview card as refused (the
  preview/apply parity rule in `docs/AGENTS/ai-assistant.md`).
- An update that silently empties a field the model did not mention. Patch semantics: only the fields
  passed change.

## The field list

From `ProjectMeta` (`types.ts`). Offered to Claude (create and update):

| Field | Shape and validation |
|---|---|
| `name`, `code`, `description`, `sponsor`, `projectManager`, `customer`, `products`, `platform`, `profitCenter`, `quotes`, `notes`, `docRepoLocation` | text, the caps `sanitizeProjectMeta` applies |
| `startDate`, `endDate` | ISO date; end not before start (the form's rule) |
| `regulatory` | array of `REGULATORY_REQUIREMENTS` (`project-options.ts`); "Not applicable" alone or not at all |
| `identityTypes` | array of `IDENTITY_TYPES` |
| `deployment` | one of `DEPLOYMENTS`, or blank |
| `naceSection` | a NACE section letter |
| `identityCount`, `stakeholderCount` | non-negative integers |
| `operatingTimezone` | an IANA zone the app accepts |
| `jiraUrl`, `salesforceUrl`, `sharepointUrl`, `confluenceUrl` | `isSafeHttpUrl` (model output is attacker-influenceable) |

Excluded, each with its reason written beside the list:

- `contactPersons`: people with emails, synced from the address book; the "do not invent" rule.
- `keyStakeholdersInternal` / `keyStakeholdersExternal`: superseded by `stakeholderCount` in the form
  (0.74); the stakeholder register is the real list, and the chat already writes it.
- `knowledgeLinks`: SharePoint-backed; Knowledge has its own surfaces.

## Creation (`propose_project`)

- `ProposalMeta` and `PROPOSAL_TOOL.input_schema.properties.meta` gain the offered fields, enums carried
  in the schema (so the model sees the allowed values).
- `proposalToDraftPatch` maps each through the same validation as the form; a value that fails is dropped,
  never stored.
- The system prompt gains one line: infer regulatory requirements, identity types and deployment only from
  what the brief says ("GDPR erasure" → GDPR; a retailer's customers → B2C), never by guess.
- The template suggestion (`template-suggest.ts`) already reads regulatory needs, deployment and scale, so a
  filled proposal also improves the suggested template. No change there.

## Later (`get_project`, `update_project`)

- `get_project`: read-only, returns the offered fields plus the record's write token.
- `update_project`: `{ expectedToken, ...offered fields }`, patch semantics, `required: ["expectedToken"]`.
  The dispatcher merges the patch onto the stored meta and runs `sanitizeProjectMeta`; a refused field is
  kept at its stored value and reported.
- **Write token.** `ai-entity-token.ts` derives tokens from the byte-stable CSV projection of a row. The
  project is one meta record, not a CSV row; the token is derived the same way from the project's own
  serialized projection (the one the storage codecs write), never stamped.
- **Staging.** A lone `update_project` is an ordinary entity write: it applies at once like a lone task
  update, and several writes in one reply stage as a "Proposed changes" card (`shouldStage`). A rename
  (`name`) is shown on the card like any field.
- **Preview.** `chat-proposal-describe.ts` gets a project descriptor: one row per changed field, old → new,
  refused fields marked. `tool-input-coverage.test.ts` covers the new tool's inputs.
- **Activity log and undo.** Logged like the other AI entity writes. Undo captures the meta before the
  write (one field-patch step); see `docs/AGENTS/undo.md` for the capture rules.
- **Scope epoch.** The write is dropped if the project changed between proposal and apply, as every chat
  write is (`dropStaleScopeWrite`).

## Constraints

- No new `Workspace` field and no new write path: the project meta already rides all six storage paths.
- i18n EN + DE for every new string; card labels reuse the form's field labels.
- Size ratchet: `chat-tools.ts` and `chat-tool-defs.ts` are large; the project tools go in their own
  module if either would cross its limit.

## Decided by the owner

- Both halves, creation and update (2026-10-19).

## Left to the builder

- Where the shared field list lives (`project-options.ts` or a new `project-ai-fields.ts`).
- The exact token projection for the meta record, as long as it is derived from content.
- Card wording beyond the reused field labels.

## Tests that must fail first

1. A proposal input carrying `regulatory: ["GDPR / data protection regulation"]` produces a draft with GDPR
   ticked; an unknown regulatory value is dropped.
2. Every `ProjectMeta` key is either in the offered list or in the excluded list with a reason (a new key
   fails until classified).
3. `update_project` with a stale token is refused; with the current token it changes only the passed
   fields; an unsafe URL is refused and the stored value kept.
4. The preview card's rows equal what the write stores (parity), including a refused field.
5. Undo after an AI project update restores the previous meta.

## Re-take after this ships

`ch2-connect`'s prologue: the brief already says "GDPR erasure"; the wizard step after the proposal then
shows GDPR ticked. A caption points at it.
