import { describe, it, expect } from "vitest";
import { defaultSettings } from "./settings-menu";

describe("defaultSettings", () => {
  it("popout.reuseWindow defaults to false", () => {
    expect(defaultSettings.popout.reuseWindow).toBe(false);
  });
});
