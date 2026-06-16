# Action Escalate — design spec

**Roadmap:** Execution-depth slice 4 ("From Reports → Next-Best-Action"). Follows
create-task (0.84.0 "Cherryh", MR !58), assign-owner (0.86.0 "Hamilton", MR !60),
draft-message (0.87.0 "Wells", MR !61). Comm-templates SP1–SP4 (0.88–0.91) were a
detour off slice 3's draft-message send path; this resumes the main line.

**Goal:** An "Escalate" CTA on at-risk RAID rows (severity action, owner present) that,
in one confirm popover, **raises the item's severity one level** (Issue/Assumption/
Dependency only) **and** opens a prefilled escalation **mailto** to a chosen recipient.

**Architecture:** Surface-only — the `next-actions/` engine is untouched, exactly like
the prior three slices. Severity is an **existing** `RaidItem` field, so there is **no
new persisted field and no 6-write-paths concern**. Reuses `ResourcePicker` (from
assign-owner) and `buildMailtoUrl` (from draft-message, `mailto.ts`).

## Decisions (locked in brainstorming)

| Question | Decision |
|----------|----------|
| What does Escalate do? | **Hybrid** — raise severity **and** notify |
| Which rows? | **RAID rows only** (the canonical escalation target) |
| Risk rows (matrix-derived severity)? | **Notify-only** — don't fight the prob×impact matrix; I/A/D raise severity + notify |
| Notify recipient source? | **Prompt via ResourcePicker** — pick/enter each time, zero new persisted state |
| Notify mechanism? | **mailto** (`buildMailtoUrl`) — escalation isn't a template; stay local-first like draft-message |
| Confirm UX? | **Single confirm popover** — severity-raise preview + ResourcePicker + Escalate button; confirm does both |
| Audit field? | **None** — severity bump + the sent mail are the record |

## 1. CTA gate (`action-row.tsx`)

