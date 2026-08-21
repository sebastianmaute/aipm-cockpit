# Help / Tour / Information-flows redesign — Design

**Date:** 2026-06-29
**Status:** Approved (brainstorm)
**Surfaces:** in-pane Help view, floating Help panel, guided-tour catalog, relations map, Settings → Integrations information-flows diagram

## Goal

Visual redesign sharing one card-based language across:

1. **Help content** (`help-content-pane.tsx`) — card sections + scroll-spy TOC. Shared → upgrades **both** the in-pane Help view and the floating Help panel.
2. **Help view top region** (`help-view.tsx`) — a **horizontal accordion** of three panels: Guided tours · How it all connects · Information flows. Exclusive (one open), default open = Guided tours.
3. **Guided-tour catalog** (`tour-catalog.tsx`) — richer cards: icon, step count, dark-blue stripe, done/replay state.
4. **Relations map** (`relations-graph.ts` + `relations-map.tsx`) — radial → **vertical stack** layout (fits the accordion panel + narrow widths).
5. **Information-flows diagram** (`information-flows-section.tsx`) — grouped + colour-coded, option-B tight-horizontal, **9 nodes**, shown in **both** Help (accordion) and Settings → Integrations.

All AIPM-token / palette-safe. No new persisted state (accordion open-state is ephemeral `useState`). New i18n keys listed per section.

---

## 1. Help content pane (`help-content-pane.tsx`)

Presentational refactor of the shared two-pane component. No logic change in `help-view.tsx`/`help-menu.tsx` except the accordion (§2) and the floating-panel size (§1c). `help-content.ts` untouched. No new state shape beyond a content-scroller `useRef` + scroll-spy.

### 1a. TOC (left)
- Width `@[560px]:w-56` (was `w-52`); group labels `text-xs` (was `text-[10px]`); items `text-sm` (was `text-xs`), `py-1.5`.
- Active item: `border-l-2 border-AIPM-dark-blue bg-surface-muted` + semibold dark-blue — same tokens, now **scroll-spy-driven**.
- `< 560px` container query keeps the horizontal-scroll strip.

### 1b. Content (right)
- Scroll container `bg-surface-muted` recess.
- Each concept = card: `rounded-lg border border-line bg-surface p-4 border-l-[3px] border-l-AIPM-dark-blue`. **No shadow.** Dark-blue stripe on every card.
- Title `text-sm font-semibold`; body `text-sm leading-relaxed text-muted-foreground max-w-[64ch]`.
- "Related:" line unchanged (concept buttons via `scrollToSection`, view-nav via `onNavigateView`); `highlightSegments` `<mark>` unchanged.
- Cards `gap-3`; group blocks `mb-8`; group `<h2>` stays uppercase dark-blue divider.

### Scroll-spy
- One `IntersectionObserver` in a `useEffect`, `root` = content scroller `ref`.
- Observes every rendered `section[id]`; callback sets `activeId` = topmost intersecting; `rootMargin: "0px 0px -70% 0px"`.
- Re-create when the filtered section-id list changes — effect dep = hoisted scalar id-key string (`ids.join(",")`), NOT array identity (exhaustive-deps).
- TOC click still `scrollToSection` (`scrollIntoView({behavior:"smooth"})` + immediate `setActiveId`); observer syncs after.
- `helpSectionId(id)` export + relations/deep-link `scrollToSection` unchanged.
- Observer in effect (browser only); callback is an event handler — no `set-state-in-effect`. No-op cleanly when no sections (the `groups.length===0 → helpNoResults` early return is unchanged).

### 1c. Floating panel (`help-menu.tsx`)
- Default `760×620 → 820×640`; **bump storage key** `lop-app:help-size-v2 → -v3` (stale `useResizable` inline size would clip). Update default-position fallbacks (`?? 820`/`?? 640`) + root width/height classes.
- Floating panel is **content-only** (search + content pane) — it does NOT get the §2 accordion (tours/relations/info-flows stay in-pane-view-only, as today). It inherits the §1a/1b card redesign automatically.

---

## 2. Help view top region — horizontal accordion (`help-view.tsx` + new `help-collapsible-region.tsx`)

Replaces today's two stacked `<details open>` (tours + relations) with one **exclusive horizontal accordion** of three panels.

