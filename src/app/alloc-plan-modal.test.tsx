import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AllocPlanModal, type AllocPlanModalProps } from "./alloc-plan-modal";
import { cellKey, type GroundedAllocCell } from "./alloc-plan/alloc-plan";
import { moveKey, type GroundedAlternative, type GroundedMove } from "./alloc-plan/alloc-ground-moves";
import { type AltEffect } from "./alloc-plan/alloc-effect";
import { type HoursMovePlan } from "./reassign-hours";
import { loadI18n, t } from "./i18n";
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

const emptyPlan: HoursMovePlan = { moves: [], nextResources: [], edits: [], overCapacity: [] };

function move(taskId: number, taskName: string, linked: boolean, hours = 16): GroundedMove {
  const base = {
    taskId,
    shortfallHours: 0,
    receiverCapHours: 0,
    outsideWindowHours: 0,
    shortfallPeriods: [],
    receiverCapPeriods: [],
  };
  const plan: HoursMovePlan = linked
    ? {
        ...emptyPlan,
        moves: [
          {
            ...base,
            fromResourceId: 1,
            toResourceId: 2,
            perPeriod: [
              { periodKey: "2026-09", hours: hours / 2 },
              { periodKey: "2026-10", hours: hours / 2 },
            ],
            movedHours: hours,
          },
        ],
      }
    : { ...emptyPlan, moves: [{ ...base, perPeriod: [], movedHours: 0, reason: "unlinked" }] };
  return {
    key: moveKey({ taskId }),
    taskId,
    taskName,
    fromResourceId: 1,
    fromLabel: "Maya Patel",
    toResourceId: 2,
    toLabel: "Liam Foster",
    linked,
    plan,
    snapshot: {} as GroundedMove["snapshot"],
  };
}

const alt = (over: Partial<GroundedAlternative> = {}): GroundedAlternative => ({
  summary: "",
  moves: [],
  skippedMoves: [],
  cells: [],
  skipped: [],
  truncated: false,
  ...over,
});

const noEffect: AltEffect = {
  movedTasks: 0,
  movedHours: 0,
  editedCells: 0,
  coveredCells: 0,
  movePlan: emptyPlan,
  costDelta: 0,
  externalHours: 0,
  noRateCount: 0,
  overCapacity: [],
};

function props(over: Partial<AllocPlanModalProps> = {}): AllocPlanModalProps {
  return {
    lang: "en-US",
    open: true,
    stage: "preview",
    onPropose: vi.fn(),
    alternatives: [alt()],
    activeIndex: 0,
    onSelectAlternative: vi.fn(),
    selected: new Set<string>(),
    staleMoves: new Set<string>(),
    effect: noEffect,
    onToggle: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    busy: false,
    canCancel: true,
    truncated: false,
    currency: "EUR",
    liveTaskName: () => undefined,
    liveResourceName: () => undefined,
    ...over,
  };
}

describe("AllocPlanModal — per-cell include checkboxes (§245)", () => {
  // Two people can share a display name, and one person gets a cell per period, so a name made of
  // the resource name alone repeats on both axes. The checkbox names the resource id and the period.
  it("names every include checkbox uniquely when two resources share a name", () => {
    const cells = [cell(1, "Ana Lee", "2026-11"), cell(2, "Ana Lee", "2026-11"), cell(1, "Ana Lee", "2026-12")];
    render(<AllocPlanModal {...props({ alternatives: [alt({ cells })], selected: new Set(cells.map(cellKey)) })} />);
    // Anti-vacuity: the fixture really does repeat the visible row text.
    expect(screen.getAllByText("Ana Lee")).toHaveLength(3);
    expectRowUniqueNames({ minControls: 3, roles: ["checkbox"] });
  });
});