The RAID provider (`next-actions/providers/raid.ts`) emits, for non-terminal items with
severity RAG "R"/"A":
- `why.key === "actionRaidWhySeverity"` when the item **has an owner**, or
- `why.key === "actionRaidWhyNoOwner"` when it does **not** (already assign-owner's target).

Review-due nudges use `actionRaidWhyReviewOverdue` / `actionRaidWhyReviewStale`.

Escalate therefore targets **only** the has-owner severity rows:

```ts
const canEscalate =
  escalate != null &&
  action.source === "raid" &&
  action.why.key === "actionRaidWhySeverity" &&
  action.cta.kind === "open";
```

This keeps the CTAs non-overlapping: no-owner rows show **Assign owner**, has-owner
at-risk rows show **Escalate**, review-due rows show neither. A new "Escalate" button
opens `EscalatePopover`. The popover component is **extracted** (not inlined like
assign-owner) to keep `action-row.tsx` manageable.

## 2. Pure logic — `src/app/action-escalate.ts` (no i18n except the mail builder)

Severity order is `RAID_SEVERITIES = ["Low", "Medium", "High", "Critical"]` (`types.ts`).

```ts
export type EscalationPlan = {
  raisesSeverity: boolean;
  from?: RaidSeverity;
  to?: RaidSeverity;
  reason?: "risk" | "max"; // why severity is NOT raised
};

// Next level up, or null at Critical.
export function nextSeverity(s: RaidSeverity): RaidSeverity | null;

// Risk category -> {raisesSeverity:false, reason:"risk"}.
// Critical I/A/D    -> {raisesSeverity:false, reason:"max"}.
// Else              -> {raisesSeverity:true, from, to:nextSeverity(from)}.
export function planEscalation(item: RaidItem): EscalationPlan;

// Immutable; returns same array ref when no item matches or `to` is undefined.
export function applyEscalation(
  raid: readonly RaidItem[], id: number, to: RaidSeverity,
): RaidItem[];

// Pure (uses `t`), testable. Subject: "Escalation: RAID {id} — {title}".
// Body: severity-change line (omitted when notify-only) + the why text + project name.
export function buildEscalationMail(
  lang: Lang, item: RaidItem, plan: EscalationPlan, projectName: string,
): { subject: string; body: string };
```

Severity for an escalate row is always High or Critical (only those produce RAG "R"/"A"
that fires a severity action), but `nextSeverity` stays general. `item.category === "R"`
identifies Risks.

## 3. EscalatePopover — `src/app/escalate-popover.tsx`

`role="dialog"` mirroring the assign-owner a11y pattern already in `action-row.tsx`:
focus the first focusable on open, close on Escape via a **document-level** keydown
listener (robust when ResourcePicker swallows Escape), `stopPropagation` on the dialog so
row-click doesn't fire.

Contents:
- **Severity preview line:**
  - `raisesSeverity` → `actionEscalateRaiseSeverity` with params `[from, to]`
    → "Raise severity: High → Critical".
  - `reason === "risk"` → `actionEscalateNotifyOnlyRisk` ("Risk severity follows the matrix — notify only").
  - `reason === "max"` → `actionEscalateNotifyOnlyMax` ("Already Critical — notify only").
- **ResourcePicker** (`resources`, `onCreateResource` from the bundle; `contacts={[]}`)
  → writes the chosen `{ name, email, resourceId }` into local component state.
- **Escalate** confirm button (`actionEscalateConfirm`), **disabled until** a recipient
  with a valid email is chosen (`isValidEmail`). On click → `onEscalate(action, recipient)`
  then close.

The popover derives its preview by looking up the item from `bundle.raid` via
`action.cta.id` and calling `planEscalation`; the handler re-derives authoritatively
(single source of truth = `planEscalation`).

Accessible name: the confirm button has a text label; the dialog has `aria-label`
(`actionEscalateTitle`); ResourcePicker is already labeled. Palette: only sanctioned
tokens, no off-palette shadows.

## 4. Data flow — `EscalateBundle`

Mirrors `AssignOwnerBundle` in `action-row.tsx`:

```ts
export interface EscalateBundle {
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
  raid: readonly RaidItem[];
  onEscalate: (
    action: SuggestedAction,
    recipient: { name: string; email: string; resourceId: number | null },
  ) => void;
}
```

Threaded **task-manager → workspaceProps → workspace-section → ActionsPanel → ActionRow
→ EscalatePopover**, gated `!isPopout` (same as the other CTAs; `ActionsPanel` renders in
`workspace-section.tsx`, not `task-manager.tsx`).

Handler in `task-manager.tsx`:

```ts
const handleEscalate = (action, recipient) => {
  if (action.cta.kind !== "open") return;
  const item = raid.find((r) => r.id === action.cta.id);
  if (!item) return;                                   // deleted-source safe
  const plan = planEscalation(item);
  if (plan.to) {
    // persist via the SAME RAID update path assign-owner uses (existing serializers
    // already cover `severity` — no new write path)
    <updateRaid>(applyEscalation(raid, item.id, plan.to));
  }
  if (!isValidEmail(recipient.email)) { window.alert(t(lang, "errorInvalidEmail")); return; }
  const { subject, body } = buildEscalationMail(lang, item, plan, projectName);
  window.location.href = buildMailtoUrl(recipient.email, subject, body);
};
```

The exact RAID setter (`updateRaid`/dispatch) is the one assign-owner's `onAssign`
already uses to mutate a RAID item — the implementation plan pins the call site.

## 5. Error handling / edge cases

- **Invalid/empty recipient email** → `window.alert(errorInvalidEmail)` (existing key),
  no mailto. The confirm button is already disabled until valid, so this is defense in depth.
- **Deleted source item** (`find` miss) → no-op (no mutation, no mailto).
- **mailto is fire-and-forget** (no success callback) — consistent with draft-message;
  the action persists (computed; auto-dismiss is the deferred loop layer).
- **Already-Critical I/A/D or any Risk** → severity untouched, notify-only; the popover
  shows the reason so the user isn't surprised.

## 6. Testing

- `action-escalate.test.ts`:
  - `nextSeverity` — each level steps up; Critical → null.
  - `planEscalation` — Risk → notify-only(reason:"risk"); Critical I/A/D → notify-only
    (reason:"max"); High I/A/D → raises to Critical; Medium I/A/D → raises to High.
  - `applyEscalation` — raises the matched item immutably; **same array ref** when id
    missing; other items untouched.
  - `buildEscalationMail` — subject/body shape; severity line present when raising and
    **absent** when notify-only; renders in EN **and** DE.
- `escalate-popover.test.tsx`:
  - Renders each preview variant (raise / risk / max).
  - Confirm button disabled until a valid-email recipient is chosen; enabled after.
  - Clicking Escalate fires `onEscalate` with the chosen recipient, then closes.
- i18n EN/DE key parity (tsc-enforced); `i18n-encoding` test passes (DE umlauts via node
  CRLF write, never the Edit tool).

## 7. New i18n keys (EN + DE)

| Key | Params | EN (sketch) |
|-----|--------|-------------|
| `actionEscalate` | — | "Escalate" (row button) |
| `actionEscalateTitle` | — | "Escalate" (dialog label) |
| `actionEscalateRaiseSeverity` | `{0}` from, `{1}` to | "Raise severity: {0} → {1}" |
| `actionEscalateNotifyOnlyRisk` | — | "Risk severity follows the matrix — notify only" |
| `actionEscalateNotifyOnlyMax` | — | "Already Critical — notify only" |
| `actionEscalateConfirm` | — | "Escalate" (confirm button) |
| `actionEscalateRecipient` | — | "Notify" (picker label) |
| `escalateMailSubject` | `{0}` id, `{1}` title | "Escalation: RAID {0} — {1}" |
| `escalateMailBody` | `{0}` id, `{1}` title, `{2}` severity line, `{3}` why, `{4}` project | multi-line escalation body |

Interpolation is 0-based positional (`{0}`/`{1}`).

## Out of scope (explicit)

- Re-baseline / loop-learning / push-notification slices (later roadmap entries).
- Graph / comm-send send modes — **mailto only** for escalation.
- Escalation audit trail (`escalatedAt`, history of who escalated when).
- Manager-hierarchy auto-resolution (no reporting line in the data model).
- Milestone / schedule / budget escalation (no single entity / severity field).
- Bumping the Risk impact axis (decided against — keeps the matrix as source of truth).

## Process notes (apply during implementation)

- **Final whole-branch review is mandatory** — for the prior three slices it caught
  cross-cutting gaps (recipient validation, untested dispatcher paths) that per-task
  spec+quality reviews missed.
- Re-check imports after every extract/refactor — CI runs `--max-warnings=0`; an unused
  import is fatal.
- DE strings via node UTF-8 CRLF write; verify with the encoding test. Never edit
  `i18n.de.ts` with the Edit tool (corrupts umlauts + curls quotes).
- Releasing: bump `version.ts` (APP_VERSION + milestone), CHANGELOG entry, append the new
  `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE).
