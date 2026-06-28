import { describe, expect, it } from "vitest";
import { NAV_GROUPS, parseHash, buildHash } from "./nav-config";
import { isViewEnabled } from "./feature-modules";
describe("actions view registration", () => {
  it("is a sub-menu child of Dashboard in the Overview nav group", () => {
    const overview = NAV_GROUPS.find((g) => g.labelKey === "navGroupOverview")!;
    const dashboard = overview.items.find((i) => i.view === "dashboard")!;
    expect(dashboard.children?.some((c) => c.view === "actions")).toBe(true);
  });
  it("is a core view (enabled regardless of features)", () => {
    expect(isViewEnabled("actions", [])).toBe(true);
  });
  it("round-trips through the hash", () => {
    expect(parseHash(buildHash("actions", 5))).toEqual({ view: "actions", itemId: 5 });
  });
});
