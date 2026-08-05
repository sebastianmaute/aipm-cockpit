import { describe, expect, it } from "vitest";
import { canFetchBookings, canLoadManagedProjects, canRefreshBookings } from "./timelog-guards";

const loadOk = {
  isPopout: false,
  syncBusy: false,
  confirming: false,
  isMisconfigured: false,
};

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
  projectCustomerId: 42,
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

describe("canLoadManagedProjects", () => {
  it("allows the load when nothing blocks it", () => {
    expect(canLoadManagedProjects(loadOk)).toBe(true);
  });

  // ★ This action's handler was the LAST holdout of the §74 asymmetry: it
  //   checked only `isPopout || syncBusy`, so `isMisconfigured` and
  //   `confirming` are the two arms that would have regressed silently.
  it("blocks the load when TimeLog is misconfigured or a confirm is open", () => {
    expect(canLoadManagedProjects({ ...loadOk, isMisconfigured: true })).toBe(false);
    expect(canLoadManagedProjects({ ...loadOk, confirming: true })).toBe(false);
  });

  it("blocks the load in a popout and while busy", () => {
    expect(canLoadManagedProjects({ ...loadOk, isPopout: true })).toBe(false);
    expect(canLoadManagedProjects({ ...loadOk, syncBusy: true })).toBe(false);
  });
});
