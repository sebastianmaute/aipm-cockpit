# Help / Tour / Information-flows Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Help view (card content + scroll-spy TOC + horizontal accordion top region), the guided-tour catalog (icon/step-count/stripe/replay), the relations map (radial → vertical stack), and the Settings information-flows diagram (grouped/colour-coded, 9 nodes), sharing one card visual language; info-flows shown in both Help and Settings.

**Architecture:** Pure layout/data first (`relations-graph.ts`, `app-tour.ts`, `use-tour.ts`), then presentational components (`help-content-pane.tsx`, `tour-catalog.tsx`, `relations-map.tsx`, `information-flows-section.tsx`, new `help-collapsible-region.tsx`), then wiring (`help-view.tsx`, `help-menu.tsx`) and i18n. All AIPM-token / palette-safe. The accordion open-state is ephemeral `useState`; no new persisted fields.

**Tech Stack:** Next.js 16 (forked) / React 19 / TypeScript / Tailwind v4 (container queries) / Vitest. Spec: `docs/superpowers/specs/2026-06-29-help-tour-infoflows-redesign-design.md`.

**Branch:** create `feat-help-tour-infoflows-redesign` off `main` before Task 1.

---

## File Structure

- `src/app/relations-graph.ts` — MODIFY: radial → vertical single-column layout (concepts only).
- `src/app/app-tour.ts` — MODIFY: extend `TourCatalogEntry` (+`stepCount`,+`iconView`); add `iconView` to `TourDefinition` + the 6 `TOURS`.
- `src/app/use-tour.ts` — MODIFY: `catalogTours` projection emits `stepCount`+`iconView`.
- `src/app/help-content-pane.tsx` — MODIFY: card sections + scroll-spy TOC.
- `src/app/tour-catalog.tsx` — MODIFY: icon + step-count + stripe + replay/done.
- `src/app/relations-map.tsx` — MODIFY: vertical render over the new layout.
- `src/app/information-flows-section.tsx` — MODIFY: option-B grouped/colour-coded, 9 nodes.
- `src/app/help-collapsible-region.tsx` — CREATE: exclusive horizontal accordion (tours/connects/flows).
- `src/app/help-view.tsx` — MODIFY: replace the two `<details>` with the accordion; mount info-flows.
- `src/app/help-menu.tsx` — MODIFY: floating-panel size 820×640 + storage key `-v3`.
- `src/app/i18n.ts` + `src/app/i18n.de.ts` — MODIFY: new keys.
- Tests: `relations-graph.test.ts`, `tour-catalog.test.tsx`, `use-tour.test.ts`/`app-tour.test.ts`, `help-content-pane.test.tsx`, `help-collapsible-region.test.tsx`, `information-flows-section.test.tsx` (create where missing).

**Pre-flight (do once before Task 1):**
```bash
git checkout main && git pull --ff-only
git checkout -b feat-help-tour-infoflows-redesign
```

---

## Task 1: i18n keys (EN + DE)

New keys: `tourStepCount`, `tourReplayCta`, `infoFlowsZoneDataLabel`, `infoFlowsZoneServicesLabel`, `infoFlowsLegendFileLabel`, `infoFlowsLegendFileDesc`, `infoFlowsLegendSharePointLabel`, `infoFlowsLegendSharePointDesc`, `infoFlowsLegendOutlookLabel`, `infoFlowsLegendOutlookDesc`. Plus: REMOVE `infoFlowsLegendM365Label`/`infoFlowsLegendM365Desc` (replaced by SharePoint+Outlook).

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts` (CRLF — patch via node utf8, NOT Edit tool)

- [ ] **Step 1: Locate the existing info-flows legend keys in `i18n.ts`**

Run: `npx rg -n "infoFlowsLegendM365|infoFlowsLegendTimelog|tourStartCta|tourDoneBadge" src/app/i18n.ts`
Expected: lines showing the existing `infoFlowsLegend*` block and the `tour*` block.

- [ ] **Step 2: Edit `i18n.ts` — add the new EN keys, remove the M365 pair**

In the `tour*` cluster add:
```ts
  tourStepCount: "{0} steps",
  tourReplayCta: "Replay tour",
```
In the `infoFlowsLegend*` cluster: DELETE the `infoFlowsLegendM365Label` and `infoFlowsLegendM365Desc` lines, and add:
```ts
  infoFlowsZoneDataLabel: "Your data",
  infoFlowsZoneServicesLabel: "Connected services",
  infoFlowsLegendFileLabel: "File storage",
  infoFlowsLegendFileDesc: "Project saved as JSON, CSV or Markdown files on your device.",
  infoFlowsLegendSharePointLabel: "SharePoint",
  infoFlowsLegendSharePointDesc: "Document storage and links via Microsoft Graph.",
  infoFlowsLegendOutlookLabel: "Outlook",
  infoFlowsLegendOutlookDesc: "Contacts and calendar via Microsoft Graph.",
```

- [ ] **Step 3: Patch `i18n.de.ts` via node (umlauts/curly-quotes safe)**

Write a throwaway script `scratchpad/de-i18n.mjs` and run `node scratchpad/de-i18n.mjs`. It must (a) read `src/app/i18n.de.ts` as utf8, (b) remove the two M365 lines by exact `\r\n`-anchored match, (c) insert the new DE lines. DE values:
```
  tourStepCount: "{0} Schritte",
  tourReplayCta: "Tour wiederholen",
  infoFlowsZoneDataLabel: "Ihre Daten",
  infoFlowsZoneServicesLabel: "Verbundene Dienste",
  infoFlowsLegendFileLabel: "Dateispeicher",
  infoFlowsLegendFileDesc: "Projekt als JSON-, CSV- oder Markdown-Dateien auf Ihrem Gerät gespeichert.",
  infoFlowsLegendSharePointLabel: "SharePoint",
  infoFlowsLegendSharePointDesc: "Dokumentenspeicher und Links über Microsoft Graph.",
  infoFlowsLegendOutlookLabel: "Outlook",
  infoFlowsLegendOutlookDesc: "Kontakte und Kalender über Microsoft Graph.",
