import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RaciSuggestModal } from "./raci-suggest-modal";
import { t } from "./i18n";
import type { GroundedRaciCell } from "./raci-suggest/raci-suggest";

const cell = (
  stakeholderId: number,
  stakeholderName: string,
  milestoneId: number,
  milestoneName: string,
): GroundedRaciCell => ({
  stakeholderId,
  stakeholderName,
  milestoneId,
  milestoneName,
  role: "R",
  currentRole: null,
});

function renderModal(cells: readonly GroundedRaciCell[]) {
  render(
    <RaciSuggestModal
      lang="en-US"
      open
      cells={cells}
      skipped={[]}
      truncated={false}
      selected={new Set(cells.map((c) => `${c.stakeholderId}:${c.milestoneId}`))}
      onToggle={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      busy={false}
    />,
  );
}

describe("RaciSuggestModal per-row accessible names", () => {
  it("keeps the name unqualified when it is already unambiguous", () => {
    renderModal([cell(1, "Ada", 10, "Design freeze")]);
    expect(
      screen.getByRole("checkbox", {
        name: `${t("en-US", "raciSuggestInclude")} – Ada – Design freeze`,
      }),
    ).toBeInTheDocument();
  });

  it("distinguishes two DIFFERENT stakeholders who share a name", () => {
    // Cells are deduped by (stakeholderId, milestoneId), never by name, so two
    // real people called "Ada" on the same milestone both get a row. Without
    // qualification both checkboxes announce identically — a WCAG 2.4.6 failure
    // the axe gate cannot detect (it reports missing names, never duplicate
    // ones). getByRole throws on multiple matches, so an unqualified label
    // fails this test rather than passing quietly.
    renderModal([cell(1, "Ada", 10, "Design freeze"), cell(2, "Ada", 10, "Design freeze")]);
    const include = t("en-US", "raciSuggestInclude");
    expect(
      screen.getByRole("checkbox", { name: `${include} – Ada (#1) – Design freeze` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: `${include} – Ada (#2) – Design freeze` }),
    ).toBeInTheDocument();
  });

  it("leaves the SAME stakeholder's rows unqualified across milestones", () => {
    // One person on two milestones is not a collision — the milestone already
    // separates the names, so qualifying here would be noise.
    renderModal([cell(1, "Ada", 10, "Design freeze"), cell(1, "Ada", 11, "Go live")]);
    const include = t("en-US", "raciSuggestInclude");
    expect(
      screen.getByRole("checkbox", { name: `${include} – Ada – Design freeze` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: `${include} – Ada – Go live` }),
    ).toBeInTheDocument();
  });
});
