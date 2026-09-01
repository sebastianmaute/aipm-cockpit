import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { densityClasses } from "../dashboard-density";
import type { SuggestedAction } from "../next-actions/types";
import { DashboardTopActions } from "./dashboard-top-actions";

const sampleAction1: SuggestedAction = {
  id: "raid:1:severity",
  source: "raid",
  moduleId: "raid",
  title: { key: "actionRaidTitle", params: [1, "Alpha"] },
  why: { key: "actionRaidWhySeverity", params: ["High"] },
  score: 60,
  tier: "now",
  cta: { kind: "open", view: "raid", id: 1 },
};

const sampleAction2: SuggestedAction = {
  id: "raid:2:severity",
  source: "raid",
  moduleId: "raid",
  title: { key: "actionRaidTitle", params: [2, "Beta"] },
  why: { key: "actionRaidWhySeverity", params: ["Medium"] },
  score: 50,
  tier: "soon",
  cta: { kind: "open", view: "raid", id: 2 },
};

const dc = densityClasses("comfortable");

describe("DashboardTopActions", () => {
  it("renders both action titles and an Open button per row when 2 actions are passed", () => {
    render(
      <DashboardTopActions
        lang="en-US"
        topActions={[sampleAction1, sampleAction2]}
        onOpenAction={vi.fn()}
        dc={dc}
      />,
    );
    // Both action names appear (interpolated into the title key via params[1])
    expect(screen.getByText(/Alpha/)).toBeInTheDocument();
    expect(screen.getByText(/Beta/)).toBeInTheDocument();
    // Each row renders exactly one Open button (row-unique affordance)
    const openBtns = screen.getAllByRole("button", { name: /^Open – / });
    expect(openBtns).toHaveLength(2);
  });

  it("renders nothing when topActions is empty", () => {
    const { container } = render(
      <DashboardTopActions
        lang="en-US"
        topActions={[]}
        dc={dc}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when topActions is undefined", () => {
    const { container } = render(
      <DashboardTopActions
        lang="en-US"
        dc={dc}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
