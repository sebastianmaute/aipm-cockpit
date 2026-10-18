import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForecastLeverCell, alternativeLever } from "./forecast-lever-cell";
import type { LeverOutcome, WhatItTakes } from "./forecast-levers";
import { loadI18n } from "./i18n";
import { rowLabel } from "./row-tokens";

const GO_LIVE = { kind: "milestone", id: 1 } as const;
const OUT: LeverOutcome = { state: "out-of-reach" };
function result(over: Partial<WhatItTakes> = {}): WhatItTakes {
  return { target: GO_LIVE, chance: 0.31, prioritised: 0.58, people: OUT, tasks: OUT, ...over };
}
const PEOPLE_2: LeverOutcome = { state: "reaches", n: 2, chance: 0.81, hours: null };
const TASKS_9: LeverOutcome = { state: "reaches", n: 9, chance: 0.8, hours: null };

function renderCell(r: WhatItTakes | "pending", onExplore = vi.fn()) {
  render(<ForecastLeverCell lang="en-US" milestoneName="Go-live" result={r} goal={80} onExplore={onExplore} />);
  return { onExplore, user: userEvent.setup() };
}
const badges = () => [...document.querySelectorAll("[data-lever-badge]")].map((b) => b.textContent);

describe("ForecastLeverCell", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("pending reads Working it out… with no Explore", () => {
    renderCell("pending");
    expect(screen.getByText("Working it out…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a reaching people lever leads, then the tasks lever with or, then prioritising", () => {
    renderCell(result({ people: PEOPLE_2, tasks: TASKS_9 }));
    expect(screen.getByText("+2 people (team average)")).toBeInTheDocument();
    expect(badges()).toEqual(["+2 people (team average)", "or 9 fewer tasks", "prioritising alone: not enough"]);
  });

  it("Explore is named for its row and opens the people lever first", async () => {
    const { onExplore, user } = renderCell(result({ people: PEOPLE_2, tasks: TASKS_9 }));
    const explore = screen.getByRole("button", { name: rowLabel("Explore", "Go-live") });
    await user.click(explore);
    expect(onExplore).toHaveBeenCalledWith("people", 2);
  });

  it("with only tasks reaching, Explore opens the tasks lever", async () => {
    const { onExplore, user } = renderCell(result({ tasks: TASKS_9 }));
    await user.click(screen.getByRole("button", { name: rowLabel("Explore", "Go-live") }));
    expect(onExplore).toHaveBeenCalledWith("tasks", 9);
    expect(badges()).toEqual(["9 fewer tasks", "adding people: not within reach", "prioritising alone: not enough"]);
  });

  it("a tasks lever with known effort shows its hours", () => {
    renderCell(result({ people: PEOPLE_2, tasks: { ...TASKS_9, hours: 54 } }));
    expect(badges()).toEqual(["+2 people (team average)", "or 9 fewer tasks (≈ 54 h)", "prioritising alone: not enough"]);
  });

  it("the hours read in German with German digit grouping", () => {
    render(<ForecastLeverCell lang="de" milestoneName="Go-live" result={result({ tasks: { ...TASKS_9, hours: 1054 } })} goal={80} />);
    expect(badges()[0]).toBe("9 Aufgaben weniger (≈ 1.054 h)");
  });

  it("one person reads singular", () => {
    renderCell(result({ people: { state: "reaches", n: 1, chance: 0.82, hours: null } }));
    expect(screen.getByText("+1 person (team average)")).toBeInTheDocument();
  });

  it("prioritise-only: prioritising leads, no Explore", () => {
    renderCell(result({ chance: 0.64, prioritised: 0.83 }));
    expect(badges()).toEqual(["prioritise it → 83%", "adding people: not within reach", "dropping tasks: not within reach"]);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("an inert people lever says it needs booked hours", () => {
    renderCell(result({ people: { state: "inert", reason: "needs-booked-hours" }, tasks: TASKS_9 }));
    expect(screen.getByText("adding people needs booked hours")).toBeInTheDocument();
  });

  it("no lever reaching says so, and offers no Explore", () => {
    renderCell(result());
    expect(screen.getByText("No single lever reaches 80% — consider combining them in Scenarios, or ask Claude.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("on target reads On target with no badges", () => {
    renderCell(result({ chance: 0.88, people: { state: "on-target" }, tasks: { state: "on-target" } }));
    expect(screen.getByText("On target")).toBeInTheDocument();
    expect(badges()).toEqual([]);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("two rows get distinct Explore names", () => {
    render(
      <>
        <ForecastLeverCell lang="en-US" milestoneName="Go-live" result={result({ people: PEOPLE_2 })} goal={80} onExplore={() => {}} />
        <ForecastLeverCell lang="en-US" milestoneName="UAT" result={result({ people: PEOPLE_2 })} goal={80} onExplore={() => {}} />
      </>,
    );
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
  });

  it("without onExplore there is no button", () => {
    render(<ForecastLeverCell lang="en-US" milestoneName="Go-live" result={result({ people: PEOPLE_2 })} goal={80} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reads in German", () => {
    render(<ForecastLeverCell lang="de" milestoneName="Go-live" result={result({ people: PEOPLE_2, tasks: TASKS_9 })} goal={80} onExplore={() => {}} />);
    expect(screen.getByText("+2 Personen (Teamdurchschnitt)")).toBeInTheDocument();
    expect(screen.getByText("oder 9 Aufgaben weniger")).toBeInTheDocument();
  });
});

describe("alternativeLever", () => {
  it("names the other reaching lever, or null", () => {
    expect(alternativeLever(result({ people: PEOPLE_2, tasks: TASKS_9 }), "people")).toEqual({ kind: "tasks", n: 9 });
    expect(alternativeLever(result({ people: PEOPLE_2, tasks: TASKS_9 }), "tasks")).toEqual({ kind: "people", n: 2 });
    expect(alternativeLever(result({ people: PEOPLE_2 }), "people")).toBeNull();
  });
});
