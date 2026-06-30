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
