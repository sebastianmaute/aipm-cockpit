import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { StakeholdersPanel } from "./stakeholders-panel";
import { t } from "./i18n";
import type { Stakeholder } from "./types";

// The add/edit modal renders ModalFieldControls, which reads field visibility
// from the workspace, so the panel needs a WorkspaceProvider/FiltersProvider.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

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
  render(<StakeholdersPanel {...props} />, { wrapper });
  return props;
}

function renderStakeholders(overrides: { stakeholders: Stakeholder[] }) {
  const props = {
    lang: "en-US" as const, resources: [], milestones: [],
    onSave: vi.fn(), onDelete: vi.fn(),
    ...overrides,
  };
  render(<StakeholdersPanel {...props} />, { wrapper });
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
  it("clicking a row opens the editor (RAID-style row click)", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Dana" })] });
    const row = screen.getByRole("button", { name: "Dana" }).closest("tr")!;
    expect(row.className).toContain("cursor-pointer");
    expect(row.className).toContain("hover:bg-surface-muted");
    fireEvent.click(row);
    expect(screen.getByRole("heading", { name: /stakeholder/i })).toBeInTheDocument();
  });

  it("clicking the name button opens editor exactly once (stopPropagation prevents double-fire)", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Dana" })] });
    const btn = screen.getByRole("button", { name: "Dana" });
    fireEvent.click(btn);
    // Editor opens — one modal heading, not two
    expect(screen.getAllByRole("heading", { name: /stakeholder/i })).toHaveLength(1);
  });

  it("threads the comms-pending set to the editor matrix: jump-to-Action-Center icon fires onJumpToComms", () => {
    const onJumpToComms = vi.fn();
    const stakeholder = sampleStakeholder({ id: 42, name: "Dana" });
    render(
      <StakeholdersPanel
        lang="en-US"
        stakeholders={[stakeholder]}
        resources={[]}
        milestones={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        commsPendingStakeholderIds={new Set([42])}
        onJumpToComms={onJumpToComms}
      />,
      { wrapper },
    );
    // Open Dana's editor — the matrix renders her selected cell with the icon.
    fireEvent.click(screen.getByRole("button", { name: "Dana" }));
    const icon = screen.getByRole("button", { name: t("en-US", "stakeholderNeedsComms") });
    fireEvent.click(icon);
    expect(onJumpToComms).toHaveBeenCalledWith(42);
  });
});

describe("Stakeholders column visibility", () => {
  it("hides the email column (header + cell) when unticked in the column config popover", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Ada", email: "ada@example.com" })] });
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));
    fireEvent.click(screen.getByLabelText(t("en-US", "stakeholderFieldEmail")));

    expect(screen.queryByText("ada@example.com")).not.toBeInTheDocument();
  });
});

describe("Stakeholders bulk edit", () => {
  it("applies a bulk influence change to the selected row via onSave", () => {
    const stakeholder = sampleStakeholder({ id: 1, name: "Dana", influence: "Low" });
    const props = renderStakeholders({ stakeholders: [stakeholder] });

    // select the row
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Dana") }));
    // open the bulk panel
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkEdit") }));
    // enable Influence + set it to High (the bulk select shares its name with the
    // column-header sort control — disambiguate by the bulk control's id)
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "stakeholderFieldInfluence") }));
    const bulkInfluence = screen
      .getAllByRole("combobox", { name: t("en-US", "stakeholderFieldInfluence") })
      .find((el) => el.id === "bulk-influence")!;
    fireEvent.change(bulkInfluence, { target: { value: "High" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkApplyCount", "1") }));

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 1, influence: "High" }));
  });
});
