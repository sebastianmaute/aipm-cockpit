# Help Expansion SP3 — Interactive relations map

**Date:** 2026-06-29
**Part of:** the 4-part "expand Help for PM novices" roadmap (SP1 backbone+Help-view · SP2 contextual per-view callouts · **SP3 interactive relations map** · SP4 themed guided tours). SP3 consumes the `relatedViews`/`relatedConcepts` data SP1 populated in `help-content.ts`.

## Goal

Show PM-novices, visually, *how the concepts connect* — a small interactive node graph of the concept entries (edges = related concepts), embedded in the Help view. Clicking a concept node scrolls to its explanation; the per-concept "Related:" line gains clickable view-navigation. EN + DE.

## Decisions (approved)

1. **Surface:** a section inside the existing **Help view** (`<details open>` "How it all connects" above the grouped content). No new `AppView` (avoids the documented 4-edit nav cascade); keeps Help self-contained, matching SP1/SP2.
2. **Visual:** a **hand-rolled SVG node graph** — the 11 concept entries as nodes, lines between related concepts. Deterministic radial layout, no physics/graph lib. Concept-only (the view chips live in the upgraded Related line, not in the SVG).
3. **Interactivity:** click a **concept node** → scroll to that concept in the Help view (reuse `scrollToSection`); click a **related-view chip** → navigate to that view (`onNavigateView` → `setActiveTab`). Hover/focus a node highlights its incident edges.

## Architecture

### Layout engine — `relations-graph.ts` (pure, i18n-free)

```ts
import type { HelpEntry } from "./help-content";
import type { TranslationKey } from "./i18n";

export interface GraphNode { id: string; titleKey: TranslationKey; x: number; y: number; } // x,y ∈ [0,1]
export interface GraphEdge { a: string; b: string; }                                        // a < b (sorted key)
export interface RelationsGraph { nodes: readonly GraphNode[]; edges: readonly GraphEdge[]; }

export function buildRelationsGraph(entries: readonly HelpEntry[]): RelationsGraph;
```

- **Nodes** = entries with `group === "concepts"`, in `HELP_ENTRIES` order. Deterministic **radial** layout: for `N` nodes, node `i` at angle `-π/2 + 2π·i/N` on a circle of radius `R` centred at `(0.5, 0.5)`; `x = 0.5 + R·cos`, `y = 0.5 + R·sin`. `R` a module const (e.g. `0.42`) so nodes stay inside the `[0,1]` box with margin for the button chrome.
- **Edges** = for each concept, each `relatedConcepts` id that is **also a concept node**; undirected, deduped by a sorted `"a|b"` key; self-loops (`a === b`) dropped. (Cross-group `relatedConcepts` ids — none today — would be filtered out by the concept-node membership check.)
- Pure: no `Date.now()`/`Math.random()`/`new Date()`; output is a deterministic function of the input.

### Map component — `relations-map.tsx` (presentational, no context)

`RelationsMap({ graph, lang, onSelectConcept })`. **Overlay technique** for robust a11y (avoids fragile focusable-SVG sub-elements):

- A decorative `<svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">` draws the **edges** as `<line>` (coords `= x·100, y·100`) plus a small node `<circle>` dot per node. Edge stroke uses palette tokens; when an `active` node is set, edges incident to it render accented (`stroke-AIPM-dark-blue`, thicker) and the rest dim (lower opacity).
- A real HTML **`<button>` per node**, absolutely positioned (`style={{ left: \`${x*100}%\`, top: \`${y*100}%\` }}`, `-translate-x-1/2 -translate-y-1/2`), carrying the concept title text + `INTERACTIVE` atoms. This is the keyboard-native, axe-clean interactive element.
  - `onClick={() => onSelectConcept(node.id)}`.
  - `onMouseEnter`/`onFocus` → `setActive(id)`; `onMouseLeave`/`onBlur` → `setActive(null)`. So mouse hover **and** keyboard focus both drive the highlight.
  - When `active`, the active button + its neighbour buttons get an accent ring; non-neighbours dim.