```
Script skeleton:
```js
import { readFileSync, writeFileSync } from "node:fs";
const p = "src/app/i18n.de.ts";
let s = readFileSync(p, "utf8");
// remove old M365 legend lines (CRLF file → match \r\n)
s = s.replace(/  infoFlowsLegendM365Label:.*\r\n/, "");
s = s.replace(/  infoFlowsLegendM365Desc:.*\r\n/, "");
// anchor inserts after an existing stable key line; adjust anchors to real lines
s = s.replace(/(  infoFlowsLegendTimelogDesc:.*\r\n)/, `$1  infoFlowsZoneDataLabel: "Ihre Daten",\r\n  infoFlowsZoneServicesLabel: "Verbundene Dienste",\r\n  infoFlowsLegendFileLabel: "Dateispeicher",\r\n  infoFlowsLegendFileDesc: "Projekt als JSON-, CSV- oder Markdown-Dateien auf Ihrem Gerät gespeichert.",\r\n  infoFlowsLegendSharePointLabel: "SharePoint",\r\n  infoFlowsLegendSharePointDesc: "Dokumentenspeicher und Links über Microsoft Graph.",\r\n  infoFlowsLegendOutlookLabel: "Outlook",\r\n  infoFlowsLegendOutlookDesc: "Kontakte und Kalender über Microsoft Graph.",\r\n`);
s = s.replace(/(  tourStartCta:.*\r\n)/, `$1  tourStepCount: "{0} Schritte",\r\n  tourReplayCta: "Tour wiederholen",\r\n`);
writeFileSync(p, s, "utf8");
console.log("done");
```
(Adjust the anchor regexes to keys that actually exist — verify with rg first. Use `\uXXXX` escapes for every umlaut: ä=ä, ö=ö, ü=ü.)

- [ ] **Step 4: Verify parity + umlauts**

Run: `npx tsc --noEmit`
Expected: PASS (EN/DE key sets identical — tsc enforces).
Run: `npx rg -n "fuer|ueber|Dateispeicher|wiederholen" src/app/i18n.de.ts`
Expected: real umlauts present (`über`, `Gerät`), NO ASCII subs (`fuer`/`ueber`).
Run: `npm run test:run -- i18n-encoding`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(i18n): help-redesign keys (tour step count/replay, info-flows zones + file/sharepoint/outlook)"
```

---

## Task 2: relations-graph vertical layout

Radial → single vertical column (concepts only). x fixed centre, y evenly spaced top→bottom.

**Files:**
- Modify: `src/app/relations-graph.ts`
- Test: `src/app/relations-graph.test.ts` (create if missing)

- [ ] **Step 1: Write the failing test**

Add to `src/app/relations-graph.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildRelationsGraph } from "./relations-graph";
import { HELP_ENTRIES } from "./help-content";

describe("buildRelationsGraph vertical layout", () => {
  it("lays concept nodes in a single vertical column (shared x, increasing y)", () => {
    const g = buildRelationsGraph(HELP_ENTRIES);
    expect(g.nodes.length).toBeGreaterThan(1);
    const xs = new Set(g.nodes.map((n) => Number(n.x.toFixed(4))));
    expect(xs.size).toBe(1); // one column
    const ys = g.nodes.map((n) => n.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    for (const n of g.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(1);
    }
  });

  it("keeps edges deduped + undirected (sorted a<b), no self-loops", () => {
    const g = buildRelationsGraph(HELP_ENTRIES);
    const keys = g.edges.map((e) => `${e.a}|${e.b}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of g.edges) {
      expect(e.a < e.b).toBe(true);
      expect(e.a).not.toBe(e.b);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- relations-graph`
Expected: FAIL — the column test fails (radial layout gives many distinct x values).

- [ ] **Step 3: Implement vertical layout**

Replace the `nodes` construction in `src/app/relations-graph.ts` (the `const RADIUS` + the `concepts.map` block) with:
```ts
// Vertical single-column layout: concepts stacked top→bottom at a fixed x.
// Margins keep the first/last node clear of the container edges.
const TOP = 0.08;
const BOTTOM = 0.92;
const COLUMN_X = 0.5;

const nodes: GraphNode[] = concepts.map((c, i) => ({
  id: c.id,
  titleKey: c.titleKey,
  x: COLUMN_X,
  y: n <= 1 ? 0.5 : TOP + ((BOTTOM - TOP) * i) / (n - 1),
}));
```
Delete the now-unused `const RADIUS = 0.42;` line and its comment. Update the file's top comment: "Concepts become nodes in a deterministic vertical column; …".

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- relations-graph`
Expected: PASS (both tests).
Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/relations-graph.ts src/app/relations-graph.test.ts
git commit -m "feat(help): relations graph vertical-column layout"
```

---

## Task 3: relations-map vertical render

Render the vertical column: grouped/stacked HTML buttons (interactive layer) + an aria-hidden SVG drawing edge curves down the left gutter. Keep hover/focus highlight + `onSelectConcept` contract.

**Files:**
- Modify: `src/app/relations-map.tsx`
- Test: `src/app/relations-map.test.tsx` (create if missing)

- [ ] **Step 1: Write the failing test**

Add `src/app/relations-map.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RelationsMap } from "./relations-map";
import type { RelationsGraph } from "./relations-graph";

