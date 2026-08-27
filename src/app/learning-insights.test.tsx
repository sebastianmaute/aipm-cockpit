import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LearningInsights } from "./learning-insights";
import { loadI18n } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

beforeAll(async () => {
  await loadI18n("de");
});

const baseProps = () => ({
  lang: "en-US" as const,
  state: { "raid:actionRaidWhySeverity": { acted: 5, snoozed: 1, dismissed: 0, lastAt: 0 } },
  overrides: {} as Record<string, "auto" | "surface" | "suppress" | "off">,
  onSetOverride: vi.fn(),
  onReset: vi.fn(),
});

describe("LearningInsights", () => {
  it("renders a row per kind with counts", () => {
    render(<LearningInsights {...baseProps()} now={0} />);
    expect(screen.getByText("5")).toBeTruthy(); // acted count
  });
  it("changing the override select calls onSetOverride", () => {
    const p = baseProps();
    render(<LearningInsights {...p} now={0} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "suppress" } });
    expect(p.onSetOverride).toHaveBeenCalledWith("raid:actionRaidWhySeverity", "suppress");
  });
  it("shows the empty state with no data", () => {
    render(<LearningInsights {...baseProps()} state={{}} now={0} />);
    expect(screen.getByText(/No learning data yet/i)).toBeTruthy();
  });

  // §247/§248: `kind` (the React key here) cannot repeat in one render, so no
  // token map — but the plan's own literal suggestion, qualifying with
  // `sourceLabel(lang, kind)` ALONE, does not actually hold: several sources
  // legitimately emit more than one `why.key` in one render, and sourceLabel
  // drops the why.key. Seed exactly that — two REAL kinds sharing one source
  // ("milestone:actionMilestoneWhyOverdue" / "milestone:actionMilestoneWhyAtRisk",
  // both from next-actions/providers/milestone.ts) — the smallest fixture that
  // can distinguish the correct fix (source + raw kind) from the naive one
  // (source alone). `requireCollisionSeed` does not fit this file (nothing
  // here is SUPPOSED to collide once fixed), so this asserts distinctness
  // directly, as a regression pin over a fixture engineered to be adversarial
  // rather than merely distinct.
  it("keeps the override select distinct for two kinds sharing one source", () => {
    const state = {
      "milestone:actionMilestoneWhyOverdue": { acted: 1, snoozed: 0, dismissed: 0, lastAt: 0 },
      "milestone:actionMilestoneWhyAtRisk": { acted: 0, snoozed: 1, dismissed: 0, lastAt: 0 },
    };
    render(<LearningInsights {...baseProps()} state={state} now={0} />);
    // Measured: 2 override comboboxes + 1 Reset button = 3.
    //
    // `requireCollisionSeed` is deliberately OMITTED: it throws unless two
    // rendered names collide, and nothing here is SUPPOSED to collide once
    // the fix is correct — so the guard could never fire and would only add
    // ceremony. What makes this assertion non-vacuous instead is the fixture
    // itself: "milestone:actionMilestoneWhyOverdue" and
    // "milestone:actionMilestoneWhyAtRisk" are two REAL why-keys sharing one
    // source, chosen because `sourceLabel(lang, kind)` alone maps both to the
    // same string ("Milestone") — this is the minimal case that fails under
    // the naive fix and passes under the correct one (see mutation 1 in the
    // commit that added this test). A fixture with only one why-key per
    // source (e.g. two different sources, or one milestone kind alone) would
    // pass either way and make this test vacuous — if you change this
    // fixture, keep two why-keys under one shared source or this stops
    // proving anything.
    //
    // Measured, not merely reasoned: swapping this fixture for two DIFFERENT
    // sources with one why-key each ("milestone:actionMilestoneWhyOverdue" +
    // "task-attention:actionTaskWhyUnassigned") passes under BOTH the correct
    // fix and the naive `sourceLabel(lang, kind)`-alone one — that shape is
    // vacuous here, which is why it is not what this fixture seeds.
    expectRowUniqueNames({
      minControls: 3,
      roles: ["combobox", "button"],
    });
  });
});
