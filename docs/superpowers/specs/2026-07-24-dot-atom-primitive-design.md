# Dot atom primitive — design

**Date:** 2026-07-24
**Status:** Approved (design), pending implementation plan

## Problem

The app hand-rolls the same `h-X w-X shrink-0 rounded-full ${colorToken}` markup at several
call sites for small coloured status/indicator dots, each with its own local semantic colour
map:

- `TIER_RAG.dot` (`next-actions/action-cta.ts`) → now/soon/monitor = red/amber/green — used in
  `actions-panel.tsx` (×2) and `action-chips.tsx`.
- `DIRECTION_DOT` (`insights/insight-outcome-badge.tsx`) → improved/unchanged/worsened =
  green/grey/red.
- resource "linked" presence marker (`resource-picker.tsx`) → plain `bg-ui-green`.

`RagDot` (`rag-dot.tsx`) already IS a token-parameterised dot, but its colour is hardwired to
`Health` (`healthDot[level]`), so the non-Health call sites cannot reuse it. AGENTS.md and the
`DIRECTION_DOT` source comment explicitly forbid folding tier/direction into `RagDot` — its
`level` is R/A/G and cannot express a neutral/tier/direction state (mapping neutral→amber would
read as "at risk"). So the boilerplate persists because the only shared dot is the wrong
abstraction.

## Solution

Introduce a lower-level presentational **`Dot`** atom that owns only **size + shape**, taking the
colour as a raw token-class string. Local semantic maps stay exactly where they are and feed the
atom's `color` prop. `RagDot` refactors to build on `Dot`. This kills the size/shape boilerplate
without re-centralising the semantic maps AGENTS.md says to keep local.

### Scope decisions (locked)

- **Atom owns size+shape only.** No variant registry, no colour maps inside the atom. (Rejected:
  a `variant="tier|direction|health"` registry — it would re-centralise exactly the maps the
  landmine says to keep local, reintroducing the neutral-as-amber class of bug. Rejected: widening
  `RagDot` with a raw-colour prop — muddies its Health-only contract the codebase leans on.)
- **Out of scope:** tour step dots (a PILL progress indicator, active `h-1.5 w-3` — not a square
  status dot; would force a non-square width variant) and `RagBadge` (lettered R/A/G glyph,
  `role=img`, print-color-adjust, has a text child — a different component, not a plain dot).

## New file: `src/app/dot.tsx`

```tsx
export type DotSize = "xs" | "sm" | "md" | "lg";

const DOT_SIZE: Record<DotSize, string> = {
  xs: "h-1.5 w-1.5", // 6px
  sm: "h-2 w-2",     // 8px
  md: "h-2.5 w-2.5", // 10px
  lg: "h-3 w-3",     // 12px
};

interface DotProps {
  /** A bg colour-token className, e.g. "bg-[var(--rag-red)]" or "bg-ui-green". */
  color: string;
  /** Diameter token; defaults to "sm" (8px). */
  size?: DotSize;
  /** Extra positioning classes (e.g. "mt-1") appended verbatim. */
  className?: string;
  /** When set, the dot is a LABELED graphic (role="img" + name) instead of
   *  decorative — use only when no adjacent visible text conveys the meaning. */
  label?: string;
}
```

- Base class: `inline-block shrink-0 rounded-full`.
- aria contract mirrors `RagDot` exactly: `label` present → `role="img"` + `aria-label` + `title`;
  else `aria-hidden`.
- The atom hardcodes **no colour** → the palette-sweep / `shell-palette-guard` are unaffected
  (callers still pass sanctioned token classes).

## RagDot refactor (public API unchanged)

`rag-dot.tsx` builds on `Dot`; `DotSize`/`DOT_SIZE` move to `dot.tsx` and `rag-dot.tsx` imports
them (removes the duplicated size map). Contract preserved (`level`/`size`/`className`/`label`), so
`rag-dot.test.tsx` stays green.

```tsx
export type RagDotSize = DotSize; // alias, back-compat
export function RagDot({ level, size = "sm", className, label }: RagDotProps) {
  return <Dot color={healthDot[level]} size={size} className={className} label={label} />;
}
```

## Call-site migrations

Semantic maps (`TIER_RAG`, `DIRECTION_DOT`) stay in place; only their strings feed `color`.

| File | Before (inline) | After |
|---|---|---|
| `action-chips.tsx` (~L43) | `h-1.5 w-1.5 shrink-0 rounded-full ${TIER_RAG[t].dot}` | `<Dot color={TIER_RAG[t].dot} size="xs" />` |
| `actions-panel.tsx` (~L197, L213) | `h-1.5 w-1.5 rounded-full ${TIER_RAG[x].dot}` | `<Dot color={TIER_RAG[x].dot} size="xs" />` |
| `insight-outcome-badge.tsx` (~L44) | `h-2 w-2 shrink-0 rounded-full ${DIRECTION_DOT[d]}` | `<Dot color={DIRECTION_DOT[d]} size="sm" />` |
| `resource-picker.tsx` (~L304) | `h-1.5 w-1.5 rounded-full bg-ui-green` | `<Dot color="bg-ui-green" size="xs" />` |

Update the `DIRECTION_DOT` "please don't fix this to RagDot" comment: the map stays local but now
feeds the shared `Dot` atom (intent preserved — it is still not `RagDot`).

## Testing

- New `dot.test.tsx`: renders the passed `color` + `size` classes; `aria-hidden` by default;
  `label` promotes to `role="img"` with the accessible name.
- `rag-dot.test.tsx` unchanged — a regression check that the refactor preserved RagDot's contract.
- Existing `actions-panel` / `insight-outcome-badge` / `resource-picker` / `action-chips` tests
  must stay green.

## Constraints / non-goals

- Pure presentational: no i18n keys, no backend write path, no persisted field.
- No palette or size-ratchet impact (atom is colour-free; new file is small).
- Run `npx tsc --noEmit` after each edit; lint is `--max-warnings=0` (an unused import is fatal).
- Non-goals: tour step dots, `RagBadge`, any variant/colour registry inside the atom.
