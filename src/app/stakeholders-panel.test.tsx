import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StakeholdersPanel } from "./stakeholders-panel";
import type { Stakeholder } from "./types";

const items: Stakeholder[] = [
  { id: 1, name: "Zoe", category: "Customer", influence: "High", interest: "Low", raci: {} },
  { id: 2, name: "Amy", category: "Internal", influence: "Low", interest: "High", raci: {} },
];

function setup() {
  const props = {
    lang: "en-US" as const, stakeholders: items, resources: [], milestones: [],
    onSave: vi.fn(), onDelete: vi.fn(),
  };
  render(<StakeholdersPanel {...props} />);
  return props;
}

describe("StakeholdersPanel", () => {
  it("renders a row per stakeholder", () => {
    setup();
    expect(screen.getByText("Zoe")).toBeInTheDocument();
    expect(screen.getByText("Amy")).toBeInTheDocument();
  });
  it("opens the add modal", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /add stakeholder/i }));
    expect(screen.getByText(/add stakeholder/i)).toBeInTheDocument();
  });
});
