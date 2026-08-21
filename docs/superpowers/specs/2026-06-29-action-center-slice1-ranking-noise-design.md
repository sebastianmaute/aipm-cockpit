# Action Center Roadmap — Slice 1: Ranking & Noise Control — Design

**Date:** 2026-06-29
**Status:** Approved (design)
**Roadmap position:** Slice 1 of 4 (Ranking/noise → Layout → New providers → Inline CTAs)

## Problem

The Action Center surfaces too much noise. The engine dedupes by signal id
(`${source}:${entityId}:${reason}`), so a single task that is overdue **and**
blocking a milestone **and** has no owner produces three separate rows that
compete in the list. There is no cap on visible rows, so a large project floods
the `now`/`soon` tiers and burying what matters.

Slice 1 attacks the **too noisy** pain only. Layout polish, new CTAs, and new
signal providers are later slices.

## Goals

1. Collapse multiple signals on the same entity into **one row per entity**.
2. Cap the visible `now` and `soon` tiers with a show-more expander.
3. Do all of the above without touching the learning, notifications, or
   AI-analysis pipelines, and without retuning tier thresholds.

## Non-Goals (explicit out-of-scope for slice 1)

- TIER threshold retune (`TIER_NOW=60` / `TIER_SOON=30` stay; grouping already
  cuts row count, and retuning risks the many tier-pinning tests).
- `DashboardTopActions` grouping (panel-only this slice; the dashboard top-actions
  list stays flat — a minor, accepted inconsistency, candidate for a follow-up).
- Inline expansion UI for the "+N more reasons" line (slice 2 — Layout).
- New CTAs / one-click resolutions (slice 3).
- New signal providers (slice 4).

## Architecture

**Key decision: grouping is a presentation concern layered on the flat scored
list.** `computeNextActions(input)` stays flat and unchanged. The learning store
(keys off `${source}:${why.key}`), desktop notifications, and the AI-analysis
input all keep consuming the flat per-signal `SuggestedAction[]` — they want
per-signal granularity. Only the Action Center surface (`ActionsPanel`) switches
to grouped rendering. Blast radius is the panel + one new pure module + the row
component's reason-count line.

### New pure module: `src/app/next-actions/group.ts`

i18n-free, fully unit-tested. One-way dependency (consumes `types.ts` only).

```ts
import type { SuggestedAction, ActionTier } from "./types";

export interface ActionGroup {
  /** `${cta.view}:${cta.id}` when primary's CTA opens an entity; else the
   *  primary action's own id (such groups never merge with anything). */
  key: string;
  /** Highest-scoring action in the group. */
  primary: SuggestedAction;
  /** The remaining actions for this entity, score desc then id asc. */
  extra: readonly SuggestedAction[];
  /** = primary.score (max wins — an entity shows at its most-urgent signal). */
  score: number;
  /** = primary.tier. */
  tier: ActionTier;
}

export function groupNextActions(
  actions: readonly SuggestedAction[],
): ActionGroup[];
```

**Grouping rule:**

- Group key: if `action.cta.kind === "open"` → `${action.cta.view}:${action.cta.id}`.
  Otherwise (snooze-only / non-open) → `action.id` (these never merge).
- Within a group: sort members score desc, id asc. `primary` = first; `extra` =
  the rest.
- `score` / `tier` = the primary's (the max — an entity with one `now` signal
  and one `soon` signal collapses into the `now` tier).
- Groups sorted score desc, then `key` asc for determinism.
- Input is already deduped and dismissed-filtered by the engine; `groupNextActions`
  does no further filtering.

### Surface: `src/app/actions-panel.tsx`

- Compute `groups = groupNextActions(actions)` once (memoized on `actions`).
- Per tier, take the tier's groups (`g.tier === tier`).
- Render one `ActionRow` per group's `primary`, passing
  `extraReasonsCount={group.extra.length}`.
- **Cap:** module const `MAX_VISIBLE_PER_TIER = 5`. For `now` and `soon`, slice
  to the cap by default; when a tier has more, render a `"Show N more"` /
  `"Show less"` toggle button below that tier's rows. Per-tier open state
  (`useState` map keyed by tier, or two booleans).
- `monitor` tier: unchanged behavior (the existing collapse-all `<details>`-style
  toggle), but now renders grouped rows too.
- Empty state unchanged.

### Row: `src/app/action-row.tsx`

- New optional prop `extraReasonsCount?: number`.
- When `> 0`, render a muted, **non-interactive** line under the existing `why`
  line: `t(lang, "actionMoreReasons", extraReasonsCount)` (e.g. "+2 more reasons").
- All existing CTA / snooze / popover logic is unchanged — it runs on the row's
  `action` (the group's `primary`).

## Data Flow

```
computeNextActions(input)        // flat SuggestedAction[] — UNCHANGED
        │
        ├─► learning / notifications / AI-analysis   (consume flat list, unchanged)
        │
        └─► ActionsPanel
                groupNextActions(flat)  ──►  ActionGroup[]
                per tier → cap → ActionRow(primary, extraReasonsCount)
```

## Edge Cases

- **Different-tier signals on one entity:** group lands in the highest tier
  (max score). The entity appears exactly once, at its most-urgent reason.
- **Group with 0 extra:** renders identically to today (no reasons line).
- **Snooze on a grouped row:** acts on the primary's action id (existing
  behavior). If the entity still has another live reason, the group re-surfaces
  next compute with that reason as the new primary — correct, the other reason
  is genuinely still open. Documented behavior, not a bug.
- **Non-open CTA (snooze-only) actions:** keyed by their own id, never merge.

## i18n

New keys, EN (`i18n.ts`) + DE (`i18n.de.ts`):

| Key | EN | DE |
|---|---|---|
| `actionMoreReasons` | `+{0} more reasons` | `+{0} weitere Gründe` |
| `actionShowMore` | `Show {0} more` | `{0} weitere anzeigen` |
| `actionShowLess` | `Show less` | `Weniger anzeigen` |

DE strings written via node utf8 write (not the Edit tool) per the `i18n.de.ts`
curly-quote/umlaut corruption landmine; `+{0} weitere Gründe` carries a real `ü`.
Verify EN/DE key parity with `npx tsc --noEmit`.

## Testing

- **New `next-actions/group.test.ts`** (pure): collapse two signals on one task →
  one group, primary = higher score, `extra.length === 1`; max-score determines
  tier (now+soon signals → now group); key fallback for snooze-only actions;
  group sort order; single-signal passthrough (`extra` empty); deterministic
  ordering on equal scores.
- **`actions-panel.test.tsx`** updated: cap hides rows beyond `MAX_VISIBLE_PER_TIER`;
  show-more reveals them and updates the button label; grouped entity renders one
  row with the "+N more reasons" line; monitor still collapsed.
- **`action-row.test.tsx`** updated: `extraReasonsCount > 0` renders the reasons
  line; `0`/undefined renders nothing extra; line is non-interactive.
- Engine tests (`engine.test.ts`, provider tests) untouched — engine unchanged.
- `npx tsc --noEmit` (i18n parity), `npm run lint` (`--max-warnings=0`),
  `npm run test:run`.

## Acceptance

- An entity triggering N signals shows as one row with the strongest reason as
  headline and "+{N−1} more reasons".
- `now` and `soon` show at most 5 rows by default, with a working show-more.
- No change to learning/notifications/AI-analysis behavior or the flat engine
  output.
- All gates green.
