import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_BANNER_DONE_KEY, markDemoBannerDone, readDemoBannerDone } from "./demo-banner-state";

describe("demo banner state", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("uses the per-device aipm-cockpit key", () => {
    expect(DEMO_BANNER_DONE_KEY).toBe("aipm-cockpit:demo-banner-done");
  });

  it("reads false until marked, then true on every later read", () => {
    expect(readDemoBannerDone()).toBe(false);
    markDemoBannerDone();
    expect(readDemoBannerDone()).toBe(true);
    expect(window.localStorage.getItem(DEMO_BANNER_DONE_KEY)).not.toBeNull();
  });

  it("reads false (banner stays visible) when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readDemoBannerDone()).toBe(false);
  });

  it("does not throw when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => markDemoBannerDone()).not.toThrow();
  });
});
