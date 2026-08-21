# Help content audit — reconciled findings (slice 1, Tasks 6–8)

**Date:** 2026-08-05
**Method:** 7 read-only reviewers in parallel — 4 partitioned by group, 2 cold (no findings
list), partitions overlapping so every entry got ≥2 independent reads.
**Status of each item below:** `CONFIRMED` = I re-checked the evidence myself. `REPORTED` =
a reviewer's finding I have not yet re-verified; do not apply without checking.

★★★ The plan assumed **two** false entries. The audit found **~35 false claims across ~25 of
the 51 entries**. That is the headline: this is not a touch-up, it is a rewrite of half the
Help system in two languages.

---

## OUT OF SCOPE but higher impact than anything in it

**`aiConsentBullet2` (`i18n.ts:936`, DE `i18n.de.ts:917`) — CONFIRMED FALSE.**
Renders on the AI consent gate (`chat-panel.tsx:880`), so it has more reach than any Help body.

> "Your Anthropic API key is stored **unencrypted** in this browser's localStorage…"

`writeSettings` (`use-settings.ts:32`) blanks `ai.apiKey` before the localStorage write; the key
is sealed AES-256-GCM under a non-extractable device key (`secrets.ts:8-13`), only ciphertext
reaches `localStorage["aipm-cockpit:secrets"]`. The claim *understates* protection, so it is
cautious-wrong rather than dangerous-wrong — but it is security copy on a consent gate and
wording there is the user's call, not mine. **Not changed. Needs a decision.**

---

## CONFIRMED — evidence re-checked by me

| Entry | False claim | Reality |
|---|---|---|
| `feature-ai` | key "stored in this browser's localStorage" | sealed AES-256-GCM in IndexedDB; `use-settings.ts:32` blanks it |
| `feature-tour` | click "Take the tour" at the bottom of this Help menu | `help-menu.tsx` has no tour control; `tourLaunch` (`i18n.ts:2784`) renders **nowhere**. Replay is Help → Guided tours. ★ Marking `[[Take the tour]]` would PASS the gate on a false sentence — the key exists but is dead |
| `concept-change` | statuses "Proposed, then Approved or Rejected, then Implemented or Deferred" | `CHANGE_STATUSES` has **six**; "Under Review" omitted (`types.ts:305-307`) |
| `concept-change` | "impact rating that feeds the Scope RAG" | `computeScopeStatus` counts pending changes only, never reads impact (`change-log.ts:87-95`) |
| `concept-steering` | "push those meetings directly to participants' Outlook calendars" | zero `attendee` references in `outlook-calendar-write.ts`; writes to the signed-in user's own calendar |
| `concept-baseline` | "Snapshots are stored automatically; the Trends view (available on Turso)…" | the Turso gate is on the **snapshots**, not the view — `use-snapshots.ts:154` returns early unless `active`. Off Turso **nothing is captured**, so a file-backend user is told they have baselines they do not have |
| `workflow-risk` | "an action (mitigate, accept, or escalate)" | no such field; `RaidItem` has free-text `mitigation` only |
| `workflow-risk` | "RAID items automatically affect the Scope or Schedule RAG" | `dashboard.ts:406-407` — RAID feeds `topRaid` + `openRaidCount` and **no RAG at all** |
| `workflow-stakeholders` | RACI "for each key task or deliverable" | `raci` is keyed by milestoneId (`types.ts:373-374`); no task-level RACI |
| `feature-resources` | "across four sub-tabs" | five children incl. `manage-roles` (`nav-config.ts:70-79`) |
| `feature-templates` | manage templates "(rename, duplicate, delete)" | `templatesDuplicate` has **no render site**; only rename + delete exist |
| `feature-tasks` | long notes collapse, click "Show more" | `showMore` renders only in `scheduled-jobs-section.tsx`; the description cell is a non-expandable truncated preview |
| `feature-task-status` | "Table / Board toggle" | three modes — Table / Board / **Swimlanes** (`i18n.ts:124-126`) |

