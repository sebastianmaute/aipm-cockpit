# Log a signal as a RAID item, and record escalations on the item — design

**Register:** §515 · **Work item:** GitLab #55 (R-1, source::demo-2026-09-11)
**Branch:** `feat/raid-signal-log-escalation` · **Date:** 2026-09-13

## Problem

Demo stakeholders asked that risks and issues surface early through insights or an explicit RAID
workflow, ranked second after financials. Two gaps remain:

1. **No direct signal → RAID path.** An insight can only produce a RAID item through its AI
   recommendation (`create_raid_item` inside `ALLOWED_REC_TOOLS`), which needs AI on, a generate
   step and the review modal. Next actions offer "Create task" but nothing for RAID.
2. **An escalation leaves no record on the item.** `handleEscalate`
   (`use-action-center-handlers.ts`) raises severity for I/A/D items via `applyEscalation`, then opens
   a `mailto:`. Recipient and time are not stored anywhere, and nothing is written to the activity log.

## Decisions (agreed 2026-09-13)

| Question | Decision |
|---|---|
| Escalation record | BOTH a structured field (source of truth) and a note-log echo |
| Sources | Insights (dashboard tile + Insights view) AND next actions |
| Editor | Existing `RaidEditModal`, floated over the current view (no view switch) |
| Effect on the insight | On Save: `status: "acted"` + `loggedRaidId` link; Cancel changes nothing |

Rejected: jumping to the RAID view with a create nonce (loses the signal context; the RAID panel is
always mounted, so the request needs explicit consume/clear); creating directly with a toast
(unreviewed writes, and the undo engine cannot reverse a create).

## Part 1 — Log as RAID

### `raid-draft.ts` (new, pure, i18n-free)

- Move verbatim from `raid-panel.tsx`: the `openNew` default draft as
  `buildNewRaidDraft(raid, category)`, plus `applyStatus(draft, status, today)` and
  `applyMatrix(draft, probability, impact)`. `raid-panel.tsx` calls them; behaviour unchanged.
- `buildRaidSeedFromSignal(input)` → `{ title, description }`. It is the RAID counterpart of
  `action-task-seed.ts:buildTaskSeedFromAction`. The caller passes already-translated strings, so the
  module stays i18n-free. The description is `From: <source> — <why>` HTML, passed through
  `sanitizeRichText`.

### `raid-create-host.tsx` (new, mounted in `task-manager.tsx`)

- Owns `{ draft: RaidItem; origin: { kind: "insight"; insightId: number } | { kind: "action"; action: SuggestedAction } } | null`.
- Opens with `buildNewRaidDraft(raid, "R")` merged with the seed. The category select in the modal
  lets the user switch to Issue.
- Renders `RaidEditModal` with `isNew={true}`:
  - `onSave(item)` → `handleSaveRaidItem(item, true)`; when it returns an id, run the origin's
    on-saved effect, then close.
  - `onCancel` → close, no side effects.
  - `onDelete` / `onCreateMitigationTask` → no-ops (new item).
  - `onOpenNotes` omitted (the modal already disables Notes on a new draft).
  - `onJumpToRaid(id)` → `requestOpen("raid", id)`.
- Not rendered in popouts (`isPopout` → the openers are `undefined`, as for every action CTA).

### `handleSaveRaidItem` returns the committed id

`use-resource-planner.ts:handleSaveRaidItem` returns the id from `resolveEntitySave` (re-minted when the
open-time id was taken), or `undefined` when the save is refused (`editVanished`). Existing callers
ignore the return. The pane contract type in `workspace-section-types.ts` widens its return type from
`void` to `number | undefined`, which stays assignable.

### Entry points

- **Insights:** a new optional `InsightActions.onLogAsRaid(insight)`. A "Log as RAID" button beside
  Act on `dashboard-sections/insights-card.tsx:InsightsCard` and `insights-panel.tsx:InsightsPanel`.
  - Hidden for `raidAging`, which is already about a RAID item.
  - Hidden when `loggedRaidId` is set. The card shows "Logged as #N" with Open instead
    (`requestOpen("raid", N)`).
  - Accessible name is row-unique: `"Log as RAID – <insight sentence>"`.
- **Next actions:** `next-actions/action-cta.ts:canLogAsRaid(action, caps)` =
  `caps.logAsRaid && action.source !== "raid"`. It is an overflow item in `ActionOverflowMenu`
  (`action-cta-controls.tsx`), shown on both the row and the hero. `useActionCaps` gains `logAsRaid`.

