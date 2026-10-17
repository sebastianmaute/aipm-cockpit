import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForecastAskClaude, worstMilestoneName } from "./forecast-ask-claude";
import { loadI18n } from "./i18n";
import type { MilestoneChance } from "./forecast/milestones";
import type { Milestone } from "./types";

const requestChat = vi.fn();
vi.mock("./workspace-tab-context", () => ({ useWorkspaceTab: () => ({ requestChat }) }));

const ms = (id: number, name: string, date: string): Milestone => ({ id, name, date, linkedTaskIds: [] });
const chance = (id: number, c: number): MilestoneChance => ({ id, state: "chance", chance: c, chancePrioritised: c });

const items = () => screen.getAllByRole("button").slice(1).map((b) => b.textContent);
const openMenu = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Ask Claude" }));

describe("ForecastAskClaude", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });
  beforeEach(() => requestChat.mockReset());

  test("Quick offers Explain and the worst milestone only", async () => {
    const user = userEvent.setup();
    render(<ForecastAskClaude lang="en-US" inScenarios={false} scenarioCount={0} worstMilestone="Go-live" />);
    await openMenu(user);
    expect(items()).toEqual(["Explain this forecast", "What would get Go-live on time?"]);
  });

  test("Quick without a worst milestone offers Explain alone", async () => {
    const user = userEvent.setup();
    render(<ForecastAskClaude lang="en-US" inScenarios={false} scenarioCount={0} worstMilestone={null} />);
    await openMenu(user);
    expect(items()).toEqual(["Explain this forecast"]);
  });

  test("Scenarios with no scenario offers Explain and Suggest", async () => {
    const user = userEvent.setup();
    render(<ForecastAskClaude lang="en-US" inScenarios scenarioCount={0} worstMilestone={null} />);
    await openMenu(user);
    expect(items()).toEqual(["Explain this forecast", "Suggest a scenario that makes plan end"]);
  });

  test("Scenarios with one scenario offers all four, in order", async () => {
    const user = userEvent.setup();
    render(<ForecastAskClaude lang="en-US" inScenarios scenarioCount={1} worstMilestone="Go-live" />);
    await openMenu(user);
    expect(items()).toEqual([
      "Explain this forecast",
      "What would get Go-live on time?",
      "Compare my scenarios",
      "Suggest a scenario that makes plan end",
    ]);
  });

  test("picking an item sends its interpolated body and closes the menu", async () => {
    const user = userEvent.setup();
    render(<ForecastAskClaude lang="en-US" inScenarios={false} scenarioCount={0} worstMilestone="Go-live" />);
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "What would get Go-live on time?" }));
    expect(requestChat).toHaveBeenCalledWith(
      'What would it take to get the milestone "Go-live" on time? Use get_forecast, try a few what-if changes, and tell me which ones raise its chance the most. Don\'t save anything.',
      true,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Escape closes the menu and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<ForecastAskClaude lang="en-US" inScenarios={false} scenarioCount={0} worstMilestone={null} />);
    await openMenu(user);
    await user.tab();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ask Claude" }));
  });

  test("reads in German", async () => {
    render(<ForecastAskClaude lang="de" inScenarios={false} scenarioCount={0} worstMilestone={null} />);
    expect(screen.queryByRole("button", { name: "Ask Claude" })).toBeNull();
    expect(screen.getByRole("button", { name: "Claude fragen" })).toBeTruthy();
  });
});

describe("worstMilestoneName", () => {
  const list = [ms(1, "Alpha", "2026-12-01"), ms(2, "Beta", "2026-11-01"), ms(3, "Gamma", "2026-10-20")];

  test("picks the lowest chance", () => {
    expect(worstMilestoneName(list, [chance(1, 0.9), chance(2, 0.4), chance(3, 0.7)])).toBe("Beta");
  });
  test("a tie goes to the earlier date", () => {
    expect(worstMilestoneName(list, [chance(1, 0.5), chance(2, 0.5), chance(3, 0.8)])).toBe("Beta");
  });
  test("ignores milestones without a chance", () => {
    expect(worstMilestoneName(list, [{ id: 1, state: "overdue" }, { id: 3, state: "no-linked-tasks" }, chance(2, 0.99)])).toBe("Beta");
  });
  test("null when nothing carries a chance, or there is no run", () => {
    expect(worstMilestoneName(list, [{ id: 1, state: "overdue" }])).toBeNull();
    expect(worstMilestoneName(list, null)).toBeNull();
  });
});
