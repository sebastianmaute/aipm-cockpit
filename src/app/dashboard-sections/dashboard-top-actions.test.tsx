import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { densityClasses } from "../dashboard-density";
import type { SuggestedAction } from "../next-actions/types";
import { DashboardTopActions } from "./dashboard-top-actions";
import { expectRowUniqueNames } from "../../test/row-unique-names";

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

  // §324. This card is a SECOND list owner for `ActionRow` (the Next-actions
  // panel is the other), so it mints its own token map — and until this test
  // that map had NO detector: the fixtures above carry DISTINCT titles
  // ("Alpha"/"Beta"), so `/^Open – /` counting 2 passes just as happily if both
  // rows announced the same name. Deleting the map left every test green.
  //
  // ★ Two rows sharing a TITLE is the seed that makes the map load-bearing: a
  //   title is free text and can repeat, which is the premise of this defect
  //   class. `requireCollisionSeed` refuses to certify a fixture that cannot
  //   express the collision.
  // ★★ axe is provably blind to two controls sharing an accessible name, in
  //    every view at every seed size, so this unit test is the only detector
  //    this surface will ever have.
  const sharedTitle = (id: string, ctaId: number): SuggestedAction => ({
    id,
    source: "raid",
    moduleId: "raid",
    title: { key: "actionRaidTitle", params: [1, "Shared"] },
    why: { key: "actionRaidWhySeverity", params: ["High"] },
    score: 60,
    tier: "now",
    cta: { kind: "open", view: "raid", id: ctaId },
  });

  it("gives each row a unique Open name when two top actions share a title (§324)", () => {
    render(
      <DashboardTopActions
        lang="en-US"
        topActions={[sharedTitle("raid:1:severity", 1), sharedTitle("raid:2:severity", 2)]}
        onOpenAction={vi.fn()}
        dc={dc}
      />,
    );
    // MEASURED for this fixture: this card renders no toolbar and no tooltip
    // (it never passes expertMode), so the two Open buttons are the whole set.
    // Exact, so a silently narrowed `roles` array cannot slip back in.
    expectRowUniqueNames({ minControls: 2, roles: ["button"], requireCollisionSeed: true });
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
