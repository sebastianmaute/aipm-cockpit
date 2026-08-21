# Next Actions — visual redesign (Focus + tiers, action-first rows)

**Date:** 2026-06-30
**Status:** Approved design — ready for implementation plan
**Surface:** `actions-panel.tsx` (the "Next actions" / Action Center view, AppView `actions`)

## Goal

Make the Next Actions panel scannable, dense-but-readable, polished, and
unmistakably actionable — without changing the underlying scoring engine
(`next-actions/`), the data, or any persistence. Pure surface redesign.

All four user-stated goals in one pass:
1. **Scannability** — the single most urgent action is visually dominant.
2. **Density & rhythm** — each row carries less competing chrome.
3. **Polish** — intentional card/tier treatment within the AIPM palette.
4. **Actionable** — every row leads with its real next step, not generic "Open".

## Non-goals

- No change to `computeNextActions`, scoring, learning, snooze, or the flat
  action list. Grouping (`groupNextActions`) is unchanged.
- No new persisted `Workspace` field, no storage/codec/Turso touch.
- No change to the AI-analysis banner behavior (`AiAnalysisBundle`), only its
  position relative to the new hero is reconfirmed (stays above).
- `AiActionRow` (AI-suggested rows) is untouched — out of scope.
- No new gradients/shadows outside sanctioned tokens (dual-CI + palette gates).

## Shape (approved)

```
[ AI "Analyze with AI" banner          ]   ← unchanged, only when ai.enabled
[ AI result section                    ]   ← unchanged, when a result exists
┌───────────────────────────────────────┐
│ ⚑ DO THIS FIRST            (tier tint) │   ← HERO: groups[0], full why,
│ Assign an owner to "Vendor API delay" │     full CTA set
│ High-severity risk, blocks 2 tasks…   │
│ [Assign owner] [Open risk] [Snooze]   │
└───────────────────────────────────────┘
● Now · 2 more                              ← tier header: dot + tinted count
  ▌ Spec sign-off overdue      [Reschedule] ⋮
  ▌ "DB migration" blocked     [Clear blocker] ⋮
● Soon · 5
  ▌ UAT gate at risk           [Rebaseline] ⋮
  …  Show 3 more ▾
▸ Monitor · 8                               ← collapsed, unchanged behavior
```

## Components & responsibilities

### 1. Pure CTA picker — `next-actions/action-cta.ts` (NEW, i18n-free)

Centralizes "what is this action's primary verb, and what falls into overflow".
Today this logic is implicit in `action-row.tsx`'s `can*` booleans, which each
render their own inline control. We make the selection explicit and reusable by
both the hero card and the compact row.

```ts
export type PrimaryCtaKind =
  | "assign" | "clearBlocker" | "reschedule" | "rebaseline"
  | "escalate" | "draft" | "markDone" | "open";

/** Which optional handler bundles/flags are wired in for this surface.
 *  Mirrors the props ActionRow already receives — presence === capability. */
export interface ActionCaps {
  assign: boolean;        // assignOwner bundle present
  draft: boolean;         // onDraftMessage present
  escalate: boolean;      // escalate bundle present
  rebaseline: boolean;    // rebaseline bundle present (incl. snapshotActive)
  reschedule: boolean;    // reschedule bundle present
  markDone: boolean;      // onMarkDone present
  clearBlocker: boolean;  // onClearBlocker present
  snooze: boolean;        // onSnooze present
  createTask: boolean;    // onCreateTask present
}

/** Highest-priority applicable verb. Pure function of the action's
 *  source/why/cta + caps. Falls back to "open". */
export function pickPrimaryCta(action: SuggestedAction, caps: ActionCaps): PrimaryCtaKind;

/** The remaining applicable secondary CTAs, in menu order, EXCLUDING the
 *  primary. Used to populate the ⋮ overflow. */
export function overflowCtas(action: SuggestedAction, caps: ActionCaps): PrimaryCtaKind[];
```

**Priority order** (first applicable wins as primary):
`assign → clearBlocker → reschedule → rebaseline → escalate → draft → markDone → open`.

Applicability re-uses the exact conditions already in `action-row.tsx`
(`canAssign`, `canClearBlocker`, `canReschedule`, `canRebaselineMilestone ||
canRebaselineSnapshot`, `canEscalate`, `canDraft`, `canMarkDone`). Those
boolean expressions move verbatim into `action-cta.ts` as small predicates so
there is ONE definition. `action-row.tsx` then consumes the picker instead of
re-deriving. `"open"` is always applicable (the fallback) and `createTask` /
`snooze` are overflow-only (never primary), matching today.

