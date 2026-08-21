# Reusable 2D node-graph — Help "How it all connects" + Information flows

**Date:** 2026-06-30
**Status:** Approved (design)
**Target release:** 0.150.0 (minor bump)

## Problem

The Help view's "How it all connects" tab (`relations-map.tsx`) is a vertical list
of buttons with a thin left-gutter edge overlay. We want it to read like the
**Information-flows** diagram (`information-flows-section.tsx`): boxed nodes with
accent stripes and connector lines on a real 2D canvas. Rather than restyle one
surface in isolation, build a **reusable 2D node-graph component** that both
surfaces consume, so future app surfaces can reuse it.

## Decisions (locked during brainstorming)

1. **Look:** true 2D node-graph (boxed nodes + connectors), not a restyled list.
2. **Architecture:** a generic, reusable renderer + a pure layout engine.
3. **Default layout:** deterministic **grid** (auto cols from count). The renderer
   accepts explicit node positions, so manual / hub / radial layouts stay possible.
4. **Scope now:** migrate **both** consumers — the relations map (interactive,
   grid) **and** the Information-flows diagram (static, manual coords, zones).
5. **Concept edges:** plain undirected lines (no arrowheads). The component still
   supports directed (`arrow:"both"`) edges, which info-flows uses.
6. **Fills:** theme-aware (`--surface`/`--foreground`, `--AIPM-dark-blue` stroke,
   hub stays dark-blue). This also fixes info-flows' latent dark-mode white-box
   issue. Requires a Settings axe re-verify.

## Architecture

### Files

| File | Change | Purpose |
|------|--------|---------|
| `node-graph-layout.ts` | **new** | Pure, i18n-free model types + `gridLayout()`. Named `-layout` so a bare `./node-graph` import can't `.ts`-shadow the `.tsx` (AGENTS resolution rule). No `Date`/`Math.random`. |
| `node-graph.tsx` | **new** | Presentational, i18n-free reusable renderer + interactive overlay. Takes already-translated strings. |
| `relations-graph.ts` | change | `buildRelationsGraph` emits the NodeGraph model: concepts → nodes positioned via `gridLayout`, deduped undirected edges (existing dedupe kept). |
| `relations-map.tsx` | change | Thin wrapper: build model, render `<NodeGraph>` interactive, map i18n labels + `onSelectConcept`. |
| `settings-sections/information-flows-section.tsx` | change | Diagram body becomes a NodeGraph model (manual hub/zone coords, `arrow:"both"` edges, **static** mode). Keeps intro `<p>`, `<dl>` legend, zone-swatch row, `maxWidth`. Node labels stay hardcoded EN. |

### Component API (`node-graph.tsx`)

```ts
type NodeAccent = "blue" | "green" | "hub";

interface NodeGraphNode { id: string; label: string; sub?: string; accent: NodeAccent; x: number; y: number; w: number; h: number }
interface NodeGraphEdge { a: string; b: string; arrow?: "none" | "both" } // default "none"
interface NodeGraphZone { label: string; color: string; x: number; y: number; w: number; h: number }

interface NodeGraphProps {
  viewBox: { w: number; h: number };
  nodes: readonly NodeGraphNode[];
  edges: readonly NodeGraphEdge[];
  zones?: readonly NodeGraphZone[];
  ariaLabel: string;
  description?: string;          // <desc> text (static mode)
  maxWidth?: number;             // px cap on rendered width
  onSelectNode?: (id: string) => void;            // present ⇒ interactive
  nodeAriaLabel?: (node: NodeGraphNode) => string; // per-button name (interactive)
  selectTitle?: string;          // button tooltip (interactive)
}
```

Coordinates (`x,y,w,h`) are in **viewBox units**. The renderer locks the outer
container's `aspect-ratio` to `viewBox.w / viewBox.h` so the percentage-positioned
button overlay aligns 1:1 with the SVG drawing.

### Two modes (one component)

