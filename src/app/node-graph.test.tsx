import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
