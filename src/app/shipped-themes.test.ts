import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { cleanScheme } from "./color-schemes";

const load = (f: string) => JSON.parse(readFileSync(`public/themes/${f}`, "utf8"));

describe("shipped theme files", () => {
  test("AIPM.json is importable and byte-faithful", () => {
    const raw = load("AIPM.json");
    expect(raw.light["--AIPM-dark-blue"]).toBe("#004159");
    expect(raw.light["--AIPM-green-strong"]).toBe("#4d7000");
    expect(raw.structural["--shadow-card"]).toBe("none");
    expect(raw.supportsDark).toBe(true);
    const s = cleanScheme(raw, "u-1");
    expect(s).not.toBeNull();
    expect(s!.dark?.["--background"]).toBe("#0b0f12");
    expect(s!.structural?.["--gradient-kpi"]).toBe("var(--AIPM-green)");
  });
  test("mockup.json carries the gradient + shadows, light-only", () => {
    const raw = load("mockup.json");
    expect(raw.supportsDark).toBe(false);
    expect(raw.structural["--gradient-kpi"]).toContain("linear-gradient");
    expect(raw.structural["--shadow-card"]).toContain("rgba");
    const s = cleanScheme(raw, "u-2");
    expect(s!.structural?.["--gradient-kpi"]).toContain("linear-gradient");
  });
});