- **Interactive** (`onSelectNode` present): outer `role="group"` + `aria-label`.
  A transparent `<button>` per node, absolutely positioned by percent
  (`left=x/W%`, `top=y/H%`, `width=w/W%`, `height=h/H%`), carries `aria-label`
  (`nodeAriaLabel`), `title` (`selectTitle`), `data-active`, `FOCUS_RING`, and
  hover/focus/blur handlers. The SVG draws the visible boxes + labels + edges and
  is `aria-hidden`. Hover/focus on a node highlights its incident edges (→
  `--AIPM-dark-blue`, thicker) and neighbour nodes, dims the rest.
- **Static** (no `onSelectNode`): the SVG itself is `role="img"` + `aria-label`
  + `<title>`/`<desc>`; no buttons, no highlight.

### Layout engine (`gridLayout`)

```ts
gridLayout(items, cfg) -> { nodes: NodeGraphNode[], viewBox: { w, h } }
```

- `cols = cfg.cols ?? ceil(sqrt(n))`; rows = `ceil(n / cols)`.
- Fixed node `w`/`h`, configurable col/row gaps and outer margin (named consts).
- viewBox sized to fit the grid + margins.
- Pure + deterministic; preserves input order (row-major). No `Date`/`Math.random`.

`relations-graph.ts` maps each concept to a grid item (`id`, `label` via
`titleKey`, `accent:"blue"`) and builds undirected edges from `relatedConcepts`
with the existing sorted-key dedupe, then runs `gridLayout`.

## Consumer detail

**Relations map** — interactive, grid, no zones, no legend. Preserves
click-to-jump (`onSelectNode → goToConcept`) and the neighbour highlight.
`nodeAriaLabel = ${title} – ${openConceptHint}`; group `ariaLabel =
helpRelationsMapLabel`.

**Information-flows** — static, manual coords. Model = existing node coords as
`NodeGraphNode`s (accent blue/green/hub, sub text), two `NodeGraphZone`s, hub↔node
edges `arrow:"both"`. `description` = the current `<desc>` text. Wrapper retains
intro paragraph, the legend `<dl>`, zone-swatch row, and `maxWidth` (480 in
Settings + the in-pane Help flows tab passes 720).

## a11y / palette / theming

- Interactive nodes are real buttons (axe-clean accessible names + keyboard
  operable via Tab in DOM order). Static diagram is a labelled `role="img"`.
- Palette-safe: only `var(--AIPM-*)` brand tokens + theme tokens
  (`--surface`/`--foreground`/`--line`); no shadow, no gradient. Highlight colors
  (`--AIPM-dark-blue`/`--AIPM-green`/`stroke-line`) are structural brand, not
  RAG-semantic, so raw AIPM tokens are fine.
- Theme-aware fills render correctly in light / dark / Mockup.
- **Settings is in `A11Y_VIEWS`** → after the info-flows migration, re-run
  `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"`.
- Help is **not** in `A11Y_VIEWS` → relations map is eye-verified.

## Testing

- `node-graph-layout.test.ts` — `gridLayout` determinism, positions, viewBox
  sizing, col derivation.
- `node-graph.test.tsx` — interactive: renders a button per node with its
  `nodeAriaLabel`, `onSelectNode` fires on click, `data-active` toggles on
  focus/hover; static: renders `role="img"` with `aria-label`, renders **zero**
  buttons.
- Update existing `relations-map` test (new structure) — incl. the edge-dedupe
  assertion, which stays with `buildRelationsGraph` — and the information-flows
  test.
- Gates: `npx tsc --noEmit`, `npm run lint`, `npm run test:run`, `npm run build`,
  plus the Settings axe e2e above.

## Risks

- **Overlay alignment** depends on the aspect-ratio-locked container; jsdom
  returns rect 0, so tests assert structure/handlers, not pixels — **eye-verify
  in the browser** (both light and dark).
- No golden-fixture exposure: these are SVG components, not serialized workspace
  data.

## Out of scope (YAGNI)

- Radial / force / clustered layouts (component accepts explicit positions; add
  helpers later if a surface needs them).
- Zone support in the relations map (concepts are one Help group).
- Migrating any other surface; no new persisted `Workspace` field.

## Release

Minor bump `0.150.0`: `version.ts` (APP_VERSION + build-date comment + milestone),
`CHANGELOG.md` entry. No new `versionHighlight*` key unless we choose to surface
one.
