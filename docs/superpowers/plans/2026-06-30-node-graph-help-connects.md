# Reusable 2D Node-Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable 2D node-graph renderer + pure grid-layout engine, and adopt it in the Help "How it all connects" relations map (interactive) and the Information-flows diagram (static).

**Architecture:** A pure i18n-free layout module (`node-graph-layout.ts`) holds the model types and a deterministic `gridLayout()`. A presentational i18n-free component (`node-graph.tsx`) renders an SVG diagram and, when `onSelectNode` is supplied, a transparent percentage-positioned `<button>` overlay (axe-clean interactivity). `relations-graph.ts`/`relations-map.tsx` feed it an interactive grid; `information-flows-section.tsx` feeds it a static manual-coordinate model with zones + directed edges.

**Tech Stack:** TypeScript, React (Next.js forked), Tailwind v4 (fill-/stroke-/text- utilities for palette-safe theming), Vitest + Testing Library, Playwright (axe gate).

---

## Conventions (read once)

- Run a single test file: `npm run test:run -- <substring>` (e.g. `node-graph-layout`).
- After editing ANY test: `npx tsc --noEmit` (CI typechecks tests; vitest does not).
- Lint is `--max-warnings=0`: an unused import/var is FATAL. `react-hooks/exhaustive-deps` rejects `obj.member` deps — hoist to a scalar local.
- Palette-safe: only AIPM tokens via Tailwind `fill-*`/`stroke-*`/`text-*` utilities; NO shadow/gradient. RAG tokens not needed here (structural brand colors only).
- Commit messages: conventional, NO `Co-Authored-By` trailer (attribution disabled globally for this user).

## File structure

| File | Responsibility |
|------|----------------|
| `src/app/node-graph-layout.ts` (new) | Pure model types (`NodeGraphNode`/`Edge`/`Zone`/`ViewBox`/`NodeAccent`) + `gridLayout()`. No React, no `Date`/`Math.random`. |
| `src/app/node-graph.tsx` (new) | Presentational renderer. Static (`role=img`) + interactive (button overlay) modes. i18n-free (takes translated strings). |
| `src/app/relations-graph.ts` (modify) | `buildRelationsGraph` emits `{nodes,edges,viewBox}` positioned via `gridLayout`. Stays i18n-free (carries `titleKey`, not translated label). |
| `src/app/relations-map.tsx` (modify) | Thin wrapper: translate titleKey→label, render `<NodeGraph>` interactive. |
| `src/app/settings-sections/information-flows-section.tsx` (modify) | Build a static NodeGraph model (manual coords, zones, `arrow:"both"` edges); keep intro + legend + `maxWidth`. |
| Tests: `node-graph-layout.test.ts` (new), `node-graph.test.tsx` (new), `relations-graph.test.ts` (rewrite), `relations-map.test.tsx` (rewrite). `information-flows-section.test.tsx` is unchanged (assertions still hold). |

`src/app/help-view.tsx` is NOT modified — `buildRelationsGraph(HELP_ENTRIES)` + `<RelationsMap graph lang onSelectConcept>` keep their signatures.

---

### Task 1: Layout engine + model types

**Files:**
- Create: `src/app/node-graph-layout.ts`
- Test: `src/app/node-graph-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/node-graph-layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gridLayout } from "./node-graph-layout";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];

describe("gridLayout", () => {
  it("keeps every item, preserving id + order", () => {
    const { nodes } = gridLayout(items);
    expect(nodes.map((n) => n.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("derives cols = ceil(sqrt(n)) by default (5 → 3 cols)", () => {
    const { nodes } = gridLayout(items);
    // row 0 = a,b,c ; row 1 = d,e — so a.y === c.y and d.y > a.y
    expect(nodes[2].y).toBe(nodes[0].y);
    expect(nodes[3].y).toBeGreaterThan(nodes[0].y);
    // distinct x within a row
    expect(nodes[0].x).toBeLessThan(nodes[1].x);
  });

  it("honours an explicit cols override", () => {
    const { nodes } = gridLayout(items, { cols: 5 });
    const ys = new Set(nodes.map((n) => n.y));
    expect(ys.size).toBe(1); // one row
  });

  it("positions every node inside the returned viewBox", () => {
    const { nodes, viewBox } = gridLayout(items);
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(viewBox.w);
      expect(n.y + n.h).toBeLessThanOrEqual(viewBox.h);
    }
  });

  it("carries the item payload through", () => {
    const { nodes } = gridLayout([{ id: "x", label: "Hello" }]);
    expect(nodes[0].label).toBe("Hello");
  });

  it("is deterministic", () => {
    expect(gridLayout(items)).toEqual(gridLayout(items));
  });

  it("handles a single item without dividing by zero", () => {
    const { nodes, viewBox } = gridLayout([{ id: "solo" }]);
    expect(nodes).toHaveLength(1);
    expect(viewBox.w).toBeGreaterThan(0);
    expect(viewBox.h).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- node-graph-layout`
