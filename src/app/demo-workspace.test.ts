import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDemoWorkspace, DEMO_AS_OF } from "./demo-workspace";

const raw = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));

describe("buildDemoWorkspace", () => {
  it("is unshifted on DEMO_AS_OF", () => {
    expect(buildDemoWorkspace(raw, DEMO_AS_OF).plan.startDate).toBe(raw.plan.startDate);
  });
  it("keeps today inside the plan window months later", () => {
    const today = "2027-03-10";
    const ws = buildDemoWorkspace(raw, today);
    expect(ws.plan.startDate < today && today < ws.plan.endDate).toBe(true);
  });
  it("rejects a corrupt master loudly (strict decode)", () => {
    expect(() => buildDemoWorkspace({ tasks: 1 }, DEMO_AS_OF)).toThrow();
  });
});