### Component
- New presentational `help-collapsible-region.tsx`: renders 3 panels in a `flex` row. Open-state is a single `useState<'tours'|'connects'|'flows'>` (default `'tours'`) owned by `help-view.tsx` (or the region component); ephemeral, NOT persisted.
- Exclusive: opening one sets it active → the other two collapse. (Clicking the already-open panel's header keeps it open; no all-closed state — there is always exactly one open.)
- **Open panel:** `flex-1`, bordered card (`rounded-lg border border-line border-l-[3px] border-l-AIPM-dark-blue bg-surface p-3`), header `<button aria-expanded="true">` with ▾ + title, body below.
- **Collapsed panel:** a `w-9` (~38px) vertical bar `<button aria-expanded="false">`, label `writing-mode:vertical-rl` rotated, ▸ chevron, `hover:border-AIPM-dark-blue`. `INTERACTIVE` atom.
- Each header/bar is a real keyboard-operable button with `aria-controls` → the panel body id + `aria-expanded`.
- Panel content is gated like the current sections: tours panel only when `onStartTour` present (modern && !popout); relations + info-flows always (in-pane view). If the tours panel is gated off, default-open falls back to the first available panel.
- Narrow container (`@container`): collapse to **vertically stacked** full-width panels (the horizontal bars don't work < ~560px) — each panel a normal stacked `<details>`-like block; reuse a container-query breakpoint.

### Panels
- **Guided tours** → `<TourCatalog …>` (§3).
- **How it all connects** → `<RelationsMap …>` (§4, vertical).
- **Information flows** → `<InformationFlowsSection lang={lang} />` (§5) — reused as-is (also stays in Settings).

### i18n
- Reuse existing section header keys where they exist (tours header, relations header `helpRelations…`, info-flows `infoFlowsTitle`/`nav…`). Add only if missing — plan verifies exact keys. No new strings expected beyond verifying a title key exists for each of the 3 panels.

---

## 3. Guided-tour catalog (`tour-catalog.tsx` + `app-tour.ts` + `use-tour.ts`)

### Data (`app-tour.ts`)
- `TourCatalogEntry` → `{ id, titleKey, descKey, stepCount: number, iconView: AppView }`.
- Add `iconView: AppView` to `TourDefinition`, set on the 6 `TOURS`: `getting-started→"dashboard"`, `raid→"raid"`, `reporting→"reports"`, `planning→"milestones"`, `stakeholders→"stakeholders"`, `ai→"chat"`.
- `import type { AppView } from "./nav-config"`.

### Projection (`use-tour.ts`)
- In `catalogTours` `useMemo`: `const vis = visibleSteps(t.steps, features)`, filter `vis.length>0`, project `{id, titleKey, descKey, stepCount: vis.length, iconView: t.iconView}`.

### UI (`tour-catalog.tsx`)
- Card: `flex gap-3 rounded-md border border-line border-l-[3px] border-l-AIPM-dark-blue bg-surface p-3 text-left hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`.
- Left icon badge `~28-30px rounded-md bg-surface-muted text-AIPM-dark-blue` rendering the nav icon for `tour.iconView` (reuse `nav-icons.tsx`); done tour → green check badge (`bg-AIPM-green/15 text-AIPM-green-strong`). Icon `aria-hidden` (no name bleed).
- Body: title `text-sm font-semibold`; **meta** `text-[10px] uppercase tracking-wide text-muted-foreground` = step count via new key `tourStepCount` ("{0} steps"); desc `text-xs text-muted-foreground`.
- CTA: not-done `tourStartCta`; done `tourReplayCta` ("Replay tour →"). Top-right done badge `tourDoneBadge` kept.
- Props-only / standalone-testable; grid `grid-cols-1 sm:grid-cols-2` (3-col when the panel is wide is acceptable — keep `sm:grid-cols-2`, the open accordion panel is wide → bump to `sm:grid-cols-2 lg:grid-cols-3`); palette-safe; tour-unique `aria-label` kept.

### New i18n (EN+DE)
- `tourStepCount` — "{0} steps" / "{0} Schritte" (positional `{0}`).
- `tourReplayCta` — "Replay tour" / "Tour wiederholen".

---

## 4. Relations map — vertical stack (`relations-graph.ts` + `relations-map.tsx`)

Radial → vertical, grouped by `HELP_GROUP_ORDER`.

### Engine (`relations-graph.ts`)
- `buildRelationsGraph(entries)` now lays nodes out in a **vertical column grouped by `e.group`**: deterministic y by overall order, fixed x (single column), grouped. Keep `{nodes:[{id,titleKey,x,y}], edges:[{a,b}]}` shape (x/y now column coords, fractional `[0,1]`). Edges still undirected + deduped (sorted `"a|b"` key), concept-only endpoints, no self-loops. No `Date`/`Math.random`.
- Group order/membership from `HELP_ENTRIES` (concepts only, as today).

### Render (`relations-map.tsx`)
- Vertical list of nodes (grouped, small group labels), each a real absolutely-or-flow-positioned `<button>` (keyboard-native, axe-clean) — keep the **overlay technique**: decorative `aria-hidden` `<svg>` draws edge curves down a left gutter; real HTML buttons are the interactive layer (NOT focusable SVG sub-elements).
- Hover AND focus highlight: active node + incident edges (`stroke-AIPM-dark-blue`/green) + neighbour nodes (green left accent), dim the rest. `local useState(active)` from hover+focus — same behaviour as today.
- Click → `onSelectConcept(id)` → HelpView `scrollToSection` (unchanged contract).
- Node = small pill `border border-line border-l-2 border-l-AIPM-dark-blue rounded-md bg-surface`; active = dark-blue fill/white; neighbour = green left accent + semibold. Edge curves: green to active, grey otherwise. Palette-safe.
- jsdom rect=0 → tests assert structure/handlers/`data-active`, not pixels (as today).

---

## 5. Information-flows diagram (`information-flows-section.tsx`)

Option-B tight-horizontal, grouped + colour-coded, **9 nodes**. Shown in BOTH Help (accordion panel) and Settings → Integrations (same component, two mount points). Self-contained SVG rebuild (new coords); `role="img"` + `<title>`/`<desc>` + `aria-label` kept.

### Nodes (9)
- **Your data** zone (green stroke + green left accent): `Local storage` (IndexedDB), **`File storage`** (JSON / CSV / MD), `Turso` (cloud DB) — 3 stacked.
- **Centre:** `Browser app` hub (dark-blue fill / green stroke, kept).
- **Connected services** zone (dark-blue stroke + dark-blue left accent): `Jira`, `Timelog`, **`SharePoint`** (documents), **`Outlook`** (contacts + calendar), `Anthropic` (AI chat) — 2×2 + 1 full-width bottom (`Anthropic`). M365 node SPLIT into SharePoint + Outlook (both Graph/MSAL).

### Layout (new `viewBox`, tight-horizontal ~470 wide)
- `[Your data zone] ⇆ [hub] ⇆ [Connected services zone]`, dashed group rects + uppercase zone labels (storage label green, services label dark-blue). Connector arrows fan hub↔each node (existing `arrow`/`arrow-rev` markers).
- `style={{ maxWidth: 470 }}`, `width="100%"`.

### Legend
- Two colour swatches (green = "Your data (storage)", dark-blue = "External services (API)") above the existing per-node `<dl>`.
- Per-node `<dl>` extended: add **File storage** row; **split M365** row into SharePoint + Outlook rows.

### New i18n (EN+DE)
- `infoFlowsZoneDataLabel` — "Your data" / "Ihre Daten" (zone label + legend swatch).
- `infoFlowsZoneServicesLabel` — "Connected services" / "Verbundene Dienste".
- `infoFlowsLegendFileLabel` / `infoFlowsLegendFileDesc` — File storage node (label + description).
- `infoFlowsLegendSharePointLabel` / `…Desc` and `infoFlowsLegendOutlookLabel` / `…Desc` — replace the single `infoFlowsLegendM365Label`/`…Desc` (remove the M365 pair; or keep + add — plan decides; cleanest: rename M365→SharePoint, add Outlook).
- Node text strings: "File storage", "JSON / CSV / MD", "SharePoint", "Outlook" — inline in SVG (the existing node labels are hardcoded English in the SVG `<text>`, not i18n; keep that pattern — only the legend `<dl>` uses i18n keys). Plan confirms.

---

## Constraints / landmines

- **Palette:** AIPM tokens only; **no `box-shadow`/gradient** on new cards (palette-sweep scans CSS not Tailwind — eye-check). Stripes as concrete `border-l-AIPM-dark-blue` / `var(--AIPM-green)`; NEVER a wildcard/pipe inside a Tailwind arbitrary-value bracket.
- **i18n:** EN/DE parity tsc-enforced; DE written via node utf8 (umlauts: "Schritte", "Verbundene Dienste", "Ihre Daten", "wiederholen") — Edit tool corrupts `i18n.de.ts` (CRLF; match `\r\n`).
- **react-hooks purity:** scroll-spy + accordion state in effects/handlers, not render. No `set-state-in-effect`. Exhaustive-deps: hoist `obj.member`/array deps to scalars.
- **a11y:** Help + tour catalog + relations map NOT in axe `A11Y_VIEWS` → **eye-verify** (accordion bars labeled + `aria-expanded`/`aria-controls`; relations buttons keyboard-native; icon/RagBadge `aria-hidden` to avoid name bleed). Settings (info-flows) IS in the axe gate → keep SVG `role=img`+`aria-label`, no unlabeled control.
- **`useResizable` key bump** mandatory for floating panel.
- **`TourCatalogEntry` shape change** ripples to `tour-catalog.test.tsx` + any `catalogTours` consumer fixtures.
- **`relations-graph.ts` layout change** → `relations-graph` / `relations-map` tests assert structure not pixels; update any layout-coord assertions.

## Testing

- `npx tsc --noEmit` after every test edit (i18n parity + types).
- `npm run test:run` — extend/add: help-content-pane card+click-active structure; help-collapsible-region exclusive open/`aria-expanded`; tour-catalog step-count+done/replay+icon; `use-tour`/`app-tour` projection (`stepCount`+`iconView`); relations-graph vertical layout + edge dedup; relations-map structure/handlers; info-flows 9 nodes + zone labels + swatches + `role=img`.
- Eye-verify: both Help surfaces, accordion 3 states, tour catalog, relations map vertical, info-flows in Help AND Settings (jsdom no layout → scroll-spy/SVG/accordion geometry eye-only).
- `npx playwright test e2e/a11y.spec.ts -g "Settings"` — info-flows lives under Settings (axe-scanned).
- Release bookkeeping (release turn, not now): bump `version.ts`+`package.json`, `CHANGELOG.md`, append a `versionHighlight*` key + EN/DE.

## Out of scope

- Analyze/chat work from v0.147.0 (already shipped).
- No new tours, no tour-engine behaviour change (catalog projection + card UI only).
- No data-direction labelling on info-flows arrows (YAGNI).