- Wrapper: `role="group"` + `aria-label={t(lang, "helpRelationsMapLabel")}`, `relative` positioned, fixed aspect (e.g. `aspect-[3/2]` with a sensible `max-h`). Palette-safe (`border-line`, `bg-surface`/`bg-surface-muted`, `text-foreground`, brand accent on highlight) — no shadow/gradient.
- Each node button title attr = `t(lang, "helpRelationsOpenConcept")` (a generic action label, e.g. "Show explanation"); the visible concept name is the accessible name.

Local `useState<string | null>(active)` only — no persistence, no effects, no `Date`.

### Help view — `help-view.tsx`

- New optional prop `onNavigateView?: (view: AppView) => void` (optional ⇒ the standalone `help-view.test.tsx` with no `WorkspaceTabProvider` is unaffected).
- A `useMemo(() => buildRelationsGraph(HELP_ENTRIES), [])` builds the graph once.
- Render a `<details open className="… print:hidden">` titled `helpRelationsTitle` with an intro line `helpRelationsIntro`, containing `<RelationsMap graph={graph} lang={lang} onSelectConcept={scrollToSection} />`. Placed **above** the bordered groups container (search-independent — the map is not filtered by `query`). Collapsible + keyboard-native.
- **Upgrade the `relatedViews` rendering** in each entry's Related line: the current plain italic `<span>{t(lang, navLabelKey(v))}</span>` becomes — when `onNavigateView` is provided — a `<button onClick={() => onNavigateView(v)}>` styled as a link (brand colour, `INTERACTIVE`), with `aria-label={t(lang, "helpRelationsGoToView", t(lang, navLabelKey(v)))}` (positional interpolation). When `onNavigateView` is absent (standalone test), fall back to the existing italic `<span>` (no behaviour change there).

### Wiring — `workspace-section.tsx`

`<HelpView … onNavigateView={(v) => setActiveTab(v)} />`. `setActiveTab` comes from the same `useWorkspaceTab()` already destructured for SP2's `requestHelpConcept`/`clearHelpConcept`. Plain view switch (not a deep-link) — `setActiveTab` is the single active-view source.

### i18n (EN `i18n.ts` Edit · DE `i18n.de.ts` node-utf8 write, CRLF, `\u` umlauts)

- `helpRelationsTitle` — section heading ("How it all connects" / "Wie alles zusammenhängt").
- `helpRelationsIntro` — one-line intro under the heading.
- `helpRelationsMapLabel` — the map `role="group"` aria-label (e.g. "Concept relationship map").
- `helpRelationsOpenConcept` — node button title/action ("Show explanation").
- `helpRelationsGoToView` — view-nav button aria template with a `{0}` placeholder ("Go to {0}").

tsc enforces EN/DE parity + `TranslationKey` validity.

## Testing

- `relations-graph.test.ts`: node count = number of `concepts` entries; every edge endpoint is a real concept node id; edges deduped (no symmetric duplicate, no self-loop); all `x,y ∈ [0,1]`; deterministic (two builds deep-equal); a known edge (e.g. `concept-milestone|concept-dependency`) present.
- `relations-map.test.tsx`: renders one `<button>` per concept (accessible name = concept title); clicking a node calls `onSelectConcept` with that id; hovering/focusing a node applies the active-highlight (assert via a stable hook — `data-active` attr or class). (jsdom has no layout — assert structure/handlers, not pixel positions.)
- `help-view.test.tsx` (extend): the "How it all connects" disclosure renders; a related-view button calls `onNavigateView` with the right `AppView` when the prop is supplied; with the prop absent, the italic span still renders (back-compat).
- tsc + lint (`--max-warnings=0`) green; full vitest suite green. Help is **not** in axe `A11Y_VIEWS` → eye-verify the map (palette, keyboard focus, contrast); SVG positioning eye-verified (jsdom rect=0).

## Out of scope (later SP)

- Themed guided tours (SP4).
- View nodes inside the SVG (kept concept-only per the approved preview; views navigate from the Related line).
- Version bump / CHANGELOG — deferred to release of the branch.
- Force-directed/physics layout or any graph library (against the hand-rolled, dependency-light ethos).