### On-saved effects

- **Insight origin:** set `status: "acted"`, `actedAt: today`, `loggedRaidId: id` through the same
  writer as the existing Act action (`task-manager.tsx`). The first transition to `acted` then captures
  `metricAtAction`, exactly as Act does.
- **Action origin:** `recordLearning(action, "acted")`.

### `Insight.loggedRaidId?: number`

- `insights/insight.ts`: the new optional field.
- `insights/sanitize-insights.ts`: accept a positive integer, drop anything else.
- `insights/reconcile.ts`: carry the field forward (beside `actedAt`) and include it in the change
  comparison. Otherwise reconcile silently drops it, or treats a changed link as no change.
- Insights are a meta-blob, so the field rides every write path with no column change.

## Part 2 — Escalation record

### Type (`types.ts`)

```ts
export type RaidEscalation = {
  at: string;                // ISO timestamp
  toName?: string;
  toEmail: string;
  toResourceId?: number;
  fromSeverity?: RaidSeverity;
  toSeverity?: RaidSeverity; // absent = notify-only (Risk, or already Critical / no severity)
};
// RaidItem.escalations?: RaidEscalation[]
```

**Precedent:** `RaidItem.inquiriesSent` is the same kind of record on the same entity. `escalations`
copies its codec, sanitizer and column handling. The plan confirms each site by grep before copying.

### Write (`handleEscalate`)

- New pure `action-escalate.ts:buildEscalationRecord(item, plan, recipient, at, noteText)` → next
  `RaidItem`. It:
  - applies `severity: plan.to` when the plan raises it;
  - appends the `RaidEscalation`;
  - appends a note via `note-log.ts:addNote`;
  - stamps `localModifiedAt`.
- The note text is translated by the caller, once, in the writer's language. For example:
  `Escalated to Jane Doe <jane@example.com>: severity High → Critical`, or `… (notify only)`.
- `handleEscalate` applies the record with ONE functional `setRaid(prev => prev.map(…))`. That also
  fixes today's closure read of `raid`, which loses a same-tick concurrent write.
- Log the activity as `raid.escalated`. Its changes carry severity from/to only, never the email.
- Then build the mail and assign the `mailto:` URL as today, then call `recordLearning`.

### Display

- RAID table column **"Last escalated"** (date and recipient name):
  - registered in `raid-panel-columns.ts`;
  - hidden by default;
  - sortable through `SortResizeTh`.
- `RaidEditModal`: a read-only **Escalations** list, rendered only when non-empty.
- No new interactive primitives. Nothing is hand-rolled.

### AI boundary

> **Amended 2026-09-13 (user decision).** This section originally made `escalations` model-read-only.
> The user decided the assistant may record an escalation, append-only. The raw field stays
> model-unwritable; the plan records this as deviations 17–19 and implements it as Task 3b.

- The raw field stays model-unwritable: `RAID_FIELD_GUARDS.escalations` (`sanitize-records.ts`) drops
  `escalations` from `create_raid_item` / `update_raid_item` input, so the model can never edit or delete
  an existing entry.
- The model CAN append: a dedicated `escalate_raid_item` tool (`id`, `expectedToken`, `toEmail`, `toName?`)
  records exactly one escalation with the same effects as the Escalate button minus the e-mail:
  - the `RaidEscalation` entry, the note-log echo in the project language, the severity step from the same
    `planEscalation`, and a `raid.escalated` activity entry (actor `ai`, severity step only);
  - one functional RAID write through the same pure builders as `handleEscalate`, with undo capture;
  - no mail is sent and no address enters the activity entry; the tool result says `emailSent: false`.
- **Note author: "AI created".** The note stores the literal `authorName` "AI created" (DE "Von KI erstellt",
  i18n `raidNoteAuthorAi`), translated once at write time, and NO `authorResourceId` — it is never attributed
  to `settings.selfResourceId`. `addNote` keeps an explicit `authorName` without a self id for this.
- The recipient is validated at the tool boundary (valid e-mail, stored-record length caps). A directory
  resource is linked by a unique e-mail match; the tool takes no resource id.
- The concurrency token is required (both written fields are token-covered). It also refuses a second
  escalation made from the same read.