describe("AllocPlanModal — review window (§769)", () => {
  beforeAll(() => loadI18n("de"));

  it("shows a picker only with two or more alternatives", () => {
    const one = render(<AllocPlanModal {...props({ alternatives: [alt({ summary: "Balance" })] })} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText("Balance")).toBeTruthy();
    one.unmount();
    render(
      <AllocPlanModal
        {...props({ alternatives: [alt({ summary: "Balance", rationale: "Even load" }), alt({ summary: "Speed" })] })}
      />,
    );
    // Label-in-name: each name starts with the visible "Alternative N" and also carries its summary.
    expect(screen.getByRole("radio", { name: /^Alternative 1/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /^Alternative 2/ })).toBeTruthy();
    // Both summaries are visible at once, so the alternatives can be compared without clicking through.
    expect(screen.getByText("Balance")).toBeTruthy();
    expect(screen.getByText("Speed")).toBeTruthy();
    expect(screen.getByText("Even load")).toBeTruthy();
  });

  it("switches the picker through onSelectAlternative", () => {
    const onSelectAlternative = vi.fn();
    render(<AllocPlanModal {...props({ alternatives: [alt(), alt()], onSelectAlternative })} />);
    screen.getByRole("radio", { name: /^Alternative 2/ }).click();
    expect(onSelectAlternative).toHaveBeenCalledWith(1);
  });

  it("switching alternatives shows that alternative's moves and keeps each one's ticks", () => {
    const a = alt({ moves: [move(42, "Design review", true)] });
    const b = alt({ moves: [move(7, "Spec", true)] });
    const { rerender } = render(
      <AllocPlanModal {...props({ alternatives: [a, b], activeIndex: 0, selected: new Set([moveKey({ taskId: 42 })]) })} />,
    );
    expect((screen.getByRole("checkbox", { name: /#42 Design review/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("checkbox", { name: /#7 Spec/ })).toBeNull();
    rerender(<AllocPlanModal {...props({ alternatives: [a, b], activeIndex: 1, selected: new Set() })} />);
    expect((screen.getByRole("checkbox", { name: /#7 Spec/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("checkbox", { name: /#42 Design review/ })).toBeNull();
  });

  it("each move row has a row-unique checkbox name and shows §774's hours", () => {
    const moves = [move(42, "Design review", true), move(43, "Design review", true)];
    render(<AllocPlanModal {...props({ alternatives: [alt({ moves })], selected: new Set(moves.map((m) => m.key)) })} />);
    expect(screen.getByRole("checkbox", { name: /#42 Design review: Maya Patel → Liam Foster/ })).toBeTruthy();
    expect(screen.getAllByText("16 h: Sep 8 h, Oct 8 h")).toHaveLength(2);
    expectRowUniqueNames({ minControls: 2, roles: ["checkbox"] });
  });

  it("an unlinked move says its hours come from the hour edits", () => {
    render(<AllocPlanModal {...props({ alternatives: [alt({ moves: [move(5, "Plan", false)] })] })} />);
    expect(screen.getByText(t("en-US", "allocPlanMoveUnlinked"))).toBeTruthy();
    // §774 shows no reason for an unlinked owner, so none is rendered here either.
    expect(screen.queryByText(t("en-US", "hoursMovedUnlinked", "Plan"))).toBeNull();
    expect(screen.queryByText(/without a linked resource/)).toBeNull();
    expect(screen.queryByText(t("en-US", "hoursSkipUnlinked"))).toBeNull();
  });

  // Second wave, 1 — a ticked hour edit the ticked moves already write is not applied, so it does not make Apply
  // available. Mutation: count it and Apply is enabled with nothing to apply.
  it("Apply stays disabled when every ticked row is covered by the moves", () => {
    const cells = [cell(1, "Ana Lee", "2026-11")];
    const selected = new Set(cells.map(cellKey));
    const covered = render(<AllocPlanModal {...props({ alternatives: [alt({ cells })], selected, effect: { ...noEffect, coveredCells: 1 } })} />);
    expect(screen.getByRole("button", { name: t("en-US", "allocPlanConfirm") })).toBeDisabled();
    covered.unmount();
    render(<AllocPlanModal {...props({ alternatives: [alt({ cells })], selected, effect: { ...noEffect, editedCells: 1 } })} />);
    expect(screen.getByRole("button", { name: t("en-US", "allocPlanConfirm") })).toBeEnabled();
  });

  // Third wave, 2: the wording with no capacity at all.
  it("an over-capacity warning against 0 h reads as such", () => {
    const effect: AltEffect = { ...noEffect, overCapacity: [{ resourceId: 2, periodKey: "2026-09", hours: 16, capacityHours: 0 }] };
    render(<AllocPlanModal {...props({ alternatives: [alt({ moves: [move(42, "Design review", true)] })], effect })} />);
    expect(screen.getByText("Liam Foster: 16 h of 0 h in Sep")).toBeTruthy();
  });

  // Third wave, 6 — at phone width the picker stacks and each summary wraps inside its option.
  // Mutation: drop the wrapping classes and the long summary forces the page wider than the screen.
  it("the alternative picker stacks below sm and wraps each summary", () => {
    const long = "Move the design review and the data migration to the platform team and shift October hours";
    render(<AllocPlanModal {...props({ alternatives: [alt({ summary: long }), alt({ summary: long })] })} />);
    const group = screen.getByRole("radiogroup", { name: t("en-US", "allocPlanAlternatives") });
    expect(group.className).toMatch(/(^| )flex-col( |$)/);
    expect(group.className).toMatch(/(^| )sm:flex-row( |$)/);
    expect(group.className).toMatch(/(^| )max-w-full( |$)/);
    const radio = screen.getByRole("radio", { name: /Alternative 2/ });
    for (const cls of ["min-w-0", "whitespace-normal", "break-words"]) expect(radio.className.split(" ")).toContain(cls);
    const summary = within(radio).getByText(long);
    for (const cls of ["min-w-0", "whitespace-normal", "break-words"]) expect(summary.className.split(" ")).toContain(cls);
  });

  it("over-capacity warning is text, not colour alone", () => {
    const effect: AltEffect = {
      ...noEffect,
      overCapacity: [{ resourceId: 2, periodKey: "2026-09", hours: 180, capacityHours: 160 }],
    };
    render(<AllocPlanModal {...props({ alternatives: [alt({ moves: [move(42, "Design review", true)] })], effect })} />);
    const warning = screen.getByText("Liam Foster: 180 h of 160 h in Sep");
    expect(warning.closest("li")?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it("effect line shows cost, externals and no-rate counts", () => {
    const effect: AltEffect = {
      ...noEffect,
      movedTasks: 2,
      movedHours: 24,
      editedCells: 3,
      costDelta: 1200,
      externalHours: 8,
      noRateCount: 2,
    };
    render(<AllocPlanModal {...props({ alternatives: [alt({ moves: [move(42, "Design review", true)] })], effect })} />);
    expect(screen.getByText(/^Moves 2 tasks [(]24 h[)] · edits 3 cells · [+].*1,200.* internal$/)).toBeTruthy();
    expect(screen.getByText("8 h to or from externals, not costed")).toBeTruthy();
    expect(screen.getByText("2 people have no rate")).toBeTruthy();
  });

  it("pluralises the cell count and leaves the moves part out of a cells-only plan", () => {
    const effect: AltEffect = { ...noEffect, editedCells: 1, costDelta: -300 };
    render(<AllocPlanModal {...props({ alternatives: [alt({ cells: [cell(1, "Ana Lee", "2026-11")] })], effect })} />);
    const line = screen.getByText(/edits 1 cell · /);
    expect(line.textContent).not.toMatch(/Moves/);
    expect(line.textContent).not.toMatch(/cells/);
    expect(line.textContent).toMatch(/-.*300.* internal/);
  });

  it("says there is no cost change when the cost rounds to zero", () => {
    const effect: AltEffect = { ...noEffect, movedTasks: 1, movedHours: 4, costDelta: 0.2 };
    render(<AllocPlanModal {...props({ alternatives: [alt({ moves: [move(42, "Design review", true)] })], effect })} />);
    expect(screen.getByText("Moves 1 task (4 h) · no cost change")).toBeTruthy();
  });

  it("clamps an out-of-range activeIndex for the picker and the shown alternative", () => {
    const a = alt({ moves: [move(42, "Design review", true)] });
    render(<AllocPlanModal {...props({ alternatives: [alt(), a], activeIndex: 5 })} />);
    expect(screen.getByRole("checkbox", { name: /#42 Design review/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /^Alternative 2/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("skipped list names covered-by-move and each move reason", () => {
    const a = alt({
      moves: [move(42, "Design review", true)],
      skipped: [{ resourceId: 2, periodKey: "2026-09", reason: "covered-by-move" }],
      skippedMoves: [
        { taskId: 9, toResourceId: 2, reason: "closed" },
        { taskId: 10, toResourceId: 2, reason: "jira" },
        { taskId: 11, toResourceId: 2, reason: "same-owner" },
        { taskId: 12, toResourceId: 99, reason: "unknown-resource" },
        { taskId: 13, toResourceId: 2, reason: "unknown-task" },
        { taskId: 14, toResourceId: 2, reason: "duplicate" },
      ],
    });
    render(<AllocPlanModal {...props({ alternatives: [a] })} />);
    const list = screen.getByRole("heading", { name: t("en-US", "allocPlanSkippedTitle") }).parentElement as HTMLElement;
    expect(within(list).getByText(/already covered by a task move/)).toBeTruthy();
    for (const key of [
      "allocPlanSkipMoveClosed",
      "allocPlanSkipMoveJira",
      "allocPlanSkipMoveSameOwner",
      "allocPlanSkipMoveUnknownResource",
      "allocPlanSkipMoveUnknownTask",
      "allocPlanSkipMoveDuplicate",
    ] as const) {
      expect(within(list).getByText(new RegExp(t("en-US", key)))).toBeTruthy();
    }
  });

  it("an empty alternative says there is nothing to apply and disables Apply", () => {
    render(<AllocPlanModal {...props({ alternatives: [alt()] })} />);
    expect(screen.getByText(t("en-US", "allocPlanAlternativeEmpty"))).toBeTruthy();
    expect((screen.getByRole("button", { name: t("en-US", "allocPlanConfirm") }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the effect line in German", () => {
    const effect: AltEffect = { ...noEffect, movedTasks: 2, movedHours: 24, editedCells: 1, costDelta: 1200, noRateCount: 2 };
    render(
      <AllocPlanModal
        {...props({ lang: "de", alternatives: [alt({ moves: [move(42, "Design review", true)] })], effect })}
      />,
    );
    expect(screen.getByText(/^Verschiebt 2 Aufgaben [(]24 Std[.][)] · ändert 1 Zelle · [+].*1[.]200.* intern$/)).toBeTruthy();
    expect(screen.getByText("2 Personen haben keinen Stundensatz")).toBeTruthy();
  });
});
