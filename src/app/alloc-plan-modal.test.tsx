import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AllocPlanModal } from "./alloc-plan-modal";
import { cellKey, type GroundedAllocCell } from "./alloc-plan/alloc-plan";
import { expectRowUniqueNames } from "../test/row-unique-names";

const cell = (resourceId: number, resourceName: string, periodKey: string): GroundedAllocCell => ({
  resourceId,
  resourceName,
  periodKey,
  mode: "percent",
  currentValue: 0,
  nextValue: 50,
  hours: 80,
  capacityHours: 160,
  clamped: false,
});

describe("AllocPlanModal — per-cell include checkboxes (§245)", () => {
  // Two people can share a display name, and one person gets a cell per period, so a name made of
  // the resource name alone repeats on both axes. The checkbox names the resource id and the period.
  it("names every include checkbox uniquely when two resources share a name", () => {
    const cells = [cell(1, "Ana Lee", "2026-11"), cell(2, "Ana Lee", "2026-11"), cell(1, "Ana Lee", "2026-12")];
    render(
      <AllocPlanModal
        lang="en-US"
        open
        stage="preview"
        instruction="spread Ana over Q4"
        onInstruction={vi.fn()}
        onPropose={vi.fn()}
        cells={cells}
        skipped={[]}
        truncated={false}
        selected={new Set(cells.map(cellKey))}
        onToggle={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
        canCancel
      />,
    );
    // Anti-vacuity: the fixture really does repeat the visible row text.
    expect(screen.getAllByText("Ana Lee")).toHaveLength(3);
    expectRowUniqueNames({ minControls: 3, roles: ["checkbox"] });
  });
});
