import { describe, expect, it } from "vitest";
import {
  canClearAllFetched,
  canFetchBookings,
  canLoadManagedProjects,
  canRefreshAndReapply,
  canRefreshBookings,
} from "./timelog-guards";

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

describe("canRefreshAndReapply", () => {
  it("allows the action when every precondition holds", () => {
    expect(canRefreshAndReapply(refreshOk)).toBe(true);
  });

  // ★ Each arm gets its own case rather than one multi-expect block. This file
  //   records FOUR instances of a handler guard drifting from its button's
  //   predicate, and every one of them was a PARTIAL mirror reading as a
  //   complete one — so a table that names each arm is the shape that makes a
  //   dropped arm visible in the failure output.
  it.each(["isPopout", "syncBusy", "confirming", "isMisconfigured"] as const)(
    "refuses when %s is set",
    (k) => {
      expect(canRefreshAndReapply({ ...refreshOk, [k]: true })).toBe(false);
    },
  );

  it("refuses when there is nothing to refresh", () => {
    expect(canRefreshAndReapply({ ...refreshOk, canRefresh: false })).toBe(false);
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
  //       reader would carry that rule to other files. Measured with this repo's
  //       own tsc: EPC fires on properties WRITTEN in the literal, including
  //       alongside a spread (`f({ ...base, extra: 1 })` IS an error) — but not
  //       on properties arriving THROUGH the spread. It is then defeated by
  //       EITHER an `as` assertion or binding to a const first, and the line
  //       below does BOTH, so no single one of them is "the" reason.
  //       Net: the guarantee here is behavioural, not type-level —
  //       `canClearAllFetched` never reads such a field, which is what this
  //       asserts.
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