Because the contextual controls are already mutually exclusive per row
(AGENTS.md: "≤1 contextual popover per row"), the picker normally returns that
one control as primary; the change is that `clearBlocker` / `markDone` / `draft`
— today buried in the ⋮ menu — get **promoted to the filled primary** when they
are the lead capability, and the generic "Open" is demoted to a ghost button /
the hero's secondary.

Unit-tested in isolation (pure): one test per source/why → expected primary +
overflow set, plus caps-absent fallbacks (e.g. reschedule bundle missing →
`reschedule` never returned).

### 2. Hero card — `action-hero-card.tsx` (NEW)

Presentational. Renders the single top group as a prominent card. A separate
file (not a `variant` branch inside `ActionRow`) keeps both files focused.

Props: `{ lang, group: ActionGroup, onOpen, plus the same optional CTA bundles/
handlers ActionRow takes }`. Internally calls `pickPrimaryCta` and renders:
- Eyebrow `⚑ <t(heroEyebrow)>` tinted to the group's tier via `--rag-*` text token.
- Title (full, may wrap to 2 lines — NOT truncated).
- Why (full, not truncated).
- CTA cluster: **primary** (filled `bg-AIPM-dark-blue`, the picked verb's control
  — popover variants like Assign/Escalate/Rebaseline/Reschedule reuse the
  EXISTING popover components), then **Open** (ghost) when primary≠open, then
  the overflow CTAs rendered inline as ghost buttons IF ≤2 else a ⋮ menu, then
  Snooze (when wired).

**Palette:** card = `rounded-lg border border-line` + tier left-border
`border-l-4 border-l-[var(--rag-*)]` + flat tier tint `bg-[var(--rag-*)]/5` +
`shadow-[var(--shadow-card)]`. No gradient. Tier→token map shared with the row
(see §4). The tint/border/eyebrow all key off `group.tier` so they switch under
Mockup/Custom styles automatically.

**A11y:** card is a `<section aria-label={t(heroEyebrow)}>`; all CTA buttons
carry text labels (already do); eyebrow ⚑ is `aria-hidden`.

### 3. Compact row — refactor `action-row.tsx` (action-first)

Keep the component; restructure its left content and CTA area.

- **Drop** the standalone source icon (`ACTION_SOURCE_ICON`) and the source pill
  (`ACTION_SOURCE_LABEL` chip). Re-home the source label as a **bold uppercase
  prefix inside the why-line**: `<b>{sourceLabel}</b> · {why}`. (`ACTION_SOURCE_LABEL`
  is still used — just relocated; `ACTION_SOURCE_ICON` import is removed.)
- **Score** (`InfoTooltip` with `actionScoreTooltip`) renders **only when
  `expertMode`**. New prop `expertMode?: boolean` threaded panel→row. Default
  (non-expert) hides it entirely, removing the always-on "i" dot.
- **Primary CTA**: render the `pickPrimaryCta` result as the prominent control
  (filled when it's a real verb; the existing popover components are reused for
  assign/escalate/rebaseline/reschedule). Generic **Open** becomes a ghost
  button shown only when primary≠open (so a row whose verb is "Open" still has
  exactly one button).
- **⋮ overflow** holds `overflowCtas` results + createTask + snooze, exactly the
  existing menu items, minus whichever got promoted to primary.
- Keep: tier left-stripe (`TIER_STRIPE`), `+N reasons` expander (always-mounted
  `hidden`-toggled panel, unchanged), learning-moved hint, the row-`onClick`→open
  convenience, `stopPropagation` on inner controls, row-unique ⋮ `aria-label`.

The left stripe stays `border-l-4`; the row no longer needs the icon/pill, so
the title/why get the reclaimed horizontal space (helps the narrow pane).

### 4. Tier headers + panel assembly — `actions-panel.tsx`

