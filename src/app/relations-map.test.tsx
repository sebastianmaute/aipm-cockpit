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
