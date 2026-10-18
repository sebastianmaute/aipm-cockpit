import { beforeAll, describe, expect, it } from "vitest";
import { exploreDraftName } from "./forecast-explore-draft";
import { SCENARIO_NAME_MAX, validateScenarioDraft, type ForecastScenario } from "./forecast-scenarios";
import { loadI18n, type Lang } from "./i18n";

const LONG = "Customer onboarding portal go-live phase"; // 40 characters
const scenario = (id: number, name: string): ForecastScenario => ({ id, name, changes: [{ kind: "scope", tasks: -1, on: "2026-10-14" }] });
const passes = (name: string, list: readonly ForecastScenario[]) =>
  validateScenarioDraft({ name, changes: [{ kind: "scope", tasks: -1, on: "2026-10-14" }] }, list, null);

describe("exploreDraftName (§502 part 4)", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("keeps a short name whole", () => {
    expect(exploreDraftName("en-US", "Go-live", "+2 people", [])).toBe("Go-live — what it would take (+2 people)");
  });

  it.each<Lang>(["en-US", "de"])("a 40-character milestone is shortened with an ellipsis and passes Save (%s)", (lang) => {
    expect(LONG).toHaveLength(40);
    const name = exploreDraftName(lang, LONG, "12 fewer tasks", []);
    expect(name.length).toBeLessThanOrEqual(SCENARIO_NAME_MAX);
    expect(name).toContain("…");
    expect(name).toContain("(12 fewer tasks)");
    expect(name.startsWith("Customer onboarding")).toBe(true);
    expect(passes(name, [])).toBeNull();
  });

  it("a taken name gets (2), then (3), still within the limit", () => {
    const first = exploreDraftName("en-US", "Go-live", "+2 people", []);
    const second = exploreDraftName("en-US", "Go-live", "+2 people", [scenario(1, first.toUpperCase())]);
    expect(second).toBe("Go-live — what it would take (+2 people) (2)");
    const third = exploreDraftName("en-US", "Go-live", "+2 people", [scenario(1, first), scenario(2, second)]);
    expect(third).toBe("Go-live — what it would take (+2 people) (3)");
    const longFirst = exploreDraftName("en-US", LONG, "+2 people", []);
    const longSecond = exploreDraftName("en-US", LONG, "+2 people", [scenario(1, longFirst)]);
    expect(longSecond.length).toBeLessThanOrEqual(SCENARIO_NAME_MAX);
    expect(longSecond.endsWith(" (2)")).toBe(true);
    expect(passes(longSecond, [scenario(1, longFirst)])).toBeNull();
  });
});