- **Hero selection:** `const hero = groups[0]` (already global score-sorted by
  `groupNextActions`). Render `<ActionHeroCard>` above the tiers. **De-dupe:** the
  tier lists filter out `hero.key` so the hero item isn't repeated. The matching
  tier's count header shows "N more" when the hero came from it (e.g. `Now · 2
  more`), plain `N` otherwise. Empty list → no hero, existing empty state.
- **Tier headers:** add a tier-colour dot (`<span aria-hidden
  class="…bg-[var(--rag-*)]">`) before the label; tint the count text via the
  tier's `--rag-*-text` token (AA-safe variant). Keep the `(count)` and
  uppercase styling. Monitor stays a collapsible `<button aria-expanded>`
  (unchanged), now with a green dot. Now/Soon keep `MAX_VISIBLE_PER_TIER=5` +
  show-more.
- Shared `TIER_RAG: Record<ActionTier, {border,bg,text,dot}>` token-class map
  lives in one place (e.g. top of `action-cta.ts` or a tiny `action-tier-style.ts`)
  and is imported by hero, row, and panel so the three stay in lockstep and all
  switch under Mockup/Custom. ★ Write each tier's classes as concrete
  `var(--rag-NAME)` strings — never a single arbitrary-value bracket with a pipe/
  wildcard (Tailwind v4 scans all files; an invalid bracket char 500s globals.css).
- Thread `expertMode` (already a panel prop) into both hero and rows.

## Data flow

```
computeNextActions (engine, unchanged)
  → groupNextActions(actions)                         [unchanged]
    → groups[0]            → ActionHeroCard   ─┐
    → groups.filter(tier)  → ActionRow[]       ├─ pickPrimaryCta(action, caps)
       minus hero.key                          ┘   (pure, shared)
```

`caps` is assembled once in the panel from the optional props it already
receives (`assignOwner!=null`, `onDraftMessage!=null`, …) and passed down, OR
each component derives it from the bundle props it holds. Decision for the plan:
derive in each component from props it already has (no new threading) — the
booleans are cheap and local.

## Error / edge handling

- **Zero actions:** no hero, current empty-state text (`actionsEmptyState`).
- **Single action:** it becomes the hero; all tier lists empty → render only the
  hero (no empty tier headers; a tier section renders only when it has rows).
- **Popout (read-only):** mutating bundles are already `undefined` in popouts →
  `caps` falses out → primary degrades to **Open** everywhere, ⋮ hides. Hero
  still renders (Open + reasons), no write affordance. Matches today's popout.
- **Hero from Monitor tier** (only monitor actions exist): hero still shows
  (green tint); Monitor count reads "N more". Acceptable — there is always a
  "most important next thing".
- **No regressions to AI banner / result / loading modal** — code unchanged.

## Testing

- `action-cta.test.ts` (pure): primary + overflow per source/why; caps-absent
  fallbacks; open-only fallback; createTask/snooze never primary.
- `action-hero-card.test.tsx`: renders top group title/why untruncated; primary
  verb present; tier tint class present; popout (no bundles) → Open only;
  `aria-label` section.
- `actions-panel.test.tsx` (extend existing): hero = top group; hero de-duped
  from tier list ("N more" math); tier dot present + `aria-hidden`; expertMode
  toggles score visibility; empty state unchanged.
- `action-row.test.tsx` (extend): source label now in why-line (no pill/icon);
  primary verb promoted (clearBlocker/markDone/draft cases); Open ghost only
  when primary≠open; ⋮ contents minus promoted; expertMode score gate.
- a11y: `npx playwright test e2e/a11y.spec.ts -g "..."` — the `actions` view is
  NOT in `A11Y_VIEWS` (sub-menu child, file-mode reachable? verify), so
  eye-verify hero/row/tier-dot labels + contrast across AIPM/mockup/custom.
  (Confirm during plan whether `actions` is axe-scanned; if not, eye-verify.)
- `npx tsc --noEmit` (i18n EN/DE parity) + `npm run lint` (`--max-warnings=0`).

## i18n (EN + DE, parity tsc-enforced)

New keys:
- `actionHeroEyebrow` → EN "Do this first" / DE "Zuerst erledigen".

Reused (no new key): all CTA labels (`actionAssignOwner`, `actionReschedule`,
`actionClearBlocker`, `actionRebaseline`, `actionDraftMessage`, `actionMarkDone`,
`actionOpen`, `actionSnooze1h/1d`, `actionScoreTooltip`, tier labels, counts).
Confirm each exists during the plan; add only if missing. DE patched via node
utf8 write (Edit tool corrupts umlauts in `i18n.de.ts`).

## Release (at ship time, per AGENTS.md)

Bump `version.ts` (APP_VERSION + new milestone), `CHANGELOG.md` entry, append a
new `versionHighlightNextActionsRedesign` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE).
Not part of the design; listed so the plan includes it.
