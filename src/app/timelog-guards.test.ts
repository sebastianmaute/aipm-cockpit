import { describe, expect, it } from "vitest";
import { canFetchBookings, canRefreshBookings } from "./timelog-guards";

const refreshOk = {
  isPopout: false,
  syncBusy: false,
  confirming: false,
  isMisconfigured: false,
  canRefresh: true,
};

const fetchOk = {
  isPopout: false,
  syncBusy: false,
  confirming: false,
  isMisconfigured: false,
  projectCustomerId: "42",
  selectedCount: 3,
};

describe("canRefreshBookings", () => {
  it("allows the refresh when nothing blocks it", () => {
    expect(canRefreshBookings(refreshOk)).toBe(true);
  });

  // ★ isMisconfigured is the whole point of §74: the button carried it and the
  //   handler did not, so any non-button caller would have acted against an
  //   unconfigured TimeLog.
  it("blocks the refresh when TimeLog is misconfigured", () => {
    expect(canRefreshBookings({ ...refreshOk, isMisconfigured: true })).toBe(false);
  });

  it("blocks the refresh in a popout, while busy, while confirming, and with nothing to refresh", () => {
    expect(canRefreshBookings({ ...refreshOk, isPopout: true })).toBe(false);
    expect(canRefreshBookings({ ...refreshOk, syncBusy: true })).toBe(false);
    expect(canRefreshBookings({ ...refreshOk, confirming: true })).toBe(false);
    expect(canRefreshBookings({ ...refreshOk, canRefresh: false })).toBe(false);
  });
});

describe("canFetchBookings", () => {
  it("allows the fetch when a customer and at least one project are picked", () => {
    expect(canFetchBookings(fetchOk)).toBe(true);
  });

  it("blocks the fetch when TimeLog is misconfigured", () => {
    expect(canFetchBookings({ ...fetchOk, isMisconfigured: true })).toBe(false);
  });

  it("blocks the fetch in a popout, while busy, and while confirming", () => {
    expect(canFetchBookings({ ...fetchOk, isPopout: true })).toBe(false);
    expect(canFetchBookings({ ...fetchOk, syncBusy: true })).toBe(false);
    expect(canFetchBookings({ ...fetchOk, confirming: true })).toBe(false);
  });

  it("blocks the fetch with no customer or no selected projects", () => {
    expect(canFetchBookings({ ...fetchOk, projectCustomerId: "" })).toBe(false);
    expect(canFetchBookings({ ...fetchOk, selectedCount: 0 })).toBe(false);
  });
});