- **Review flow:** one AI escalation applies immediately and is undoable; two or more in one turn go to the
  existing review card (the existing bulk-write rule).
- Insight recommendations cannot propose it (`ALLOWED_REC_TOOLS` unchanged).

### Out of scope

- An Escalate control inside the RAID modal or table.
- Escalations in DOCX, PPTX or XLSX exports, or in reports.
- Guardrail-insight gaps §360 and §362.
- The AI sending or drafting the escalation e-mail, or editing/removing escalation entries.
- Insight recommendations proposing an escalation.
- A before/after diff for `escalate_raid_item` on the staged review card (the row shows the tool name, like
  `send_inquiry`).

## Part 3 — Persistence, testing, delivery

### Persistence (AGENTS.md "New COLUMN on existing entity")

| Site | Change |
|---|---|
| `csv-codecs-core.ts` | `RAID_CSV_COLUMNS` + field-to-string / build-from-object. Covers CSV, Turso single and Turso tenant (DDL and INSERT derive from it). |
| `turso-migrate.ts` | Nothing to write. It adds the missing column to existing databases. |
| `markdown-columns.ts` / `markdown-codecs-core.ts` | `RAID_MD_COLUMNS` entry and codec, following `inquiriesSent`. |
| `sanitize-records.ts` | `sanitizeRaidItem` builds `escalations` from validated entries. |
| `template-apply.ts` | Strips `escalations` from template-applied items. |
| `sample-workspace-small.json` | One escalated item. `-big` / `-huge` regenerated with `scripts/generate-sample-workspace.ts`. |
| `__fixtures__/golden-*` | Regenerated. The column change is a real format change. |

The plan lists all six write paths (JSON · CSV · Markdown · Turso single · Turso tenant · IndexedDB) by
name, together with the test that pins each one.

### Tests (TDD; subagent-driven)

- **Pure units:**
  - `raid-draft.ts` output equals the panel's pre-extraction output;
  - `buildRaidSeedFromSignal`;
  - `buildEscalationRecord` (raised, notify-only, note appended, and existing `noteLog` preserved);
  - `canLogAsRaid`;
  - `loggedRaidId` sanitize and reconcile carry and compare.
- **Hook and component:**
  - The host saves with `isNew=true`.
  - The insight changes on Save and never on Cancel.
  - **id-mint race seeded explicitly:** the open-time id is taken before Save, and `loggedRaidId`
    must equal the re-minted id.
  - Escalate is safe with a concurrent same-tick write.
  - The model cannot write, clear or rewrite `escalations` through create/update (positive control: the
    same call's title change lands).
  - `escalate_raid_item` appends entry + note + activity + severity step; notify-only for Critical and Risk;
    an invalid recipient is refused with a model-facing error; no token / a stale token / a second call from
    the same read is refused; a same-tick human edit survives; the activity args never carry the address.
  - The AI note's author is "AI created" (EN) and "Von KI erstellt" (DE, after `loadI18n("de")`), rendered
    by `authorLabel`, with no `authorResourceId` even when `settings.selfResourceId` is set.
  - Review flow: one `escalate_raid_item` does not stage and is undo-captured; two stage.
  - "Log as RAID" is absent for `raidAging`, absent in popouts, and has row-unique names.
- **Mutation proof, count reported:** the reconcile carry, the functional setter (human and AI), the AI
  guard drop, the append-only record, the shared severity plan, the escalation token, and the `raidAging`
  hide.
- **Gates, end of branch only:**
  - `npx tsc --noEmit`
  - `npx eslint --max-warnings=0 src`
  - the touched vitest files (`--maxWorkers=1 --reporter=dot`)
  - `docs:symbols:check`
  - `size:check`
  - `dup:check`
  - the golden and codec tests
- An axe run (`-g` Insights / Dashboard / RAID, `--workers=1`) happens only on the user's say.
- No full suite without the user's say.
- **i18n:** new EN keys. DE keys are written with a Node UTF-8 write, never the Edit tool.

### Delivery

- This spec is the branch's first commit.
- §515 closes in the branch: heading suffix, anchor, index row, Status, and the Work item line removed.
  Issue #55 closes at merge.
- Any follow-up filed from review takes the next free number on `origin/main` together with its issue
  and Work item line, so `followups:workitems:check` stays green.
- The CHANGELOG entry lands in the next release, together with the owed !480 / !481 entry.