Expected: FAIL — `gridLayout` is not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/node-graph-layout.ts`:

```ts
// Pure, i18n-free model + layout for the reusable NodeGraph component.
// No React, no Date/Math.random — every output is a pure function of input.

export type NodeAccent = "blue" | "green" | "hub";

export interface ViewBox {
  w: number;
  h: number;
}

/** A positioned diagram node. Coordinates are in viewBox units. */
export interface NodeGraphNode {
  id: string;
  label: string;
  sub?: string;
  accent: NodeAccent;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An edge between two node ids. `arrow:"both"` draws a double-headed arrow. */
export interface NodeGraphEdge {
  a: string;
  b: string;
  arrow?: "none" | "both";
}

/** A dashed group rectangle with an uppercase label. `color` is a CSS color. */
export interface NodeGraphZone {
  label: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const NODE_W = 120;
const NODE_H = 30;
const GAP_X = 24;
const GAP_Y = 22;
const MARGIN = 12;

export interface GridConfig {
  cols?: number;
  nodeW?: number;
  nodeH?: number;
  gapX?: number;
  gapY?: number;
  margin?: number;
}

/** Lay items out row-major in a deterministic grid. Each output node carries
 *  the original item payload plus x/y/w/h in viewBox units. */
export function gridLayout<T extends { id: string }>(
  items: readonly T[],
  cfg: GridConfig = {},
): { nodes: (T & { x: number; y: number; w: number; h: number })[]; viewBox: ViewBox } {
  const nodeW = cfg.nodeW ?? NODE_W;
  const nodeH = cfg.nodeH ?? NODE_H;
  const gapX = cfg.gapX ?? GAP_X;
  const gapY = cfg.gapY ?? GAP_Y;
  const margin = cfg.margin ?? MARGIN;

  const n = items.length;
  const cols = Math.max(1, cfg.cols ?? Math.ceil(Math.sqrt(Math.max(1, n))));
  const rows = Math.max(1, Math.ceil(Math.max(1, n) / cols));

  const nodes = items.map((it, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return {
      ...it,
      x: margin + c * (nodeW + gapX),
      y: margin + r * (nodeH + gapY),
      w: nodeW,
      h: nodeH,
    };
  });

  const viewBox: ViewBox = {
    w: margin * 2 + cols * nodeW + (cols - 1) * gapX,
    h: margin * 2 + rows * nodeH + (rows - 1) * gapY,
  };

  return { nodes, viewBox };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- node-graph-layout` then `npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/node-graph-layout.ts src/app/node-graph-layout.test.ts .gitignore
git commit -m "feat(node-graph): pure grid-layout engine + model types"
```

---

### Task 2: NodeGraph renderer — static mode

**Files:**
- Create: `src/app/node-graph.tsx`
- Test: `src/app/node-graph.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/node-graph.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NodeGraph } from "./node-graph";
import type { NodeGraphNode, NodeGraphEdge, NodeGraphZone } from "./node-graph-layout";

const nodes: NodeGraphNode[] = [
  { id: "hub", label: "Hub", sub: "centre", accent: "hub", x: 90, y: 40, w: 80, h: 44 },
  { id: "x", label: "Node X", accent: "green", x: 10, y: 40, w: 60, h: 30 },
  { id: "y", label: "Node Y", accent: "blue", x: 190, y: 40, w: 60, h: 30 },
];
const edges: NodeGraphEdge[] = [
  { a: "hub", b: "x", arrow: "both" },
  { a: "hub", b: "y" },
];
const zones: NodeGraphZone[] = [
  { label: "Zone A", color: "var(--AIPM-green)", x: 4, y: 20, w: 70, h: 80 },
];

describe("NodeGraph static mode (no onSelectNode)", () => {
  it("renders an accessible role=img diagram with the aria-label", () => {
    render(<NodeGraph viewBox={{ w: 260, h: 120 }} nodes={nodes} edges={edges} ariaLabel="My diagram" />);
    expect(screen.getByRole("img", { name: "My diagram" })).toBeTruthy();
  });

  it("renders no buttons", () => {
    render(<NodeGraph viewBox={{ w: 260, h: 120 }} nodes={nodes} edges={edges} ariaLabel="My diagram" />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("draws node + zone labels as text", () => {
    const { container } = render(
      <NodeGraph viewBox={{ w: 260, h: 120 }} nodes={nodes} edges={edges} zones={zones} ariaLabel="My diagram" />,
    );
    const txt = container.textContent ?? "";
    expect(txt).toContain("Hub");
    expect(txt).toContain("Node X");
    expect(txt).toContain("Zone A");
  });

  it("applies maxWidth to the diagram svg", () => {
    const { container } = render(
      <NodeGraph viewBox={{ w: 260, h: 120 }} nodes={nodes} edges={edges} ariaLabel="My diagram" maxWidth={640} />,
    );
    const svg = container.querySelector("svg[role='img']") as SVGElement;
    expect(svg.style.maxWidth).toBe("640px");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- node-graph.test`
Expected: FAIL — `NodeGraph` module missing.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/node-graph.tsx`:

```tsx
"use client";

import { useState } from "react";
import { FOCUS_RING } from "./interaction-styles";
import type { NodeGraphNode, NodeGraphEdge, NodeGraphZone, ViewBox } from "./node-graph-layout";

interface NodeGraphProps {
  viewBox: ViewBox;
  nodes: readonly NodeGraphNode[];
  edges: readonly NodeGraphEdge[];
  zones?: readonly NodeGraphZone[];
  /** Group/img accessible name. */
  ariaLabel: string;
  /** <desc> text for static (role=img) mode. */
  description?: string;
  /** px cap on the rendered width. */
  maxWidth?: number;
  /** Present ⇒ interactive (button overlay). Absent ⇒ static role=img. */
  onSelectNode?: (id: string) => void;
  /** Per-node button accessible name (interactive). Defaults to node.label. */
  nodeAriaLabel?: (node: NodeGraphNode) => string;
  /** Tooltip on each node button (interactive). */
  selectTitle?: string;
}

function ArrowDefs() {
  return (
    <defs>
      <marker id="ng-arrow-end" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
        <path d="M0,0 L0,6 L8,3 z" className="fill-AIPM-medium-grey" />
      </marker>
      <marker id="ng-arrow-start" markerWidth={8} markerHeight={8} refX={2} refY={3} orient="auto-start-reverse">
        <path d="M0,0 L0,6 L8,3 z" className="fill-AIPM-medium-grey" />
      </marker>
    </defs>
  );
}

function ZoneShape({ zone }: { zone: NodeGraphZone }) {
  return (
    <g>
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.w}
        height={zone.h}
        rx={10}
        fill="none"
        className="stroke-AIPM-medium-grey"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      <text
        x={zone.x + 10}
        y={zone.y + 12}
        fill={zone.color}
        fontSize={9}
        fontWeight={700}
        style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}
      >
        {zone.label}
      </text>
    </g>
  );
}

function NodeShape({
  node,
  isActive,
  isNeighbour,
  dim,
}: {
  node: NodeGraphNode;
  isActive: boolean;
  isNeighbour: boolean;
  dim: boolean;
}) {
  const hub = node.accent === "hub";
  const filled = hub || isActive;
  const fillClass = filled ? "fill-AIPM-dark-blue" : "fill-surface";
  const strokeClass = isNeighbour ? "stroke-AIPM-green" : node.accent === "green" ? "stroke-AIPM-green" : "stroke-AIPM-dark-blue";
  const titleClass = filled ? "text-white" : "text-foreground";
  const subClass = filled ? "text-AIPM-green" : "text-muted-foreground";
  const stripeClass = node.accent === "green" ? "fill-AIPM-green" : "fill-AIPM-dark-blue";
  return (
    <g opacity={dim ? 0.4 : 1}>
      <rect
        x={node.x}
        y={node.y}
        width={node.w}
        height={node.h}
        rx={7}
        className={`${fillClass} ${strokeClass}`}
        strokeWidth={hub ? 2 : 1.5}
      />
      {!filled && (
        <rect x={node.x} y={node.y} width={3} height={node.h} rx={1.5} className={stripeClass} />
      )}
      <text
        x={node.x + node.w / 2}
        y={node.y + (node.sub ? 18 : node.h / 2 + 4)}
        textAnchor="middle"
        fill="currentColor"
        className={titleClass}
        fontSize={10.5}
        fontWeight={600}
      >
        {node.label}
      </text>
      {node.sub && (
        <text
          x={node.x + node.w / 2}
          y={node.y + 33}
          textAnchor="middle"
          fill="currentColor"
          className={subClass}
          fontSize={8.5}
        >
          {node.sub}
        </text>
      )}
    </g>
  );
}

/** Reusable 2D node-graph. Static (role=img) when `onSelectNode` is absent;
 *  interactive (transparent button overlay over a decorative svg) when present.
 *  Presentational + i18n-free — callers pass already-translated strings. */
export function NodeGraph({
  viewBox,
  nodes,
  edges,
  zones,
  ariaLabel,
  description,
  maxWidth,
  onSelectNode,
  nodeAriaLabel,
  selectTitle,
}: NodeGraphProps) {
  const interactive = !!onSelectNode;
  const [active, setActive] = useState<string | null>(null);

  const neighbours = new Set<string>();
  if (active) {
    for (const e of edges) {
      if (e.a === active) neighbours.add(e.b);
      else if (e.b === active) neighbours.add(e.a);
    }
  }

  const inner = (
    <>
      {description && <desc>{description}</desc>}
      <ArrowDefs />
      {zones?.map((z, i) => (
        <ZoneShape key={`z${i}`} zone={z} />
      ))}
      {edges.map((e, i) => {
        const na = nodes.find((n) => n.id === e.a);
        const nb = nodes.find((n) => n.id === e.b);
        if (!na || !nb) return null;
        const incident = active === e.a || active === e.b;
        return (
          <line
            key={`e${i}`}
            x1={na.x + na.w / 2}
            y1={na.y + na.h / 2}
            x2={nb.x + nb.w / 2}
            y2={nb.y + nb.h / 2}
            className={incident ? "stroke-AIPM-dark-blue" : "stroke-line"}
            strokeWidth={incident ? 1.6 : 1.2}
            opacity={active && !incident ? 0.3 : 1}
            markerStart={e.arrow === "both" ? "url(#ng-arrow-start)" : undefined}
            markerEnd={e.arrow === "both" ? "url(#ng-arrow-end)" : undefined}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {nodes.map((n) => {
        const isActive = active === n.id;
        const isNeighbour = neighbours.has(n.id);
        return (
          <NodeShape
            key={n.id}
            node={n}
            isActive={isActive}
            isNeighbour={isNeighbour}
            dim={!!active && !isActive && !isNeighbour}
          />
        );
      })}
    </>
  );

  if (!interactive) {
    return (
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${viewBox.w} ${viewBox.h}`}
        width="100%"
        style={{ maxWidth }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {inner}
      </svg>
    );
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="relative w-full"
      style={{ maxWidth, aspectRatio: `${viewBox.w} / ${viewBox.h}` }}
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${viewBox.w} ${viewBox.h}`}
        className="absolute inset-0 h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        {inner}
      </svg>
      {nodes.map((n) => (
        <button
          key={n.id}
          type="button"
          data-active={active === n.id ? "true" : "false"}
          onClick={() => onSelectNode?.(n.id)}
          onMouseEnter={() => setActive(n.id)}
          onMouseLeave={() => setActive(null)}
          onFocus={() => setActive(n.id)}
          onBlur={() => setActive(null)}
          aria-label={nodeAriaLabel ? nodeAriaLabel(n) : n.label}
          title={selectTitle}
          className={`absolute rounded-md bg-transparent ${FOCUS_RING}`}
          style={{
            left: `${(n.x / viewBox.w) * 100}%`,
            top: `${(n.y / viewBox.h) * 100}%`,
            width: `${(n.w / viewBox.w) * 100}%`,
            height: `${(n.h / viewBox.h) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- node-graph.test` then `npx tsc --noEmit`
Expected: static-mode tests PASS; tsc clean. (Interactive tests are added in Task 3.)

- [ ] **Step 5: Commit**

```bash
git add src/app/node-graph.tsx src/app/node-graph.test.tsx
git commit -m "feat(node-graph): presentational renderer with static + interactive modes"
```

---

### Task 3: NodeGraph — interactive-mode tests

**Files:**
- Modify: `src/app/node-graph.test.tsx` (append a describe block)

- [ ] **Step 1: Write the failing test**

Append to `src/app/node-graph.test.tsx`:

```tsx
import { fireEvent } from "@testing-library/react";

describe("NodeGraph interactive mode (onSelectNode present)", () => {
  it("renders one button per node, named by label", () => {
    render(<NodeGraph viewBox={{ w: 260, h: 120 }} nodes={nodes} edges={edges} ariaLabel="g" onSelectNode={() => {}} />);
    expect(screen.getByRole("button", { name: "Hub" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Node X" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Node Y" })).toBeTruthy();
  });

  it("uses nodeAriaLabel when provided", () => {
    render(
      <NodeGraph
        viewBox={{ w: 260, h: 120 }}
        nodes={nodes}
        edges={edges}
        ariaLabel="g"
        onSelectNode={() => {}}
        nodeAriaLabel={(n) => `${n.label} – open`}
      />,
    );
    expect(screen.getByRole("button", { name: "Hub – open" })).toBeTruthy();
  });

  it("calls onSelectNode with the id on click", () => {
    const onSelect = vi.fn();
    render(<NodeGraph viewBox={{ w: 260, h: 120 }} nodes={nodes} edges={edges} ariaLabel="g" onSelectNode={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Node X" }));
    expect(onSelect).toHaveBeenCalledWith("x");
  });

  it("marks a node active on focus", () => {
    render(<NodeGraph viewBox={{ w: 260, h: 120 }} nodes={nodes} edges={edges} ariaLabel="g" onSelectNode={() => {}} />);
    const btn = screen.getByRole("button", { name: "Hub" });
    fireEvent.focus(btn);
    expect(btn.getAttribute("data-active")).toBe("true");
    fireEvent.blur(btn);
    expect(btn.getAttribute("data-active")).toBe("false");
  });

  it("exposes the group aria-label and no role=img", () => {
    render(<NodeGraph viewBox={{ w: 260, h: 120 }} nodes={nodes} edges={edges} ariaLabel="My group" onSelectNode={() => {}} />);
    expect(screen.getByRole("group", { name: "My group" })).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
```

(Move the `import { fireEvent }` to the existing top-of-file import line — `import { render, screen, fireEvent } from "@testing-library/react";` — rather than a second import statement, to avoid a duplicate-import lint error.)

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `npm run test:run -- node-graph.test`
Expected: the new interactive block PASSES against the Task 2 implementation (the component already supports interactive mode). If any assertion fails, fix the component, not the test. Then `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add src/app/node-graph.test.tsx
git commit -m "test(node-graph): cover interactive button-overlay mode"
```

---

### Task 4: Relations graph → grid model

**Files:**
- Modify: `src/app/relations-graph.ts`
- Modify (rewrite): `src/app/relations-graph.test.ts`

- [ ] **Step 1: Rewrite the test**

Replace the entire contents of `src/app/relations-graph.test.ts`:

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

  it("positions every node inside the returned viewBox", () => {
    for (const n of graph.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(graph.viewBox.w);
      expect(n.y + n.h).toBeLessThanOrEqual(graph.viewBox.h);
    }
  });

  it("lays nodes in a multi-column grid (more than one distinct x)", () => {
    const xs = new Set(graph.nodes.map((n) => n.x));
    expect(xs.size).toBeGreaterThan(1);
  });

  it("only emits edges between real concept nodes, deduped, sorted a<b, no self-loops", () => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    const seen = new Set<string>();
    for (const e of graph.edges) {
      expect(ids.has(e.a)).toBe(true);
      expect(ids.has(e.b)).toBe(true);
      expect(e.a).not.toBe(e.b);
      expect(e.a < e.b).toBe(true);
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
Expected: FAIL — `graph.viewBox` undefined and nodes lack `w`/`h`.

- [ ] **Step 3: Implement**

Replace the entire contents of `src/app/relations-graph.ts`:

```ts
// Pure, i18n-free layout for the Help relations map. Concepts become grid nodes;
// their mutual `relatedConcepts` references become deduped undirected edges.
// i18n-free: carries `titleKey`, not a translated label (the wrapper translates).
import type { HelpEntry } from "./help-content";
import type { TranslationKey } from "./i18n";
import { gridLayout, type ViewBox } from "./node-graph-layout";

export interface RelationsNode {
  id: string;
  titleKey: TranslationKey;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface RelationsEdge {
  a: string; // sorted: a < b
  b: string;
}
export interface RelationsGraph {
  nodes: readonly RelationsNode[];
  edges: readonly RelationsEdge[];
  viewBox: ViewBox;
}

export function buildRelationsGraph(entries: readonly HelpEntry[]): RelationsGraph {
  const concepts = entries.filter((e) => e.group === "concepts");
  const ids = new Set(concepts.map((c) => c.id));

  const { nodes, viewBox } = gridLayout(
    concepts.map((c) => ({ id: c.id, titleKey: c.titleKey })),
  );

  const seen = new Set<string>();
  const edges: RelationsEdge[] = [];
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

  return { nodes, edges, viewBox };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- relations-graph` then `npx tsc --noEmit`
Expected: PASS. tsc may now report errors in `relations-map.tsx`/`relations-map.test.tsx` (old `{x,y}` model) — those are fixed in Task 5.

- [ ] **Step 5: Commit**

```bash
git add src/app/relations-graph.ts src/app/relations-graph.test.ts
git commit -m "feat(help): relations graph emits grid-positioned NodeGraph model"
```

---

### Task 5: Relations map renders NodeGraph

**Files:**
- Modify: `src/app/relations-map.tsx`
- Modify (rewrite): `src/app/relations-map.test.tsx`

- [ ] **Step 1: Rewrite the test**

Replace the entire contents of `src/app/relations-map.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RelationsMap } from "./relations-map";
import { buildRelationsGraph, type RelationsGraph } from "./relations-graph";
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

const tinyGraph: RelationsGraph = {
  nodes: [
    { id: "a", titleKey: "navHelp", x: 10, y: 10, w: 60, h: 30 },
    { id: "b", titleKey: "navHelp", x: 90, y: 10, w: 60, h: 30 },
  ],
  edges: [{ a: "a", b: "b" }],
  viewBox: { w: 160, h: 50 },
};

describe("RelationsMap tiny graph", () => {
  it("renders one keyboard button per node and calls onSelectConcept on click", () => {
    const onSelect = vi.fn();
    render(<RelationsMap graph={tinyGraph} lang="en-US" onSelectConcept={onSelect} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[0]);
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("marks the focused node active (data-active)", () => {
    render(<RelationsMap graph={tinyGraph} lang="en-US" onSelectConcept={() => {}} />);
    const buttons = screen.getAllByRole("button");
    fireEvent.focus(buttons[1]);
    expect(buttons[1].getAttribute("data-active")).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- relations-map`
Expected: FAIL — RelationsMap still renders the old list markup / type mismatch.

- [ ] **Step 3: Implement**

Replace the entire contents of `src/app/relations-map.tsx`:

```tsx
"use client";

import { type Lang, t } from "./i18n";
import type { RelationsGraph } from "./relations-graph";
import { NodeGraph } from "./node-graph";
import type { NodeGraphNode, NodeGraphEdge } from "./node-graph-layout";

interface RelationsMapProps {
  graph: RelationsGraph;
  lang: Lang;
  onSelectConcept: (id: string) => void;
}

/** Interactive concept relations map (SP3). Renders the reusable NodeGraph in
 *  interactive mode: a transparent button overlay over a decorative diagram.
 *  Hover/focus highlights incident edges + neighbours; click jumps to the
 *  concept. Presentational — no context, no persistence. */
export function RelationsMap({ graph, lang, onSelectConcept }: RelationsMapProps) {
  const nodes: NodeGraphNode[] = graph.nodes.map((n) => ({
    id: n.id,
    label: t(lang, n.titleKey),
    accent: "blue",
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
  }));
  const edges: NodeGraphEdge[] = graph.edges.map((e) => ({ a: e.a, b: e.b }));

  return (
    <div className="rounded-md border border-line bg-surface-muted p-3">
      <NodeGraph
        viewBox={graph.viewBox}
        nodes={nodes}
        edges={edges}
        ariaLabel={t(lang, "helpRelationsMapLabel")}
        onSelectNode={onSelectConcept}
        selectTitle={t(lang, "helpRelationsOpenConcept")}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- relations-map` then `npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/relations-map.tsx src/app/relations-map.test.tsx
git commit -m "feat(help): relations map renders the reusable NodeGraph (interactive grid)"
```

---

### Task 6: Information-flows diagram on NodeGraph

**Files:**
- Modify: `src/app/settings-sections/information-flows-section.tsx`
- (Test `information-flows-section.test.tsx` is unchanged — its assertions, role=img / maxWidth / node + zone text, still hold. Run it to confirm.)

- [ ] **Step 1: Implement**

Replace the contents of `src/app/settings-sections/information-flows-section.tsx`. Keep the `Legend` sub-component and i18n keys exactly as they are; only the diagram body changes to a NodeGraph model. New file contents:

```tsx
"use client";

import { type Lang, t } from "../i18n";
import { NodeGraph } from "../node-graph";
import type { NodeGraphNode, NodeGraphEdge, NodeGraphZone } from "../node-graph-layout";

interface InformationFlowsSectionProps {
  lang: Lang;
  /** Cap (px) for the diagram svg width. Default 480 keeps Settings + the
   *  in-pane Help flows tab byte-identical; the in-pane tab passes 720. */
  maxWidth?: number;
}

const DIAGRAM_DESC =
  "A diagram showing the browser app at the centre, grouped into two zones. " +
  "Your data: local IndexedDB/localStorage, project files (JSON / CSV / Markdown) " +
  "and an optional Turso cloud database. Connected services: Jira and Timelog via " +
  "API proxies, SharePoint and Outlook via Microsoft Graph, and the Anthropic AI chat API.";

// Manual hub/zone layout in viewBox units (0 0 480 300).
const NODES: readonly NodeGraphNode[] = [
  { id: "local", label: "Local storage", sub: "IndexedDB", accent: "green", x: 18, y: 40, w: 100, h: 44 },
  { id: "file", label: "File storage", sub: "JSON / CSV / MD", accent: "green", x: 18, y: 96, w: 100, h: 44 },
  { id: "turso", label: "Turso", sub: "cloud DB", accent: "green", x: 18, y: 152, w: 100, h: 44 },
  { id: "hub", label: "Browser app", sub: "(this PWA)", accent: "hub", x: 190, y: 120, w: 100, h: 44 },
  { id: "jira", label: "Jira", accent: "blue", x: 310, y: 40, w: 78, h: 30 },
  { id: "timelog", label: "Timelog", accent: "blue", x: 394, y: 40, w: 78, h: 30 },
  { id: "sharepoint", label: "SharePoint", accent: "blue", x: 310, y: 84, w: 78, h: 30 },
  { id: "outlook", label: "Outlook", accent: "blue", x: 394, y: 84, w: 78, h: 30 },
  { id: "anthropic", label: "Anthropic", sub: "AI chat", accent: "blue", x: 310, y: 140, w: 162, h: 44 },
];

const EDGES: readonly NodeGraphEdge[] = [
  { a: "hub", b: "local", arrow: "both" },
  { a: "hub", b: "file", arrow: "both" },
  { a: "hub", b: "turso", arrow: "both" },
  { a: "hub", b: "jira", arrow: "both" },
  { a: "hub", b: "timelog", arrow: "both" },
  { a: "hub", b: "sharepoint", arrow: "both" },
  { a: "hub", b: "outlook", arrow: "both" },
  { a: "hub", b: "anthropic", arrow: "both" },
];

interface LegendProps {
  lang: Lang;
}

function Legend({ lang }: LegendProps) {
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

  return (
    <>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-AIPM-green" aria-hidden="true" />
          {t(lang, "infoFlowsZoneDataLabel")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-AIPM-dark-blue" aria-hidden="true" />
          {t(lang, "infoFlowsZoneServicesLabel")}
        </span>
      </div>
      <dl className="space-y-1 text-xs text-muted-foreground">
        {items.map(({ labelKey, descKey }) => (
          <div key={labelKey} className="flex gap-2">
            <dt className="min-w-[8rem] font-medium text-foreground">{t(lang, labelKey)}</dt>
            <dd>{t(lang, descKey)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function InformationFlowsSection({ lang, maxWidth = 480 }: InformationFlowsSectionProps) {
  const zones: readonly NodeGraphZone[] = [
    { label: t(lang, "infoFlowsZoneDataLabel"), color: "var(--AIPM-green)", x: 8, y: 20, w: 120, h: 200 },
    { label: t(lang, "infoFlowsZoneServicesLabel"), color: "var(--AIPM-dark-blue)", x: 300, y: 20, w: 172, h: 200 },
  ];

  return (
    <div className="mb-4">
      <p className="mb-4 text-xs text-muted-foreground">{t(lang, "infoFlowsIntro")}</p>

      <NodeGraph
        viewBox={{ w: 480, h: 300 }}
        nodes={NODES}
        edges={EDGES}
        zones={zones}
        ariaLabel={t(lang, "infoFlowsDiagramAriaLabel")}
        description={DIAGRAM_DESC}
        maxWidth={maxWidth}
      />

      <div className="mt-4">
        <Legend lang={lang} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm run test:run -- information-flows` then `npx tsc --noEmit`
Expected: PASS (role=img, maxWidth 480/640, node + zone text present, no "Microsoft 365"); tsc clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/settings-sections/information-flows-section.tsx
git commit -m "feat(settings): information-flows diagram renders the reusable NodeGraph"
```

---

### Task 7: Gates, axe verify, release bump

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full local gates**

Run each; all must pass:
- `npx tsc --noEmit`
- `npm run lint`
- `npm run test:run`
- `npm run build`

- [ ] **Step 2: Settings axe gate (info-flows migrated → re-verify)**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"`
Expected: PASS (~16s; webServer auto-starts). The static diagram is a labelled `role=img` with no interactive controls, so axe stays green across AIPM-light / AIPM-dark / Mockup-light.

- [ ] **Step 3: Eye-verify (jsdom can't check pixels)**

`npm run dev`, then:
- Help → "How it all connects" tab: boxed nodes laid in a grid, connector lines, hover/focus a node highlights its links + neighbours, click jumps to the concept. Check light AND dark.
- Settings → Integrations (and Help → Information flows tab): the info-flows diagram renders identically to before in light, and now renders dark-correct (boxes follow the theme, not forced white).

- [ ] **Step 4: Version + changelog**

In `src/app/version.ts`: set `APP_VERSION = "0.150.0"`, update the `APP_BUILD_DATE` comment to describe the node-graph rework, set `APP_MILESTONE = "Gibson"` and update the milestone-line comment to the `0.150.x` "Gibson" series. (No new `versionHighlight*` key.)

In `CHANGELOG.md`, add at the top:

```markdown
## [0.150.0] - 2026-06-30 "Gibson"

### Changed
- **"How it all connects" is now a 2D map**: the Help relations view renders concepts as boxed nodes on a grid with connector lines, matching the Information-flows diagram's look. Hovering or focusing a concept highlights its links and neighbours; clicking still jumps to the concept.
- **Shared diagram engine**: the relations map and the Information-flows diagram now share one reusable node-graph component, so the two diagrams look and behave consistently.
- **Information flows renders correctly in dark mode**: the diagram's node boxes now follow the colour theme instead of staying white.
```

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "chore(release): 0.150.0 \"Gibson\" — reusable node-graph for Help connects + info-flows"
```

---

## Self-review notes (already applied)

- **Spec coverage:** layout engine (T1), component static+interactive (T2/T3), relations grid model (T4), relations map wrapper (T5), info-flows migration (T6), theme-aware fills (T2 `fill-surface`/`text-foreground`), a11y role split (T2), Settings axe re-verify + eye-verify + release (T7). All spec sections map to a task.
- **Type consistency:** `NodeGraphNode/Edge/Zone/ViewBox/NodeAccent` defined once in `node-graph-layout.ts`, imported everywhere. `RelationsGraph` gains `viewBox` + node `w`/`h`; `relations-map.test` `tinyGraph` and `relations-map.tsx` both use the new shape. `gridLayout` generic output spreads the item payload (so `titleKey` survives).
- **No placeholders:** every code/test step shows full content.
- **Marker ids** (`ng-arrow-*`) are shared; identical definitions so duplicate mounts are harmless (only one NodeGraph mounts per page in practice — Help tabs mount one body at a time).

## Risks carried from spec

- Overlay alignment is pixel-exact only in a real browser (jsdom rect=0) → Task 7 Step 3 eye-verify is the real check.
- If Tailwind hasn't previously generated `fill-surface`/`stroke-AIPM-*`/`text-*` utilities, writing them in tracked source generates them on next build — verified by `npm run build` in Task 7.