## REPORTED — corroborated by ≥2 reviewers, not yet re-verified by me

- `concept-stakeholder` — matrix is **not** in the Stakeholders view (that is a table); the grid is the separate `stakeholder-map` view. Axis is **Influence**, never "power".
- `workflow-budget` — SPI/CPI come from **tasks** (`evm.ts:27-47`), not from budget buckets; and the Budget view records **hours**, not costs. Both halves of the sentence wrong.
- `automated-health` — Scope health comes from the **change register**, which the sentence's source list omits.
- `feature-layout` — the full-page task edit view was **retired**; the editor is a floating modal in every layout. Nav list is stale and names "Chat" for a view labelled "AI Assistant".
- `feature-rich-text` — "Settings → Appearance" is wrong; `selfResourceId` lives in **General**.
- `feature-storage` — "SharePoint backends are coming soon" — both ship (`sp-json`, `sp-csv`); Turso is unmentioned entirely.
- `feature-notif` — the due-task **banner was removed**; the bell navigates to Next actions and its badge is a now-tier count, not unread.
- `feature-keys` / `feature-add` — the header `+` exists only in **Classic**; modern's `primaryAction` slot has no caller.
- `feature-workspace` / `feature-tabs` — describe the **Classic** tab strip as current behaviour; Budget tab missing from the list.
- `feature-gantt` — clicking a bar does **not** open the editor (drag-only; a no-move press is discarded); left-edge drag unmentioned; weekends tinted in the header, not the body.
- `feature-jira`, `feature-add` — "Notes" no longer names the field; `Task.notes` → `Task.description`.
- `feature-activity` — log covers far more than "task, RAID, absence, and shift".
- `feature-setup-wizard` — the wizard does **not** contain the storage picker.
- `feature-ai` — claims filter-awareness on four views; `view-ai-digest.ts:97-104` says only Open Points is filter-aware, and the digests were written to avoid exactly this overclaim.
- `feature-usage-limits` — "Settings → AI" (rail reads "AI Assistant"); "steps" (control says "turns").

## Single-reviewer, lower confidence

- `workflow-plan` — "must finish before others can start" describes FS only; all four link types exist.
- `concept-dependency` — same shape: the definition covers FS/SS but the entry then names FF and SF.
- `automated-tracking` — "Every change … captured"; `ActivityKind` is a closed union missing note-log and knowledge kinds.
- `concept-raid` — "each entry carries a severity"; `severity` is optional.
- `concept-knowledge` — SharePoint option is gated on the M365 integration.

---

## Marker (`[[label]]`) decisions

★★ Three phrases look like labels but would **fail** the exact-match gate — reword before
marking, or leave unmarked:

- `"Also create in Jira"` → actual value is `"Also create this in Jira ({0} — {1})"`.
- `"Version history: keep N versions"` → split across `versionRetentionLabel` + `versionRetentionUnit`.
- `"Take the tour"` → matches `tourLaunch`, but that key renders on no control. **The gate would
  go green on a false sentence.** This is the concrete case proving the gate checks structure,
  not truth.

★★ Reverse trap — prose that must stay quoted: `"days ahead"`, `"world clock"`,
`"what I am looking at"`, `"caused by"`, `"information schedule"`.

★ Near-misses to avoid: `"internal/d"` (real: `"Internal /d"`), `"Blank"` (real: `"Blank —
choose functions yourself"`), `"Reset size"` (icon button, no visible text).

---

## Cross-cutting causes worth recording

1. **Stale in-code comments feed stale help.** `resources-panel.tsx:10` still says "30-day
   grid"; the removed "Action Center" name survives in eight `versionHighlight*` strings and is
   where authors keep re-picking it up.
2. **Three failures share one shape** — the body describes a plausible mechanism the code does
   not implement (change impact → Scope RAG, steering → participants' calendars, baseline →
   automatic storage). None names a symbol, so `docs:symbols:check` is structurally blind to
   all three, and so is the new gate.
