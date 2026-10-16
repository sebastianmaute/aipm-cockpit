import { beforeAll, describe, expect, it } from "vitest";
import { actionText } from "./action-text";
import { loadI18n } from "./i18n";

describe("actionText", () => {
  beforeAll(() => loadI18n("de"));

  it("formats a date param in the language's locale, EN and DE", () => {
    const why = { key: "actionForecastSimWhy" as const, params: [31, { date: "2026-12-01" }] };
    expect(actionText("en-US", why)).toBe("Simulated: 31% chance of finishing by Dec 1, 2026");
    expect(actionText("de", why)).toBe("Simuliert: 31 % Wahrscheinlichkeit, bis 1. Dez. 2026 fertig zu sein");
  });

  it("formats the <1% why-line's only param as a date", () => {
    const why = { key: "actionForecastSimWhyBelow1" as const, params: [{ date: "2026-12-01" }] };
    expect(actionText("en-GB", why)).toBe("Simulated: <1% chance of finishing by 1 Dec 2026");
  });

  it("passes string and number params through unchanged, and a text with no params", () => {
    expect(actionText("en-US", { key: "actionForecastSimTitle", params: ["Go-live", 31] }))
      .toBe("Go-live is unlikely on time — 31% chance");
    expect(actionText("en-US", { key: "actionMilestoneWhyAtRisk" })).not.toContain("{0}");
  });
});
