import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GanttSetupChecklist, RaciSetupChecklist, ResourcesSetupChecklist } from "./view-setup-checklists";
import { t } from "./i18n";
import { ALL_MODULE_IDS } from "./feature-modules";

const L = "en-US" as const;
afterEach(cleanup);
const rows = () => screen.getAllByRole("listitem");
const buttonNames = () => screen.queryAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);

describe("GanttSetupChecklist (§736)", () => {
  const none = { datedDone: false, depsDone: false, milestonesDone: false, milestonesApplicable: true, next: 1 as const };

  test("names all three steps in order, not only the first", () => {
    render(<GanttSetupChecklist lang={L} steps={none} collapsed={false} />);
    expect(screen.getByRole("region", { name: t(L, "ganttSetupTitle") })).toBeInTheDocument();
    const r = rows();
    expect(r).toHaveLength(3);
    expect(within(r[0]).getByText(t(L, "ganttSetupDated"))).toBeInTheDocument();
    expect(within(r[1]).getByText(t(L, "ganttSetupDeps"))).toBeInTheDocument();
    expect(within(r[2]).getByText(t(L, "ganttSetupMilestones"))).toBeInTheDocument();
    expect(r[0].getAttribute("data-next")).toBe("true");
    expect(within(r[0]).getByText(t(L, "budgetSetupNext"))).toBeInTheDocument();
  });

  test("offers no buttons: the Gantt toolbar owns Add task and Add milestone", () => {
    render(<GanttSetupChecklist lang={L} steps={none} collapsed={false} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("drops the milestone step when Milestones is off", () => {
    render(<GanttSetupChecklist lang={L} steps={{ ...none, milestonesApplicable: false }} collapsed={false} />);
    expect(rows()).toHaveLength(2);
    expect(screen.queryByText(t(L, "ganttSetupMilestones"))).toBeNull();
  });

  test("collapsed: the summary counts done steps of the shown ones, and dismiss calls back", async () => {
    const onDismiss = vi.fn();
    render(<GanttSetupChecklist lang={L} steps={{ ...none, datedDone: true, next: 2 }} collapsed onDismiss={onDismiss} />);
    expect(screen.getByText(t(L, "ganttSetupCollapsed", 1, 3))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t(L, "ganttSetupDismiss") }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("RaciSetupChecklist (§734)", () => {
  const none = { milestonesDone: false, stakeholdersDone: false, assignedDone: false, next: 1 as const };

  test("names both missing inputs at once, with a link to each", async () => {
    const onGo = vi.fn();
    render(<RaciSetupChecklist lang={L} steps={none} onGo={onGo} />);
    const r = rows();
    expect(r).toHaveLength(3);
    await userEvent.click(within(r[0]).getByRole("button", { name: t(L, "raciSetupGoMilestones") }));
    await userEvent.click(within(r[1]).getByRole("button", { name: t(L, "raciSetupGoStakeholders") }));
    expect(onGo.mock.calls).toEqual([["milestones"], ["stakeholders"]]);
  });

  test("a done step drops its link; a popout (no onGo) shows none", () => {
    render(<RaciSetupChecklist lang={L} steps={{ ...none, milestonesDone: true, next: 2 }} onGo={vi.fn()} />);
    expect(screen.queryByRole("button", { name: t(L, "raciSetupGoMilestones") })).toBeNull();
    cleanup();
    render(<RaciSetupChecklist lang={L} steps={none} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("a link to a view whose function is off becomes the turn-on hint", async () => {
    const onCommitFeatures = vi.fn();
    const features = ALL_MODULE_IDS.filter((id) => id !== "milestones");
    render(<RaciSetupChecklist lang={L} steps={none} onGo={vi.fn()} features={features} onCommitFeatures={onCommitFeatures} />);
    expect(screen.queryByRole("button", { name: t(L, "raciSetupGoMilestones") })).toBeNull();
    const turnOn = within(rows()[0]).getByRole("button", { name: new RegExp(t(L, "raciSetupMilestones")) });
    await userEvent.click(turnOn);
    expect(onCommitFeatures).toHaveBeenCalledWith(ALL_MODULE_IDS);
  });
});

describe("ResourcesSetupChecklist (§731)", () => {
  const none = { ratesDone: false, structureDone: false, peopleDone: false, next: 1 as const };

  test("names the setup order, and never shows two identically named links", () => {
    render(<ResourcesSetupChecklist lang={L} steps={none} peopleLink onGo={vi.fn()} />);
    expect(rows()).toHaveLength(3);
    expect(within(rows()[1]).getByText(t(L, "resourcesSetupStructure"))).toBeInTheDocument();
    const names = buttonNames();
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([t(L, "budgetSetupGoRoles"), t(L, "budgetSetupGoPeople")]);
  });

  test("once rates are done, the Roles link moves to the disciplines step", async () => {
    const onGo = vi.fn();
    render(<ResourcesSetupChecklist lang={L} steps={{ ...none, ratesDone: true, next: 2 }} peopleLink onGo={onGo} />);
    await userEvent.click(within(rows()[1]).getByRole("button", { name: t(L, "budgetSetupGoRoles") }));
    expect(onGo).toHaveBeenCalledWith("manage-roles");
    expect(within(rows()[0]).queryByRole("button")).toBeNull();
  });

  test("in the directory (peopleLink false) the people step has no link", () => {
    render(<ResourcesSetupChecklist lang={L} steps={none} peopleLink={false} onGo={vi.fn()} />);
    expect(within(rows()[2]).queryByRole("button")).toBeNull();
  });
});
