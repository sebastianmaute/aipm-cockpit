import { describe, expect, it } from "vitest";
import { canClearAllFetched, canFetchBookings, canLoadManagedProjects, canRefreshBookings } from "./timelog-guards";

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

describe("canClearAllFetched", () => {
  const clearOk = { isPopout: false, syncBusy: false, confirming: false, hasFetched: true };

  it("allows the clear when something has been fetched and nothing blocks it", () => {
    expect(canClearAllFetched(clearOk)).toBe(true);
  });

  it("blocks the clear with nothing fetched, in a popout, while busy, and while confirming", () => {
    expect(canClearAllFetched({ ...clearOk, hasFetched: false })).toBe(false);
    expect(canClearAllFetched({ ...clearOk, isPopout: true })).toBe(false);
    expect(canClearAllFetched({ ...clearOk, syncBusy: true })).toBe(false);
    expect(canClearAllFetched({ ...clearOk, confirming: true })).toBe(false);
  });

  // ★★★ The deliberate omission. Clearing is the only action that does not
  //     reach the network — it forgets local data the user already has — so a
  //     broken TimeLog config must NOT trap the user with stale bookings they
  //     can neither refresh nor remove. Every other action gains
  //     `isMisconfigured`; this one must not.
  //     ★ A `@ts-expect-error` on an extra `isMisconfigured` property was tried
  //       here and REMOVED because the directive was unused (`tsc` TS2578).
  //       ★★ The reason first written here — "excess-property checking does not
  //       fire through a spread" — is FALSE, and worth correcting because a
  //       reader would carry that rule to other files: EPC does fire through a
  //       spread. The real rule is FRESHNESS. EPC applies to an object literal
  //       in the argument position and is lost once the literal is bound to a
  //       `const` first — which is exactly what the line below does. So the
  //       guarantee is behavioural, not type-level: `canClearAllFetched` never
  //       reads such a field, which is what this asserts.
  it("ignores TimeLog config state entirely — a misconfigured TimeLog can still clear", () => {
    const withExtra = { ...clearOk, isMisconfigured: true } as typeof clearOk;
    expect(canClearAllFetched(withExtra)).toBe(true);
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
