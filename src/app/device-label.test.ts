import { describe, it, expect, beforeEach, vi } from "vitest";
import { getDeviceLabel, peekDeviceLabel } from "./device-label";

describe("getDeviceLabel", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("mints an 8-character label once and returns the same one afterwards", () => {
    const first = getDeviceLabel();
    expect(first).toHaveLength(8);
    expect(getDeviceLabel()).toBe(first);
    expect(localStorage.getItem("aipm-cockpit:device-label")).toBe(first);
  });

  it("falls back to unknown when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(getDeviceLabel()).toBe("unknown");
  });
});

describe("peekDeviceLabel", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns null and writes nothing when no label was minted", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    expect(peekDeviceLabel()).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem("aipm-cockpit:device-label")).toBeNull();
  });

  it("returns the stored label", () => {
    const minted = getDeviceLabel();
    expect(peekDeviceLabel()).toBe(minted);
  });

  it("returns null when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(peekDeviceLabel()).toBeNull();
  });
});
