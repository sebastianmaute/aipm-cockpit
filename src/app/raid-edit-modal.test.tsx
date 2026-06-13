import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { RaidEditModal } from "./raid-edit-modal";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";
import type { RaidItem } from "./types";

function makeDraft(over: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 1,
    title: "Server outage risk",
    category: "R",
    status: "Open",
    raisedDate: "2026-01-01",
    probability: 3,
    impact: 3,
    severity: "Medium",
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    ...over,
  };
}

function modalEl(over: Partial<RaidItem> = {}) {
  return (
    <RaidEditModal
      lang="en-US"
      tasks={[]}
      raid={[]}
      stakeholdersEnabled
      stakeholders={[]}
      resources={[]}
      contacts={[]}
      onCreateResource={vi.fn(() => 1)}
      draft={makeDraft(over)}
      isNew={false}
      onChange={vi.fn()}
      onApplyStatus={vi.fn()}
      onApplyMatrix={vi.fn()}
      onSave={vi.fn()}
      onCancel={vi.fn()}
      onDelete={vi.fn()}
      onCreateMitigationTask={vi.fn()}
      onJumpToRaid={vi.fn()}
    />
  );
}

/** Seeds the workspace field-visibility config once on mount (e.g. Full view). */
function Seed({ tier }: { tier: "full" }) {
  const { setFieldVisibility } = useWorkspace();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    setFieldVisibility(() => ({ raid: applyTier("raid", tier) }));
  }, [setFieldVisibility, tier]);
  return null;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

// The modal body renders the full field labels (raidMitigation / raidRiskMatrix),
// distinct from the cog checklist labels (mitigation / riskMatrix).
const MITIGATION_LABEL = t("en-US", "raidMitigation");
const RISK_MATRIX_LABEL = t("en-US", "raidRiskMatrix");
const TITLE_HINT = t("en-US", "raidFieldTitleHint");

describe("RaidEditModal InfoTooltip hints", () => {
  it("renders the Title field InfoTooltip reachable by accessible name", () => {
    render(modalEl(), { wrapper });
    // InfoTooltip renders a span[role=button] with aria-label = hint text
    expect(screen.getByRole("button", { name: TITLE_HINT })).toBeTruthy();
  });

  it("Title input no longer carries a native title attribute", () => {
    render(modalEl(), { wrapper });
    // The title input is identified by its placeholder text
    const input = screen.getByPlaceholderText(t("en-US", "raidPlaceholderTitle"));
    expect(input.getAttribute("title")).toBeNull();
  });
});

describe("RaidEditModal field visibility", () => {
  it("shows advanced fields and hides Full-only fields by default (Advanced)", () => {
    // Use a non-Risk draft so the matrix only appears via the riskMatrix field
    // guard (Full-only), not the category branch.
    render(modalEl({ category: "I" }), { wrapper });
    expect(screen.getByText(MITIGATION_LABEL)).toBeTruthy();
    expect(screen.queryByText(RISK_MATRIX_LABEL)).toBeNull();
    expect(screen.getByText(/Title/)).toBeTruthy();
  });

  it("hides advanced fields like Mitigation when switched to Simple, keeping Title", async () => {
    const user = userEvent.setup();
    render(modalEl({ category: "I" }), { wrapper });
    expect(screen.getByText(MITIGATION_LABEL)).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: t("en-US", "fieldViewSimple") }),
    );

    expect(screen.queryByText(MITIGATION_LABEL)).toBeNull();
    expect(screen.getByText(/Title/)).toBeTruthy();
  });

  it("shows the risk matrix for a Risk item in Full tier", () => {
    render(
      <>
        <Seed tier="full" />
        {modalEl({ category: "R" })}
      </>,
      { wrapper },
    );
    expect(screen.getByText(RISK_MATRIX_LABEL)).toBeTruthy();
  });
});
