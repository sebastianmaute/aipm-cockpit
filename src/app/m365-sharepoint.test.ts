import { describe, it, expect } from "vitest";
import { isSharePointEnabled } from "./m365-sharepoint";

describe("isSharePointEnabled", () => {
  it("true only when m365 enabled AND sharepoint enabled", () => {
    expect(isSharePointEnabled({ m365: { enabled: true, sharepoint: true } })).toBe(true);
  });
  it("false when sharepoint off", () => {
    expect(isSharePointEnabled({ m365: { enabled: true, sharepoint: false } })).toBe(false);
  });
  it("false when m365 off", () => {
    expect(isSharePointEnabled({ m365: { enabled: false, sharepoint: true } })).toBe(false);
  });
  it("false when integrations absent", () => {
    expect(isSharePointEnabled({})).toBe(false);
    expect(isSharePointEnabled(undefined)).toBe(false);
  });
});
