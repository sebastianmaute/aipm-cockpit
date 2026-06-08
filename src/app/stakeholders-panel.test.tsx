import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StakeholdersPanel } from "./stakeholders-panel";
import { t } from "./i18n";
import type { Stakeholder } from "./types";

const items: Stakeholder[] = [
  { id: 1, name: "Zoe", category: "Customer", influence: "High", interest: "Low", raci: {} },
  { id: 2, name: "Amy", category: "Internal", influence: "Low", interest: "High", raci: {} },
];

function sampleStakeholder(overrides: Partial<Stakeholder> & { name: string }): Stakeholder {
  return {
    id: 99,
    category: "Customer",
    influence: "Medium",
    interest: "Medium",
    raci: {},
    ...overrides,
  };
}

function setup() {
  const props = {
    lang: "en-US" as const, stakeholders: items, resources: [], milestones: [],
    onSave: vi.fn(), onDelete: vi.fn(),
  };
  render(<StakeholdersPanel {...props} />);
  return props;
}

function renderStakeholders(overrides: { stakeholders: Stakeholder[] }) {
  const props = {
    lang: "en-US" as const, resources: [], milestones: [],
    onSave: vi.fn(), onDelete: vi.fn(),
    ...overrides,
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
    expect(screen.getByRole("heading", { name: /add stakeholder/i })).toBeInTheDocument();
  });
  it("level chips carry dark-mode variants for legibility", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Test", influence: "High", interest: "Medium" })] });
    const high = screen.getByText(t("en-US", "levelHigh")).closest("span")!;
    const med = screen.getByText(t("en-US", "levelMedium")).closest("span")!;
    expect(high.className).toContain("dark:");
    expect(med.className).toContain("dark:");
  });
  it("opens the editor from a workload-style name button, not a whole-row hover", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Dana" })] });
    const btn = screen.getByRole("button", { name: "Dana" });
    expect(btn.className).toContain("hover:border-AIPM-dark-blue");
    expect(btn.className).toContain("hover:bg-surface-muted");
    fireEvent.click(btn);
    expect(screen.getByRole("heading", { name: /stakeholder/i })).toBeInTheDocument();
    const row = btn.closest("tr")!;
    expect(row.className).not.toContain("hover:bg-surface-muted");
  });
});
