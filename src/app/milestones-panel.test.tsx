import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { MilestonesPanel } from "./milestones-panel";

vi.mock("./activity-log", async (orig) => ({
  ...(await orig<typeof import("./activity-log")>()),
  loadActivityLog: () => [],
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const baseProps = {
  lang: "en-US" as const,
  today: "2026-06-02",
  holidaySet: new Set<string>(),
};

describe("MilestonesPanel", () => {
  it("renders empty milestones without crashing", () => {
    const { container } = render(
      <MilestonesPanel
        lang="en-US"
        today="2026-06-02"
        holidaySet={new Set()}
      />,
      { wrapper },
    );
    expect(container).toBeTruthy();
  });

  it("shows empty state message when there are no milestones", () => {
    const { getByText } = render(
      <MilestonesPanel
        lang="en-US"
        today="2026-06-02"
        holidaySet={new Set()}
      />,
      { wrapper },
    );
    // The milestonesEmpty i18n key should be visible
    expect(getByText("No milestones yet.")).toBeTruthy();
  });

  it("opens the create modal when openCreateNonce increments, not on mount", () => {
    const { rerender } = render(
      <MilestonesPanel {...baseProps} openCreateNonce={0} />,
      { wrapper },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<MilestonesPanel {...baseProps} openCreateNonce={1} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