const graph: RelationsGraph = {
  nodes: [
    { id: "a", titleKey: "navHelp", x: 0.5, y: 0.1 },
    { id: "b", titleKey: "navHelp", x: 0.5, y: 0.5 },
  ],
  edges: [{ a: "a", b: "b" }],
};

describe("RelationsMap vertical", () => {
  it("renders one keyboard button per node and calls onSelectConcept on click", () => {
    const onSelect = vi.fn();
    render(<RelationsMap graph={graph} lang="en-US" onSelectConcept={onSelect} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[0]);
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("marks the focused node active (data-active)", () => {
    render(<RelationsMap graph={graph} lang="en-US" onSelectConcept={() => {}} />);
    const buttons = screen.getAllByRole("button");
    fireEvent.focus(buttons[1]);
    expect(buttons[1].getAttribute("data-active")).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails (or passes structurally)**

Run: `npm run test:run -- relations-map`
Expected: the existing positioning still works, so these may PASS even pre-change. That's fine — they lock behaviour while we change layout. If `relations-map.test.tsx` did not exist, both should PASS after Step 3.

- [ ] **Step 3: Implement vertical render**

Replace the `return (...)` body of `RelationsMap` in `src/app/relations-map.tsx` with a flex column. The node buttons flow vertically (not absolute); the edge SVG is an overlay in a left gutter. Edges connect node `a`→`b` by their index order (use `y` for vertical position):
```tsx
  return (
    <div
      role="group"
      aria-label={t(lang, "helpRelationsMapLabel")}
      className="relative w-full rounded-md border border-line bg-surface-muted p-3 pl-8"
    >
      {/* edge overlay in the left gutter (decorative) */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-y-3 left-1 w-6"
      >
        {graph.edges.map((e) => {
          const na = graph.nodes.find((n) => n.id === e.a);
          const nb = graph.nodes.find((n) => n.id === e.b);
          if (!na || !nb) return null;
          const incident = active === e.a || active === e.b;
          const y1 = na.y * 100;
          const y2 = nb.y * 100;
          const bow = 6 + Math.min(14, Math.abs(y2 - y1) / 4);
          return (
            <path
              key={`${e.a}|${e.b}`}
              d={`M12,${y1} C${12 - bow},${(y1 + y2) / 2} ${12 - bow},${(y1 + y2) / 2} 12,${y2}`}
              fill="none"
              className={incident ? "stroke-AIPM-dark-blue" : "stroke-line"}
              strokeWidth={incident ? 1.2 : 0.7}
              opacity={active && !incident ? 0.3 : 1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      <ul className="flex flex-col gap-1.5">
        {graph.nodes.map((n) => {
          const isActive = active === n.id;
          const isNeighbour = neighbours.has(n.id);
          const dim = active && !isActive && !isNeighbour;
          return (
            <li key={n.id} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full border-2 ${
                  isActive ? "border-AIPM-dark-blue bg-AIPM-dark-blue" : isNeighbour ? "border-AIPM-green bg-surface" : "border-AIPM-dark-blue bg-surface"
                }`}
              />
              <button
                type="button"
                data-active={isActive ? "true" : "false"}
                onClick={() => onSelectConcept(n.id)}
                onMouseEnter={() => setActive(n.id)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(n.id)}
                onBlur={() => setActive(null)}
                title={t(lang, "helpRelationsOpenConcept")}
                className={`flex-1 rounded-md border border-l-2 bg-surface px-2 py-1 text-left text-xs font-medium ${
                  isActive ? "border-AIPM-dark-blue bg-AIPM-dark-blue text-white" : isNeighbour ? "border-l-AIPM-green border-line text-AIPM-dark-blue dark:text-AIPM-light-grey" : "border-l-AIPM-dark-blue border-line text-foreground"
                } ${dim ? "opacity-40" : "opacity-100"} ${INTERACTIVE}`}
              >
                {t(lang, n.titleKey)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
```
(Keep the existing `active`/`neighbours` logic above the return unchanged.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- relations-map`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/relations-map.tsx src/app/relations-map.test.tsx
git commit -m "feat(help): relations map vertical-stack render"
```

---

## Task 4: tour catalog data (app-tour + use-tour)

Extend `TourCatalogEntry` with `stepCount`+`iconView`; add `iconView` to `TourDefinition` + the 6 tours; project in `use-tour`.

**Files:**
- Modify: `src/app/app-tour.ts`
- Modify: `src/app/use-tour.ts`
- Test: `src/app/app-tour.test.ts` (add a case; create if missing)

- [ ] **Step 1: Write the failing test**

Add to `src/app/app-tour.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { TOURS } from "./app-tour";

describe("TOURS iconView", () => {
  it("every tour declares an iconView AppView", () => {
    for (const tr of TOURS) {
      expect(typeof tr.iconView).toBe("string");
      expect(tr.iconView.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- app-tour`
Expected: FAIL — `tr.iconView` is undefined.

- [ ] **Step 3: Extend the types + tour data**

In `src/app/app-tour.ts`:
- Add the import (top): `import type { AppView } from "./nav-config";` (if not already present).
- Extend `TourDefinition`:
```ts
export interface TourDefinition {
  id: string;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  iconView: AppView;
  steps: readonly TourStep[];
}
```
- Extend `TourCatalogEntry`:
```ts
export interface TourCatalogEntry {
  id: string;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  stepCount: number;
  iconView: AppView;
}
```
- Add `iconView` to each entry in `TOURS`:
```ts
export const TOURS: readonly TourDefinition[] = [
  { id: "getting-started", titleKey: "tourGettingStartedTitle", descKey: "tourGettingStartedDesc", iconView: "dashboard", steps: TOUR_STEPS },
  { id: "raid", titleKey: "tourRaidTitle", descKey: "tourRaidDesc", iconView: "raid", steps: RAID_STEPS },
  { id: "reporting", titleKey: "tourReportingTitle", descKey: "tourReportingDesc", iconView: "reports", steps: REPORTING_STEPS },
  { id: "planning", titleKey: "tourPlanningTitle", descKey: "tourPlanningDesc", iconView: "milestones", steps: PLANNING_STEPS },
  { id: "stakeholders", titleKey: "tourStakeholdersTitle", descKey: "tourStakeholdersDesc", iconView: "stakeholders", steps: STAKEHOLDER_STEPS },
  { id: "ai", titleKey: "tourAiTitle", descKey: "tourAiDesc", iconView: "chat", steps: AI_STEPS },
];
```

- [ ] **Step 4: Update the `catalogTours` projection in `use-tour.ts`**

Replace the `catalogTours` `useMemo` body in `src/app/use-tour.ts` with:
```ts
  const catalogTours = useMemo<TourCatalogEntry[]>(
    () =>
      TOURS.map((t) => ({ t, vis: visibleSteps(t.steps, features) }))
        .filter(({ vis }) => vis.length > 0)
        .map(({ t, vis }) => ({
          id: t.id,
          titleKey: t.titleKey,
          descKey: t.descKey,
          stepCount: vis.length,
          iconView: t.iconView,
        })),
    [features],
  );
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test:run -- app-tour use-tour`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: PASS (any test fixture building a `TourCatalogEntry` will fail tsc — fix those fixtures to include `stepCount`+`iconView`; see Task 5).

- [ ] **Step 6: Commit**

```bash
git add src/app/app-tour.ts src/app/use-tour.ts src/app/app-tour.test.ts
git commit -m "feat(tour): catalog entries carry stepCount + iconView"
```

---

## Task 5: tour catalog card UI

Icon badge + step-count meta + dark-blue stripe + start/replay CTA.

**Files:**
- Modify: `src/app/tour-catalog.tsx`
- Test: `src/app/tour-catalog.test.tsx` (create if missing; update fixtures for new entry fields)

- [ ] **Step 1: Write the failing test**

Create/replace `src/app/tour-catalog.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TourCatalog } from "./tour-catalog";
import type { TourCatalogEntry } from "./app-tour";

const tours: TourCatalogEntry[] = [
  { id: "getting-started", titleKey: "tourGettingStartedTitle", descKey: "tourGettingStartedDesc", stepCount: 12, iconView: "dashboard" },
  { id: "raid", titleKey: "tourRaidTitle", descKey: "tourRaidDesc", stepCount: 3, iconView: "raid" },
];

describe("TourCatalog", () => {
  it("shows the step count and a Start CTA for an unfinished tour", () => {
    render(<TourCatalog lang="en-US" tours={tours} completedTours={[]} onStartTour={() => {}} />);
    expect(screen.getByText("12 steps")).toBeTruthy();
    expect(screen.getAllByText(/start tour/i).length).toBeGreaterThan(0);
  });

  it("shows a Replay CTA + done badge for a completed tour", () => {
    render(<TourCatalog lang="en-US" tours={tours} completedTours={["raid"]} onStartTour={() => {}} />);
    expect(screen.getByText(/replay tour/i)).toBeTruthy();
  });

  it("fires onStartTour with the tour id", () => {
    const onStart = vi.fn();
    render(<TourCatalog lang="en-US" tours={tours} completedTours={[]} onStartTour={onStart} />);
    screen.getAllByRole("button")[0].click();
    expect(onStart).toHaveBeenCalledWith("getting-started");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tour-catalog`
Expected: FAIL — "12 steps" / "Replay tour" not in the DOM yet.

- [ ] **Step 3: Implement the card UI**

Replace `src/app/tour-catalog.tsx` body. Add imports `import { NavIcon } from "./nav-icons";`. New render:
```tsx
export function TourCatalog({ lang, tours, completedTours, onStartTour }: TourCatalogProps) {
  const done = new Set(completedTours);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {tours.map((tour) => {
        const isDone = done.has(tour.id);
        return (
          <button
            key={tour.id}
            type="button"
            onClick={() => onStartTour(tour.id)}
            aria-label={`${t(lang, "tourStartCta")} – ${t(lang, tour.titleKey)}`}
            className={`flex gap-3 rounded-md border border-line border-l-[3px] border-l-AIPM-dark-blue bg-surface p-3 text-left hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
          >
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                isDone ? "bg-AIPM-green/15 text-AIPM-green-strong" : "bg-surface-muted text-AIPM-dark-blue"
              }`}
            >
              {isDone ? "✓" : <NavIcon view={tour.iconView} className="h-4 w-4" />}
            </span>
            <span className="flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{t(lang, tour.titleKey)}</span>
                {isDone && (
                  <span className="shrink-0 rounded-full bg-AIPM-green/15 px-2 py-0.5 text-[10px] font-medium text-AIPM-green-strong">
                    <span aria-hidden="true">✓ </span>
                    {t(lang, "tourDoneBadge")}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
                {t(lang, "tourStepCount", String(tour.stepCount))}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t(lang, tour.descKey)}</span>
              <span className="mt-1 block text-xs font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">
                {isDone ? t(lang, "tourReplayCta") : t(lang, "tourStartCta")} →
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- tour-catalog`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/tour-catalog.tsx src/app/tour-catalog.test.tsx
git commit -m "feat(tour): richer catalog cards (icon, step count, stripe, replay)"
```

---

## Task 6: help content pane — cards + scroll-spy

**Files:**
- Modify: `src/app/help-content-pane.tsx`
- Test: `src/app/help-content-pane.test.tsx` (create if missing)

- [ ] **Step 1: Write the failing test**

Create `src/app/help-content-pane.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpContentPane, helpSectionId } from "./help-content-pane";
import { HELP_ENTRIES } from "./help-content";

describe("HelpContentPane", () => {
  it("renders a section element per help entry with the shared id", () => {
    const { container } = render(<HelpContentPane lang="en-US" query="" />);
    const first = HELP_ENTRIES[0];
    expect(container.querySelector(`#${CSS.escape(helpSectionId(first.id))}`)).toBeTruthy();
  });

  it("activates a TOC item on click", () => {
    render(<HelpContentPane lang="en-US" query="" />);
    const tocButtons = screen.getAllByRole("button");
    fireEvent.click(tocButtons[0]);
    // the clicked TOC button gets the active styling marker class
    expect(tocButtons[0].className).toContain("border-AIPM-dark-blue");
  });
});
```
(jsdom has no layout → the IntersectionObserver path is not exercised; we assert structure + click-active only.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- help-content-pane`
Expected: FAIL — file may already pass structurally; if so, it still locks behaviour. If `CSS.escape` is unavailable in the jsdom env, switch the query to `container.querySelector('[id^="help-sec-"]')`.

- [ ] **Step 3: Add scroll-spy + the content ref**

In `src/app/help-content-pane.tsx`, change the imports line to include `useEffect`, `useRef`:
```ts
import { useEffect, useMemo, useRef, useState } from "react";
```
Inside the component, after `const [activeId, setActiveId] = useState<string | null>(null);` add:
```ts
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Stable key of the rendered section ids → re-create the observer when the
  // filtered set changes (search). Hoisted scalar avoids the exhaustive-deps
  // "obj.member" rejection.
  const sectionIdsKey = groups.flatMap((g) => g.entries.map((e) => e.id)).join(",");
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>("section[id]"));
    if (sections.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        const id = top.target.id.replace(/^help-sec-/, "");
        setActiveId(id);
      },
      { root, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    sections.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, [sectionIdsKey]);
```
(Place the `sectionIdsKey`/`useEffect` AFTER the `groups` memo so `groups` is in scope.)

- [ ] **Step 4: Apply the card + wider-TOC styling**

In the same file:
- TOC `<nav>`: change `@[560px]:w-52` → `@[560px]:w-56`.
- TOC group label `<p>`: change `text-[10px]` → `text-xs`.
- TOC item buttons: change `text-xs` → `text-sm`, `py-1` → `py-1.5` (both active + inactive class strings).
- Content scroller `<div>`: add `bg-surface-muted` and attach the ref — change to:
```tsx
      <div ref={contentRef} className="min-h-0 flex-1 overflow-auto bg-surface-muted p-3 pr-2 print:max-h-none print:overflow-visible">
```
- Group block wrapper: change `mb-6` → `mb-8`.
- Each `<section>`: wrap its content as a card. Replace the `<section …>` opening + its inner `<h3>`/`<p>`/related block container so the section is a card:
```tsx
                <section key={e.id} id={helpSectionId(e.id)} className="scroll-mt-2 rounded-lg border border-line border-l-[3px] border-l-AIPM-dark-blue bg-surface p-4">
```
  and change the cards gap on the inner `<div className="flex flex-col gap-4">` → `gap-3`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test:run -- help-content-pane`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: PASS.
Run: `npm run lint`
Expected: PASS (no unused `useRef`/`useEffect`; exhaustive-deps satisfied by `sectionIdsKey`).

- [ ] **Step 6: Commit**

```bash
git add src/app/help-content-pane.tsx src/app/help-content-pane.test.tsx
git commit -m "feat(help): card content sections + scroll-spy TOC"
```

---

## Task 7: information-flows — grouped, colour-coded, 9 nodes

Rebuild the SVG (option-B tight horizontal) with zones, green/dark-blue accents, File-storage node, M365→SharePoint+Outlook. Extend the legend.

**Files:**
- Modify: `src/app/information-flows-section.tsx`
- Test: `src/app/information-flows-section.test.tsx` (create if missing)

- [ ] **Step 1: Write the failing test**

Create `src/app/information-flows-section.test.tsx`:
```tsx
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { InformationFlowsSection } from "./information-flows-section";
import { loadI18n } from "./i18n";

beforeAll(async () => { await loadI18n("de"); });

describe("InformationFlowsSection", () => {
  it("renders the new storage + service nodes (File storage, SharePoint, Outlook)", () => {
    const { container } = render(<InformationFlowsSection lang="en-US" />);
    const txt = container.textContent ?? "";
    expect(txt).toContain("File storage");
    expect(txt).toContain("SharePoint");
    expect(txt).toContain("Outlook");
    expect(txt).not.toContain("Microsoft 365"); // split
  });

  it("keeps an accessible img-role diagram", () => {
    render(<InformationFlowsSection lang="en-US" />);
    expect(screen.getByRole("img")).toBeTruthy();
  });

  it("renders both zone labels", () => {
    const { container } = render(<InformationFlowsSection lang="en-US" />);
    expect(container.textContent).toContain("Your data");
    expect(container.textContent).toContain("Connected services");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- information-flows-section`
Expected: FAIL — "File storage"/"SharePoint"/"Outlook"/zone labels not present; "Microsoft 365" still present.

- [ ] **Step 3: Rebuild the SVG + nodes**

Rewrite `src/app/information-flows-section.tsx`. Keep the `DiagramTitle`/`ArrowDefs` pattern + `role="img"`+`aria-label`+`<title>`/`<desc>`. New `viewBox="0 0 480 300"`, `style={{ maxWidth: 480 }}`. Node layout (option-B tight horizontal):
- LEFT zone "Your data" (dashed group rect, green zone label) — 3 stacked nodes, green stroke + 3px green left edge: `Local storage` (IndexedDB), `File storage` (JSON / CSV / MD), `Turso` (cloud DB).
- CENTRE `Browser app` hub (dark-blue fill, green stroke).
- RIGHT zone "Connected services" (dashed group rect, dark-blue zone label) — dark-blue stroke + 3px dark-blue left edge: `Jira`, `Timelog`, `SharePoint`, `Outlook` (2×2) + `Anthropic` (full-width row).
- Connector lines hub↔each node (existing markers).

Helper for a node:
```tsx
function Node({ x, y, w, title, sub, accent }: { x: number; y: number; w: number; title: string; sub?: string; accent: "green" | "blue" | "hub" }) {
  const stroke = accent === "green" ? "var(--AIPM-green)" : "var(--AIPM-dark-blue)";
  const fill = accent === "hub" ? "var(--AIPM-dark-blue)" : "var(--AIPM-white)";
  const titleFill = accent === "hub" ? "var(--AIPM-white)" : "var(--AIPM-dark-blue)";
  const subFill = accent === "hub" ? "var(--AIPM-green)" : "var(--AIPM-dark-grey)";
  const h = sub ? 44 : 30;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="7" fill={fill} stroke={stroke} strokeWidth={accent === "hub" ? 2 : 1.5} />
      {/* left accent edge (skip on hub) */}
      {accent !== "hub" && <rect x={x} y={y} width="3" height={h} rx="1.5" fill={stroke} />}
      <text x={x + w / 2} y={y + (sub ? 18 : 19)} textAnchor="middle" fill={titleFill} fontSize="10.5" fontWeight="600">{title}</text>
      {sub && <text x={x + w / 2} y={y + 33} textAnchor="middle" fill={subFill} fontSize="8.5">{sub}</text>}
    </g>
  );
}
```
Zone rects + labels:
```tsx
function Zone({ x, y, w, h, label, color }: { x: number; y: number; w: number; h: number; label: string; color: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" fill="none" stroke="var(--AIPM-medium-grey)" strokeWidth="1" strokeDasharray="4 3" />
      <text x={x + 10} y={y + 12} fill={color} fontSize="9" fontWeight="700" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</text>
    </g>
  );
}
```
Compose in the main `<svg>` (replace the old node components + `Connectors`). Approx coords (viewBox 480×300):
- Left zone: `x=8 y=20 w=120 h=200`; nodes inside at `x=18 w=100`: Local `y=40`, File `y=96`, Turso `y=152`.
- Hub: `Node x=190 y=120 w=100 sub` (Browser app / (this PWA), accent "hub").
- Right zone: `x=300 y=20 w=172 h=200`; service nodes `w=78`: Jira `x=310 y=40`, Timelog `x=394 y=40`, SharePoint `x=310 y=84`, Outlook `x=394 y=84`, Anthropic `x=310 y=140 w=162 sub="AI chat"`.
- Connectors (`stroke="var(--AIPM-medium-grey)" strokeWidth=1.5 markerEnd/markerStart` as today) from hub edges to each node centre.
Use the EN node strings hardcoded (matches the existing pattern — only the legend `<dl>` is i18n).

- [ ] **Step 4: Update the Legend `<dl>` + add swatches**

In the `Legend` component, replace the `items` array's M365 entry and add File storage + split rows. Use the new keys:
```ts
  const items = [
    { labelKey: "infoFlowsLegendLocalLabel", descKey: "infoFlowsLegendLocalDesc" },
    { labelKey: "infoFlowsLegendFileLabel", descKey: "infoFlowsLegendFileDesc" },
    { labelKey: "infoFlowsLegendTursoLabel", descKey: "infoFlowsLegendTursoDesc" },
    { labelKey: "infoFlowsLegendJiraLabel", descKey: "infoFlowsLegendJiraDesc" },
    { labelKey: "infoFlowsLegendTimelogLabel", descKey: "infoFlowsLegendTimelogDesc" },
    { labelKey: "infoFlowsLegendSharePointLabel", descKey: "infoFlowsLegendSharePointDesc" },
    { labelKey: "infoFlowsLegendOutlookLabel", descKey: "infoFlowsLegendOutlookDesc" },
    { labelKey: "infoFlowsLegendAnthropicLabel", descKey: "infoFlowsLegendAnthropicDesc" },
  ] as const;
```
Above the `<dl>`, add a swatch row:
```tsx
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-AIPM-green" aria-hidden="true" />{t(lang, "infoFlowsZoneDataLabel")}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-AIPM-dark-blue" aria-hidden="true" />{t(lang, "infoFlowsZoneServicesLabel")}</span>
      </div>
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test:run -- information-flows-section`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: PASS (the removed `infoFlowsLegendM365*` keys must not be referenced anywhere — `npx rg -n "infoFlowsLegendM365" src` should return nothing).

- [ ] **Step 6: Commit**

```bash
git add src/app/information-flows-section.tsx src/app/information-flows-section.test.tsx
git commit -m "feat(settings): info-flows grouped/colour-coded diagram, 9 nodes (file storage; M365→SharePoint+Outlook)"
```

---

## Task 8: help collapsible region (horizontal accordion)

New exclusive horizontal accordion: Tours / Connects / Flows. Default open = first available.

**Files:**
- Create: `src/app/help-collapsible-region.tsx`
- Test: `src/app/help-collapsible-region.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/help-collapsible-region.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpCollapsibleRegion } from "./help-collapsible-region";

function setup() {
  return render(
    <HelpCollapsibleRegion
      lang="en-US"
      panels={[
        { key: "tours", titleKey: "helpGuidedToursTitle", body: <div>TOURS BODY</div> },
        { key: "connects", titleKey: "helpRelationsTitle", body: <div>CONNECTS BODY</div> },
        { key: "flows", titleKey: "infoFlowsTitle", body: <div>FLOWS BODY</div> },
      ]}
    />,
  );
}

describe("HelpCollapsibleRegion", () => {
  it("opens the first panel by default", () => {
    setup();
    expect(screen.getByText("TOURS BODY")).toBeTruthy();
    expect(screen.queryByText("CONNECTS BODY")).toBeNull();
  });

  it("is exclusive: opening one collapses the others", () => {
    setup();
    const bars = screen.getAllByRole("button");
    const connectsBar = bars.find((b) => b.getAttribute("aria-expanded") === "false" && /connect|how it/i.test(b.textContent || b.getAttribute("aria-label") || ""));
    fireEvent.click(connectsBar!);
    expect(screen.getByText("CONNECTS BODY")).toBeTruthy();
    expect(screen.queryByText("TOURS BODY")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- help-collapsible-region`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the component**

Create `src/app/help-collapsible-region.tsx`:
```tsx
"use client";

import { useState, type ReactNode } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { INTERACTIVE, FOCUS_RING } from "./interaction-styles";

export interface HelpPanel {
  key: string;
  titleKey: TranslationKey;
  body: ReactNode;
}

/** Exclusive horizontal accordion for the Help-view top region. One panel open
 *  at a time; the others collapse to a thin vertical bar. Open-state ephemeral
 *  (useState), never persisted. Each bar/header is a keyboard button with
 *  aria-expanded/aria-controls. Stacks vertically on a narrow container. */
export function HelpCollapsibleRegion({ lang, panels }: { lang: Lang; panels: readonly HelpPanel[] }) {
  const [openKey, setOpenKey] = useState<string>(panels[0]?.key ?? "");
  if (panels.length === 0) return null;
  return (
    <div className="@container mb-2 shrink-0 print:hidden">
      <div className="flex flex-col gap-2 @[560px]:h-60 @[560px]:flex-row">
        {panels.map((p) => {
          const isOpen = p.key === openKey;
          const bodyId = `help-acc-${p.key}`;
          if (isOpen) {
            return (
              <section key={p.key} className="flex min-h-0 flex-1 flex-col rounded-lg border border-line border-l-[3px] border-l-AIPM-dark-blue bg-surface">
                <button
                  type="button"
                  aria-expanded="true"
                  aria-controls={bodyId}
                  onClick={() => setOpenKey(p.key)}
                  className={`flex shrink-0 items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-foreground ${FOCUS_RING}`}
                >
                  <span aria-hidden="true">▾</span> {t(lang, p.titleKey)}
                </button>
                <div id={bodyId} className="min-h-0 flex-1 overflow-auto px-3 pb-3 pr-2">
                  {p.body}
                </div>
              </section>
            );
          }
          return (
            <button
              key={p.key}
              type="button"
              aria-expanded="false"
              aria-controls={bodyId}
              onClick={() => setOpenKey(p.key)}
              className={`flex shrink-0 items-center justify-center rounded-lg border border-line bg-surface py-2 text-AIPM-dark-blue hover:border-AIPM-dark-blue hover:bg-surface-muted @[560px]:w-9 @[560px]:py-0 dark:text-AIPM-light-grey ${INTERACTIVE}`}
            >
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide @[560px]:[writing-mode:vertical-rl] @[560px]:rotate-180">
                <span aria-hidden="true">▸</span> {t(lang, p.titleKey)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- help-collapsible-region`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: PASS. (If `infoFlowsTitle` is not an existing key, the test uses it as a `TranslationKey` literal — confirm it exists: `npx rg -n "infoFlowsTitle" src/app/i18n.ts`. If absent, use `navHelp` in the test fixture and the real title key in Task 9.)

- [ ] **Step 5: Commit**

```bash
git add src/app/help-collapsible-region.tsx src/app/help-collapsible-region.test.tsx
git commit -m "feat(help): exclusive horizontal accordion region"
```

---

## Task 9: wire the accordion into the Help view + mount info-flows

Replace the two `<details>` (tours + relations) with `HelpCollapsibleRegion`; add the info-flows panel.

**Files:**
- Modify: `src/app/help-view.tsx`

- [ ] **Step 1: Confirm the info-flows title key**

Run: `npx rg -n "infoFlowsTitle|navHelp|infoFlowsIntro" src/app/i18n.ts`
Expected: identify the key used for the info-flows section header. If `infoFlowsTitle` does not exist, reuse the existing settings label (e.g. the Integrations info-flows heading key) — note the exact key for Step 2.

- [ ] **Step 2: Add imports + build the panels**

In `src/app/help-view.tsx`:
- Add imports:
```ts
import { HelpCollapsibleRegion, type HelpPanel } from "./help-collapsible-region";
import { InformationFlowsSection } from "./information-flows-section";
```
- Replace the two `<details>…</details>` blocks (the `onStartTour && (...)` tours details AND the relations details, lines ~94–115) with:
```tsx
      <HelpCollapsibleRegion
        lang={lang}
        panels={[
          ...(onStartTour
            ? ([{
                key: "tours",
                titleKey: "helpGuidedToursTitle",
                body: (
                  <TourCatalog
                    lang={lang}
                    tours={catalogTours ?? []}
                    completedTours={completedTours ?? []}
                    onStartTour={onStartTour}
                  />
                ),
              }] as HelpPanel[])
            : []),
          {
            key: "connects",
            titleKey: "helpRelationsTitle",
            body: <RelationsMap graph={graph} lang={lang} onSelectConcept={scrollToSection} />,
          },
          {
            key: "flows",
            titleKey: "infoFlowsTitle",
            body: <InformationFlowsSection lang={lang} />,
          },
        ]}
      />
```
(Use the real info-flows title key from Step 1 in place of `"infoFlowsTitle"` if different.)

- [ ] **Step 3: Typecheck + lint + existing help-view tests**

Run: `npx tsc --noEmit`
Expected: PASS.
Run: `npm run test:run -- help-view`
Expected: PASS (the standalone `help-view.test.tsx` renders without `onStartTour` → tours panel absent, connects+flows present; if a test asserted the old `<details>` summary text via `helpGuidedToursTitle`, it still resolves as the accordion bar label).
Run: `npm run lint`
Expected: PASS (no unused imports — `helpGuidedToursIntro`/`helpRelationsIntro` were only used by the removed `<details>`; if now unused they trigger NO error since they're i18n keys, not imports — but remove any now-dead local variables).

- [ ] **Step 4: Commit**

```bash
git add src/app/help-view.tsx
git commit -m "feat(help): accordion top region (tours/connects/info-flows) in Help view"
```

---

## Task 10: floating Help panel — size + storage key bump

**Files:**
- Modify: `src/app/help-menu.tsx`

- [ ] **Step 1: Bump the storage key + default size**

In `src/app/help-menu.tsx`:
- Change `const STORAGE_KEY_SIZE = "lop-app:help-size-v2";` → `"lop-app:help-size-v3";`
- In the first-open `useEffect`, change the fallbacks `?? 760` → `?? 820` and `?? 620` → `?? 640`.
- In the panel `className`, change `h-[620px]` → `h-[640px]` and `w-[760px]` → `w-[820px]`.

- [ ] **Step 2: Typecheck + the view-pane sweep test (chat assertion unaffected)**

Run: `npx tsc --noEmit`
Expected: PASS.
Run: `npm run test:run -- view-pane-sweep help-menu`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/help-menu.tsx
git commit -m "feat(help): floating panel 820x640 + storage key v3"
```

---

## Task 11: full verification + eye-check

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck + unit suite**

Run: `npx tsc --noEmit`
Expected: PASS.
Run: `npm run test:run`
Expected: PASS (all suites).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS (`--max-warnings=0`: no unused imports/vars, exhaustive-deps clean).

- [ ] **Step 3: Settings axe gate (info-flows is in a scanned view)**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"`
Expected: PASS (no axe-critical; SVG `role=img`+aria-label intact, swatch spans aria-hidden).

- [ ] **Step 4: Eye-verify (manual; jsdom has no layout)**

Run `npm run dev`, then in the browser:
- Help view: accordion default = Guided tours; click Connects bar → tours collapse, vertical relations map shows; click Flows bar → tours+connects collapse, info-flows option-B shows. Cards in content pane have dark-blue stripe; TOC active item tracks scroll. Tour cards show icon + step count; a completed tour shows ✓ + Replay.
- Floating Help panel (top-bar ? button): 820×640, content-pane cards + scroll-spy; no accordion.
- Settings → Integrations: info-flows diagram grouped/colour-coded, 9 nodes, swatch legend.
- Toggle dark mode + (if available) Mockup style: stripes/zones still on-palette.

- [ ] **Step 5: No stray references to removed keys**

Run: `npx rg -n "infoFlowsLegendM365|help-size-v2|RADIUS" src/app`
Expected: no matches (M365 keys gone, old storage key gone, radial RADIUS const gone).

---

## Self-Review notes (author)

- **Spec coverage:** §1 content pane → Task 6; §1c floating size → Task 10; §2 accordion → Tasks 8–9; §3 tour data+UI → Tasks 4–5; §4 relations vertical → Tasks 2–3; §5 info-flows 9 nodes → Task 7; i18n → Task 1. All covered.
- **Type consistency:** `TourCatalogEntry` gains `stepCount:number`+`iconView:AppView` (Task 4) and every fixture/consumer updated (Tasks 4,5,9). `HelpPanel` shape defined in Task 8, used in Task 9. `infoFlowsTitle` key existence verified in Tasks 8/9 Step 1 (fallback noted).
- **Relations graph is concepts-only** — vertical column is a single group (no multi-group), consistent with `buildRelationsGraph` filtering `e.group === "concepts"`.
- **Palette:** all new colour via `AIPM-*` tokens / `var(--AIPM-*)`; stripes concrete (`border-l-AIPM-dark-blue`), no wildcard/pipe in arbitrary brackets; no shadow.
