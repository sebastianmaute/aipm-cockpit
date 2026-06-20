import { describe, it, expect } from "vitest";
import { parseFeatureGuide } from "../../scripts/gen-operating-guide.mjs";

const MD = `# App Feature Guide
intro
## Overview
- a
- b
## Open Points
<!-- views: open-points -->
- tasks
- AI: I can create tasks.
## Calendar
<!-- views: calendar -->
- clock
`;
const valid = ["open-points", "calendar", "settings"];

describe("parseFeatureGuide", () => {
  it("emits an always-on overview + per-view guides with scopes", () => {
    const out = parseFeatureGuide(MD, valid);
    expect(out[0]).toMatchObject({ id: "builtin-app-overview", scope: {} });
    expect(out[0].content).toContain("- a");
    const op = out.find((g) => g.id === "builtin-feature-open-points");
    expect(op.scope).toEqual({ views: ["open-points"] });
    expect(op.content).toContain("AI: I can create tasks.");
    const cal = out.find((g) => g.id === "builtin-feature-calendar");
    expect(cal.scope).toEqual({ views: ["calendar"] });
  });
  it("throws on an unknown view id in a marker", () => {
    const bad = `## Overview\n- x\n## Bad\n<!-- views: not-a-view -->\n- y\n`;
    expect(() => parseFeatureGuide(bad, valid)).toThrow(/not-a-view/);
  });
});
