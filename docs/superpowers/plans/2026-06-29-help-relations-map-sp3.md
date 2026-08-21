# Help Relations Map (SP3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed an interactive SVG node graph of the Help concepts (edges = related concepts) in the Help view; clicking a node scrolls to its explanation, and the per-concept Related line gains clickable view navigation. EN + DE.

**Architecture:** A pure layout engine (`relations-graph.ts`) computes deterministic radial fractional node coords + a deduped undirected concept-concept edge list from `HELP_ENTRIES`. A presentational `relations-map.tsx` renders edges in a decorative `aria-hidden` SVG overlaid by real absolutely-positioned HTML node buttons (keyboard-native, axe-clean), with a local hover/focus highlight. `help-view.tsx` mounts the map in a `<details open>` and upgrades the Related-line view spans into navigate buttons via a new optional `onNavigateView` prop, wired from `workspace-section.tsx` to `setActiveTab`.

**Tech Stack:** Next.js 16 (forked) / React 19 / TypeScript / Tailwind v4 / vitest. No new deps.

---

### Task 1: Layout engine `relations-graph.ts`

**Files:**
- Create: `src/app/relations-graph.ts`
- Test: `src/app/relations-graph.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildRelationsGraph } from "./relations-graph";
import { HELP_ENTRIES } from "./help-content";

describe("buildRelationsGraph", () => {
  const concepts = HELP_ENTRIES.filter((e) => e.group === "concepts");
  const graph = buildRelationsGraph(HELP_ENTRIES);

  it("has one node per concept entry, in order", () => {
    expect(graph.nodes.map((n) => n.id)).toEqual(concepts.map((c) => c.id));
  });

  it("places every node inside the unit box", () => {
    for (const n of graph.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(1);
    }
  });

  it("only emits edges between real concept nodes, deduped, no self-loops", () => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    const seen = new Set<string>();
    for (const e of graph.edges) {
      expect(ids.has(e.a)).toBe(true);
      expect(ids.has(e.b)).toBe(true);
      expect(e.a).not.toBe(e.b);
      expect(e.a < e.b).toBe(true); // sorted key
      const key = `${e.a}|${e.b}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("includes the milestone↔dependency relation", () => {
    const keys = graph.edges.map((e) => `${e.a}|${e.b}`);
    expect(keys).toContain("concept-dependency|concept-milestone");
  });

  it("is deterministic", () => {
    expect(buildRelationsGraph(HELP_ENTRIES)).toEqual(buildRelationsGraph(HELP_ENTRIES));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- relations-graph`
Expected: FAIL — `buildRelationsGraph` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// Pure, i18n-free layout engine for the Help relations map (SP3).
// Concepts become nodes on a deterministic radial layout; their mutual
// `relatedConcepts` references become deduped undirected edges. No DOM, no
// Date/Math.random — output is a pure function of HELP_ENTRIES.
import type { HelpEntry } from "./help-content";
import type { TranslationKey } from "./i18n";

export interface GraphNode {
  id: string;
  titleKey: TranslationKey;
  x: number; // ∈ [0,1]
  y: number; // ∈ [0,1]
}
export interface GraphEdge {
  a: string; // sorted: a < b
  b: string;
}
export interface RelationsGraph {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

/** Radius of the node circle within the unit box (leaves margin for button chrome). */
const RADIUS = 0.42;

export function buildRelationsGraph(entries: readonly HelpEntry[]): RelationsGraph {
  const concepts = entries.filter((e) => e.group === "concepts");
  const ids = new Set(concepts.map((c) => c.id));
  const n = concepts.length;

  const nodes: GraphNode[] = concepts.map((c, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return {
      id: c.id,
      titleKey: c.titleKey,
      x: 0.5 + RADIUS * Math.cos(angle),
      y: 0.5 + RADIUS * Math.sin(angle),
    };
  });

  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const c of concepts) {
    for (const rid of c.relatedConcepts ?? []) {
      if (rid === c.id || !ids.has(rid)) continue;
      const [a, b] = c.id < rid ? [c.id, rid] : [rid, c.id];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b });
    }
  }

  return { nodes, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- relations-graph`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
```bash
git add src/app/relations-graph.ts src/app/relations-graph.test.ts
git commit -m "feat(help): pure relations-graph layout engine (SP3)"
```

---

### Task 2: Map component `relations-map.tsx`

**Files:**
- Create: `src/app/relations-map.tsx`
- Test: `src/app/relations-map.test.tsx`
- Reference: `src/app/interaction-styles.ts` (INTERACTIVE atom), `src/app/relations-graph.ts`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RelationsMap } from "./relations-map";
import { buildRelationsGraph } from "./relations-graph";
import { HELP_ENTRIES } from "./help-content";
import { t } from "./i18n";

describe("RelationsMap", () => {
  const graph = buildRelationsGraph(HELP_ENTRIES);

  it("renders one button per concept node", () => {
    render(<RelationsMap graph={graph} lang="en-US" onSelectConcept={() => {}} />);
    for (const n of graph.nodes) {
      expect(screen.getByRole("button", { name: t("en-US", n.titleKey) })).toBeInTheDocument();
    }
  });

  it("calls onSelectConcept with the node id on click", () => {
    const onSelect = vi.fn();
    render(<RelationsMap graph={graph} lang="en-US" onSelectConcept={onSelect} />);
    const first = graph.nodes[0];
    fireEvent.click(screen.getByRole("button", { name: t("en-US", first.titleKey) }));
    expect(onSelect).toHaveBeenCalledWith(first.id);
  });

  it("marks the hovered node active", () => {
    render(<RelationsMap graph={graph} lang="en-US" onSelectConcept={() => {}} />);
    const first = graph.nodes[0];
    const btn = screen.getByRole("button", { name: t("en-US", first.titleKey) });
    fireEvent.mouseEnter(btn);
    expect(btn).toHaveAttribute("data-active", "true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- relations-map`
Expected: FAIL — `RelationsMap` not exported.

- [ ] **Step 3: Write minimal implementation**

```tsx
"use client";

import { useState } from "react";
import { type Lang, t } from "./i18n";
import type { RelationsGraph } from "./relations-graph";
import { INTERACTIVE } from "./interaction-styles";

interface RelationsMapProps {
  graph: RelationsGraph;
  lang: Lang;
  onSelectConcept: (id: string) => void;
}

/** Interactive concept relations map (SP3). Decorative aria-hidden SVG draws
 *  the edges; real absolutely-positioned HTML buttons are the keyboard-native,
 *  axe-clean interactive nodes. Hover/focus highlights a node's incident edges
 *  and neighbours. Presentational — no context, no persistence. */
export function RelationsMap({ graph, lang, onSelectConcept }: RelationsMapProps) {
  const [active, setActive] = useState<string | null>(null);

  const neighbours = new Set<string>();
  if (active) {
    for (const e of graph.edges) {
      if (e.a === active) neighbours.add(e.b);
      else if (e.b === active) neighbours.add(e.a);
    }
  }

  return (
    <div
      role="group"
      aria-label={t(lang, "helpRelationsMapLabel")}
      className="relative aspect-[3/2] max-h-80 w-full rounded-md border border-line bg-surface-muted"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        {graph.edges.map((e) => {
          const na = graph.nodes.find((n) => n.id === e.a);
          const nb = graph.nodes.find((n) => n.id === e.b);
          if (!na || !nb) return null;
          const incident = active === e.a || active === e.b;
          return (
            <line
              key={`${e.a}|${e.b}`}
              x1={na.x * 100}
              y1={na.y * 100}
              x2={nb.x * 100}
              y2={nb.y * 100}
              className={incident ? "stroke-AIPM-dark-blue" : "stroke-line"}
              strokeWidth={incident ? 0.8 : 0.4}
              opacity={active && !incident ? 0.3 : 1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {graph.nodes.map((n) => (
          <circle key={n.id} cx={n.x * 100} cy={n.y * 100} r={0.8} className="fill-AIPM-dark-blue" />
        ))}
      </svg>

      {graph.nodes.map((n) => {
        const isActive = active === n.id;
        const isNeighbour = neighbours.has(n.id);
        const dim = active && !isActive && !isNeighbour;
        return (
          <button
            key={n.id}
            type="button"
            data-active={isActive ? "true" : "false"}
            onClick={() => onSelectConcept(n.id)}
            onMouseEnter={() => setActive(n.id)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(n.id)}
            onBlur={() => setActive(null)}
            title={t(lang, "helpRelationsOpenConcept")}
            style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border bg-surface px-2 py-1 text-xs font-medium text-foreground ${
              isActive || isNeighbour ? "border-AIPM-dark-blue" : "border-line"
            } ${dim ? "opacity-40" : "opacity-100"} ${INTERACTIVE}`}
          >
            {t(lang, n.titleKey)}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- relations-map`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
```bash
git add src/app/relations-map.tsx src/app/relations-map.test.tsx
git commit -m "feat(help): RelationsMap SVG+overlay component (SP3)"
```

---

### Task 3: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts` (node utf8 write — Edit corrupts umlauts/curly-quotes; CRLF `\r\n` anchors)

- [ ] **Step 1: Add the EN keys** (place after the SP2 `viewHint*`/`showViewHints*` block in `i18n.ts`)

```ts
  helpRelationsTitle: "How it all connects",
  helpRelationsIntro: "Hover a topic to see its links; click one to read about it.",
  helpRelationsMapLabel: "Concept relationship map",
  helpRelationsOpenConcept: "Show explanation",
  helpRelationsGoToView: "Go to {0}",
```

- [ ] **Step 2: Add the matching DE keys** via a node utf8 script (NOT the Edit tool). Anchor on the SP2 DE block's last line with `\r\n`. DE values:

```
  helpRelationsTitle: "Wie alles zusammenhängt",
  helpRelationsIntro: "Fahren Sie über ein Thema, um seine Verknüpfungen zu sehen; klicken Sie eines an, um es zu lesen.",
  helpRelationsMapLabel: "Beziehungskarte der Konzepte",
  helpRelationsOpenConcept: "Erklärung anzeigen",
  helpRelationsGoToView: "Zu {0} wechseln",
```

Use a node script that reads `i18n.de.ts` as utf8, inserts the block after the SP2 anchor (matched with `\r\n`), writes back utf8. Verify umlauts intact with a grep for `zusammenhängt`/`über`/`Erklärung`.

- [ ] **Step 3: Verify parity + encoding**

Run: `npx tsc --noEmit` (enforces EN/DE key parity + `TranslationKey` validity)
Run: `npm run test:run -- i18n-encoding` (bans ASCII umlaut subs)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(help): EN/DE strings for relations map (SP3)"
```

---

### Task 4: Mount in Help view + upgrade Related-line view navigation

**Files:**
- Modify: `src/app/help-view.tsx`
- Modify: `src/app/help-view.test.tsx`
- Reference: `src/app/nav-config.ts` (`AppView`, `navLabelKey`)

- [ ] **Step 1: Write the failing tests** (append to `help-view.test.tsx`)

```tsx
  it("renders the relations map disclosure", () => {
    render(<HelpView lang="en-US" />);
    expect(screen.getByText("How it all connects")).toBeInTheDocument();
    // a concept node button exists inside the map (e.g. "Milestone")
    expect(screen.getAllByRole("button", { name: "Milestone" }).length).toBeGreaterThan(0);
  });

  it("navigates to a related view when onNavigateView is provided", () => {
    const onNav = vi.fn();
    render(<HelpView lang="en-US" onNavigateView={onNav} />);
    // concept-raid relates to view "raid"; its Related line renders a nav button.
    const btn = screen.getByRole("button", { name: /go to raid/i });
    fireEvent.click(btn);
    expect(onNav).toHaveBeenCalledWith("raid");
  });
```

(Add `fireEvent` to the existing `@testing-library/react` import if not present.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:run -- help-view`
Expected: FAIL — no "How it all connects" text / no "Go to RAID" button.

- [ ] **Step 3: Implement**

In `help-view.tsx`:

1. Add imports:
```tsx
import type { AppView } from "./nav-config";
import { buildRelationsGraph } from "./relations-graph";
import { RelationsMap } from "./relations-map";
import { HELP_ENTRIES, HELP_GROUP_ORDER, HELP_GROUP_LABEL } from "./help-content"; // already imported — keep
```

2. Add the prop to the destructure + type:
```tsx
  onNavigateView,
  // …
  /** Navigate to a related view from a concept's Related line (SP3). */
  onNavigateView?: (view: AppView) => void;
```

3. Build the graph once (top of component, after `useResizable`):
```tsx
  const graph = useMemo(() => buildRelationsGraph(HELP_ENTRIES), []);
```

4. Render the disclosure immediately before the bordered `groups` container `<div className="flex min-h-0 flex-1 …">`:
```tsx
      <details open className="mb-2 shrink-0 print:hidden">
        <summary className={`cursor-pointer text-sm font-medium text-foreground ${FOCUS_RING}`}>
          {t(lang, "helpRelationsTitle")}
        </summary>
        <p className="mb-2 mt-1 text-xs text-muted-foreground">{t(lang, "helpRelationsIntro")}</p>
        <RelationsMap graph={graph} lang={lang} onSelectConcept={scrollToSection} />
      </details>
```

5. Upgrade the `relatedViews` rendering (replace the existing italic `<span>` map):
```tsx
                            {e.relatedViews?.map((v) =>
                              onNavigateView ? (
                                <button
                                  key={v}
                                  type="button"
                                  onClick={() => onNavigateView(v)}
                                  aria-label={t(lang, "helpRelationsGoToView", t(lang, navLabelKey(v)))}
                                  className={`ml-2 italic text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-light-grey ${INTERACTIVE}`}
                                >
                                  {t(lang, navLabelKey(v))}
                                </button>
                              ) : (
                                <span key={v} className="ml-2 italic">
                                  {t(lang, navLabelKey(v))}
                                </span>
                              ),
                            )}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- help-view`
Expected: PASS (existing + 2 new).
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/help-view.tsx src/app/help-view.test.tsx
git commit -m "feat(help): mount relations map + clickable Related views (SP3)"
```

---

### Task 5: Wire `onNavigateView` from workspace-section

**Files:**
- Modify: `src/app/workspace-section.tsx`

- [ ] **Step 1: Confirm `setActiveTab` is available**

Run: `npx tsc --noEmit` after the edit (no isolated test — wiring is integration-only).
In `workspace-section.tsx`, the `useWorkspaceTab()` destructure already pulls SP2's `requestHelpConcept`/`clearHelpConcept`. Add `setActiveTab` to that destructure if not already present.

- [ ] **Step 2: Pass the prop to `<HelpView>`**

Find the `<HelpView …>` render and add:
```tsx
        onNavigateView={(v) => setActiveTab(v)}
```
(Keep the existing `pendingHelpConcept`/`onHelpConceptConsumed` props.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm run test:run` — full suite green.
Run: `npm run lint` — `--max-warnings=0` clean (watch for unused imports).

- [ ] **Step 4: Commit**

```bash
git add src/app/workspace-section.tsx
git commit -m "feat(help): wire relations-map view navigation (SP3)"
```

---

### Task 6: Final verification + AGENTS.md note

**Files:**
- Modify: `AGENTS.md` (Help section — add an SP3 bullet)

- [ ] **Step 1: Full gate sweep**

Run: `npx tsc --noEmit` · `npm run lint` · `npm run test:run` — all green.

- [ ] **Step 2: Eye-verify the map** (Help not in axe gate)

`npm run dev`, open Help, confirm: nodes positioned on the circle, edges drawn, hover highlights incident edges + dims the rest, keyboard Tab focuses each node (focus drives highlight too), click scrolls to the concept, a Related-line view button navigates. Check both light + dark + (if quick) Mockup style for palette/contrast.

- [ ] **Step 3: Document in AGENTS.md** — under the Help section, add a concise SP3 bullet: the relations map (`relations-graph.ts` pure engine + `relations-map.tsx` overlay component — decorative aria-hidden SVG edges + real positioned HTML node buttons; concept-only; hover/focus highlight), mounted in a `<details>` in `help-view.tsx`; Related-line view spans upgraded to `onNavigateView` buttons (optional prop → standalone test unaffected), wired to `setActiveTab` in `workspace-section.tsx`; Help not in axe gate (eye-verified).

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(help): note relations map (SP3) architecture"
```
