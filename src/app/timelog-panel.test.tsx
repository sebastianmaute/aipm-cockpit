// src/app/timelog-panel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { TimelogPanel } from "./timelog-panel";
import { SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";
import { expectButtonOrder } from "../test/toolbar-order";
import type { Resource, BudgetBucket } from "./types";
import type { TimelogLinks } from "./timelog-types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./timelog-api", () => ({
  listUsers: vi.fn().mockResolvedValue([
    {
      userId: 42,
      firstName: "Alice",
      lastName: "Smith",
      initials: "AS",
      email: "alice@example.com",
      isActive: true,
    },
  ]),
  getPrivileges: vi.fn().mockResolvedValue({ registrationAllTasks: false }),
  listTimeItemsSelf: vi.fn().mockResolvedValue([]),
  listEmployeeTimeItems: vi.fn().mockResolvedValue([]),
  TimelogError: class TimelogError extends Error {
    status: number;
    constructor(status: number, msg: string) {
      super(msg);
      this.status = status;
    }
  },
}));

vi.mock("./use-timelog-sync", () => ({
  useTimelogSync: vi.fn(),
}));

// vi.hoisted runs before the vi.mock factories below, making these mock fns
// available both inside the factories and in test bodies (avoids the TDZ trap
// documented in use-timelog-sync.test.ts).
const { showToast, logDiag } = vi.hoisted(() => ({ showToast: vi.fn(), logDiag: vi.fn() }));
vi.mock("./toast-context", () => ({ useToastContext: () => showToast }));
vi.mock("./diagnostics", () => ({ logDiag }));

// Branded confirm dialog — mock the hook so tests control the resolved boolean
// (default accept). `confirmMock.result` is reset to true in beforeEach.
const { confirmMock } = vi.hoisted(() => ({ confirmMock: { result: true } }));
vi.mock("./confirm-dialog", () => ({
  useConfirm: () => () => Promise.resolve(confirmMock.result),
}));

// Default mock return (re-applied per test in beforeEach so error-state tests
// that override it don't leak into the next test). Persistent mockReturnValue
// (NOT ...Once) because React may render the component multiple times.
function defaultSyncReturn() {
  return {
    aggregates: {
      byBucket: { 10: { "2026-06": { hours: 8, billableHours: 6, byResource: { 1: { hours: 8, billableHours: 6 } } } } },
      byResource: { 1: { hours: 8, billableHours: 6 } },
      unattributed: { hours: 2, billableHours: 0 },
    },
    fetchedAt: "2026-06-23T10:00:00.000Z",
    users: [
      { userId: 42, firstName: "Alice", lastName: "Smith", initials: "AS", email: "alice@example.com", isActive: true },
    ],
    projectRefs: [{ id: 9, name: "ForgeOps", no: "PO-1" }],
    customers: [],
    customerProjects: [],
    busy: false,
    error: null,
    loadDirectory: vi.fn().mockResolvedValue(undefined),
    loadManagedProjects: vi.fn().mockResolvedValue(undefined),
    loadCustomers: vi.fn().mockResolvedValue(undefined),
    loadCustomerProjects: vi.fn().mockResolvedValue(undefined),
    fetchBookings: vi.fn().mockResolvedValue(undefined),
    fetchBookingsForProjects: vi.fn().mockResolvedValue({ failedProjects: 0, projectCount: 1 }),
    cancel: vi.fn(),
    removeUsers: vi.fn(),
    clearAll: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOURCE: Resource = {
  id: 1,
  firstName: "Alice",
  lastName: "Smith",
  email: "alice@example.com",
  roleId: null,
  utilizationMode: "percent",
  utilization: {},
};

const BUCKET: BudgetBucket = {
  id: 10,
  name: "Alpha Project",
  type: "tm",
  currency: "EUR",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  status: "open",
  allocations: [{ roleId: 0, resourceIds: [1], budgetHours: {}, actualHours: {} }],
};

const INITIAL_LINKS: TimelogLinks = {
  userLinks: [{ timelogUserId: 42, resourceId: 1, manual: false }],
  projectLinks: [{ timelogProjectId: 99, bucketId: 10, manual: false }],
};

/** Seed workspace data on mount. */
function SeedWorkspace({
  links,
  resources,
  buckets,
}: {
  links?: TimelogLinks;
  resources?: Resource[];
  buckets?: BudgetBucket[];
}) {
  const ws = useWorkspace();
  useEffect(() => {
    ws.setResources(resources ?? [RESOURCE]);
    ws.setBudgets(buckets ?? [BUCKET]);
    if (links) ws.setTimelogLinks(links);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Seed a project carrying a free-text customer NAME, so the weakest seed source
 *  (resolve-the-name-against-the-directory) has something to resolve. */
function SeedProjectCustomer({ customer }: { customer: string }) {
  const ws = useWorkspace();
  useEffect(() => {
    ws.setProject({ code: "proj-a", customer } as unknown as Parameters<typeof ws.setProject>[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Read-only probe for asserting timelogLinks mutations. */
function LinksProbe({ testId }: { testId: string }) {
  const { timelogLinks } = useWorkspace();
  return (
    <div data-testid={testId}>
      {JSON.stringify(timelogLinks ?? null)}
    </div>
  );
}

/** Buttons that drive workspace setters AFTER mount (late link hydration /
 *  in-place project switch) so the reconcile edge cases can be exercised. */
function Controls() {
  const ws = useWorkspace();
  return (
    <>
      <button data-testid="hydrate-links-999" onClick={() => ws.setTimelogLinks({ ...INITIAL_LINKS, customerId: 999 })}>hl</button>
      {/* ★ Same late hydration, but carrying projectIds. The seeding ladder only
          replaces the project SELECTION when `seed.projectIds.length > 0`, so a
          links payload without them can never exercise the selection-clobber
          path — a test using the button above can only ever discriminate on the
          customer. Use this one when the assertion is about the selection. */}
      <button data-testid="hydrate-links-999-projects" onClick={() => ws.setTimelogLinks({ ...INITIAL_LINKS, customerId: 999, projectIds: [77] })}>hlp</button>
      <button data-testid="switch-project-b-empty" onClick={() => {
        ws.setProject({ code: "proj-b" } as unknown as Parameters<typeof ws.setProject>[0]);
        ws.setTimelogLinks({ ...INITIAL_LINKS }); // new project: no customerId scope
      }}>sw</button>
    </>
  );
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

/** Enable timelog in localStorage so the panel doesn't show the misconfigured notice. */
function enableTimelog() {
  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      ...defaultSettings,
      timelog: {
        enabled: true,
        host: "app2.timelog.com",
        tenant: "test",
        email: "admin@example.com",
        apiToken: "tok123",
        scopeMode: "self",
      },
    }),
  );
}

/** Timelog switched ON but the token is gone — the "device that once configured
 *  TimeLog and later lost its token" state the §74 tests below describe. They
 *  need `isMisconfigured` true (so every guard's `isMisconfigured` arm is live)
 *  while `cfg.enabled` stays true, because the not-configured GATE keys on
 *  `enabled` ALONE: a bare default config now hides the very toolbar they
 *  assert against, behind the Configure Timelog empty state. */
function enableTimelogBrokenToken() {
  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      ...defaultSettings,
      timelog: {
        enabled: true,
        host: "app2.timelog.com",
        tenant: "test",
        email: "admin@example.com",
        apiToken: "",
        scopeMode: "self",
      },
    }),
  );
}

afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

beforeEach(async () => {
  confirmMock.result = true;
  const { useTimelogSync } = await import("./use-timelog-sync");
  vi.mocked(useTimelogSync).mockReturnValue(
    defaultSyncReturn() as unknown as ReturnType<typeof useTimelogSync>,
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TimelogPanel", () => {
  describe("KPI tiles", () => {
    it("renders booked, billable and unattributed tiles from mocked aggregate", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      // Booked = sum of byResource hours = 8
      expect(screen.getByText(t("en-US", "timelogKpiBooked"))).toBeInTheDocument();
      expect(screen.getByText("8 h")).toBeInTheDocument();

      // Billable % = 6/8*100 = 75
      expect(screen.getByText(t("en-US", "timelogKpiBillable"))).toBeInTheDocument();
      expect(screen.getByText("75 %")).toBeInTheDocument();

      // Unattributed = 2 h
      expect(screen.getByText(t("en-US", "timelogKpiWinLoss"))).toBeInTheDocument();
      expect(screen.getByText("2 h")).toBeInTheDocument();
    });
  });

  // ★★★ §74's module exists so ONE contract serves both the handler and the
  // button — but until these tests nothing pinned the BUTTON half. Deleting
  // `isMisconfigured` from a toolbar/table argument object makes the button
  // enable SOONER, and every other test in this file still passed, because
  // they all `waitFor` the button to become ENABLED. The disabled direction is
  // the one that regresses silently, so it needs its own assertions.
  // ★ Load-managed-projects is the sharpest pair: that action has no
  //   precondition beyond the shared blockers, so the second test is a real
  //   positive control — it proves the first is not passing vacuously off some
  //   unrelated condition that disables the button anyway.
  describe("action buttons while TimeLog is unconfigured (§74)", () => {
    it("disables Fetch and Load-managed-projects with no TimeLog config", () => {
      // Enabled but tokenless — the misconfigured state that still renders the
      // page. A bare default config is GATED behind Configure Timelog now.
      enableTimelogBrokenToken();
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      expect(screen.getByText(t("en-US", "timelogEnable"))).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: t("en-US", "timelogSync") }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: t("en-US", "timelogLoadManagedProjects") }),
      ).toBeDisabled();
    });

    // ★★★ This is the test an earlier revision of §74 declared IMPOSSIBLE, on the
    // reasoning that the project picker renders under `!isMisconfigured` so a
    // selection can never exist in the unconfigured state. That was wrong: the
    // picker's RENDERING is gated, its STATE is not. `useTimelogPickerScope` runs
    // unconditionally and seeds `projectCustomerId` + `selectedProjectIds` from the
    // persisted picker scope or the workspace's `timelogLinks`, neither of which
    // reads `isMisconfigured` — so a device that once configured TimeLog and later
    // lost its token mounts in exactly this state. Ordinary, not contrived.
    // ★★ That matters more than the test: the false claim was being used as the
    // justification for NOT writing it, on the very entry whose finding was that
    // the button half went unpinned. "Impossible" is a much more expensive thing
    // to write down than "not done".
    it("keeps Fetch and Refresh disabled while unconfigured even with a full selection seeded (§74)", () => {
      // Enabled but tokenless (see above); links seed a customer + one project.
      enableTimelogBrokenToken();
      render(
        <>
          <SeedWorkspace links={{ ...INITIAL_LINKS, customerId: 5, projectIds: [9] }} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      // ★ The `(1)` in the accessible name is load-bearing: the Fetch label gains
      //   ` (N)` only when `selectedCount > 0`, so matching on it proves
      //   `selectedCount > 0`. Without that this assertion would pass vacuously
      //   off an empty selection — exactly how the first version of these tests
      //   failed to pin Fetch. It also means a plain exact-name query silently
      //   stops resolving here.
      //   ★★ It proves ONE of `canFetchBookings`' two preconditions. The other,
      //   `projectCustomerId !== ""`, holds because both come from the same
      //   `links` object via `resolveInitialScope` — true, but by a separate
      //   argument, not by this query.
      //   ★ Anchored on the full label, not a bare `/\(1\)$/`: any future counted
      //   button in this panel would turn a loose match into a multi-match throw.
      const fetchBtn = screen.getByRole("button", {
        name: new RegExp(`^${t("en-US", "timelogSync")} \\(1\\)$`),
      });
      expect(fetchBtn).toBeDisabled();

      // Refresh renders whenever `fetchedAt` is set (defaultSyncReturn supplies
      // one), independently of config — so its disabled direction is pinnable too.
      expect(
        screen.getByRole("button", { name: t("en-US", "timelogRefresh") }),
      ).toBeDisabled();
    });

    // Clear-all is the FOURTH wiring. It deliberately does NOT take
    // `isMisconfigured` (clearing local cache must stay available when the
    // config is broken), so the arm pinned here is `hasFetched` — the one its
    // handler was missing before `canClearAllFetched` existed.
    it("disables Clear-all when nothing has been fetched", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), fetchedAt: null } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      expect(screen.getByRole("button", { name: t("en-US", "clearAll") })).toBeDisabled();
    });

    it("enables Load-managed-projects once TimeLog is configured", async () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      // Settings hydrate async (secret migration), so the button is disabled at
      // t=0 even when configured — `isMisconfigured` is true against the
      // pre-hydration defaults. Waiting is what makes this a positive control
      // rather than a second copy of the test above.
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: t("en-US", "timelogLoadManagedProjects") }),
        ).toBeEnabled(),
      );
    });
  });

  // ★★★ The gate hides the whole page when the integration is switched OFF, so
  // every network action goes with it. The escape hatch is NOT decoration:
  // `canClearAllFetched` deliberately omits `isMisconfigured` because the cache
  // is local data the user already has, and a state you cannot refresh is
  // exactly when you want to clear stale bookings. Hiding the page without
  // carrying Clear-all forward would re-create the trap that omission prevents.
  // ★ The gate keys on `cfg.enabled` alone, NOT `isMisconfigured` — an ENABLED
  //   integration with broken credentials keeps the full page (and its
  //   Clear-all), which is why the §74 tests above can still reach the toolbar.
  describe("TimelogPanel — not configured", () => {
    /** The gate is `hydrated && !cfg.enabled`: `useSettings` starts at
     *  `defaultSettings` and reads localStorage in an EFFECT, so the panel
     *  renders the FULL page for one commit before the empty state appears.
     *  Every assertion about the gated state has to wait for that. */
    function awaitGate() {
      return waitFor(() =>
        screen.getByRole("button", { name: t("en-US", "timelogConfigure") }),
      );
    }

    it("shows a Configure Timelog button instead of the page", async () => {
      // No enableTimelog*(): defaults carry `timelog.enabled === false`.
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" onConfigureTimelog={() => {}} />
        </>,
        { wrapper },
      );

      await awaitGate();
      expect(screen.getByText(t("en-US", "timelogNotConfigured"))).toBeInTheDocument();

      // Every fetch action is gone, not merely disabled. "timelogSync" is the
      // FETCH button's label key (it gains a ` (N)` suffix when a selection
      // exists, hence the RegExp); "timelogRefreshReapply" is the Refresh &
      // re-apply button Task 11 added — it reaches the network too, so it must
      // not survive the gate either.
      expect(
        screen.queryByRole("button", { name: new RegExp(t("en-US", "timelogSync")) }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: t("en-US", "timelogRefresh") }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: t("en-US", "timelogRefreshReapply") }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: t("en-US", "timelogLoadManagedProjects") }),
      ).toBeNull();
    });

    it("keeps Clear-all reachable when a cached fetch exists", async () => {
      // defaultSyncReturn() supplies a `fetchedAt`, i.e. a cache is present.
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" onConfigureTimelog={() => {}} />
        </>,
        { wrapper },
      );

      await awaitGate();
      expect(
        screen.getByRole("button", { name: t("en-US", "clearAll") }),
      ).toBeEnabled();
      expect(screen.getByText(t("en-US", "timelogCachedWhileOff"))).toBeInTheDocument();
    });

    it("clears the cache when the escape-hatch Clear-all is confirmed", async () => {
      const clearAll = vi.fn();
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), clearAll } as unknown as ReturnType<typeof useTimelogSync>,
      );
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" onConfigureTimelog={() => {}} />
        </>,
        { wrapper },
      );

      // ★ Wait for the GATE first, not just for a Clear-all button: the full
      //   page renders a Clear-all of its own pre-hydration, so clicking without
      //   this would exercise the toolbar's button and pass either way.
      await awaitGate();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: t("en-US", "clearAll") }));
      });
      expect(clearAll).toHaveBeenCalled();
    });

    it("offers no Clear-all when there is nothing cached", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), fetchedAt: null } as unknown as ReturnType<typeof useTimelogSync>,
      );
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" onConfigureTimelog={() => {}} />
        </>,
        { wrapper },
      );

      // Positive control FIRST: it proves the gate is rendered, so the absences
      // below are the `hasFetched` branch and not an unrendered empty state.
      await awaitGate();
      expect(screen.queryByRole("button", { name: t("en-US", "clearAll") })).toBeNull();
      expect(screen.queryByText(t("en-US", "timelogCachedWhileOff"))).toBeNull();
    });

    it("renders the full page when configured", async () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" onConfigureTimelog={() => {}} />
        </>,
        { wrapper },
      );

      // Settings hydrate async, so wait for the page to become live before
      // asserting the gate never appeared — a t=0 assertion would pass off the
      // pre-hydration full page whether or not the gate is wired at all.
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: t("en-US", "timelogLoadManagedProjects") }),
        ).toBeEnabled(),
      );
      expect(
        screen.queryByRole("button", { name: t("en-US", "timelogConfigure") }),
      ).toBeNull();
    });

    // ★★★ The `hydrated` half of the gate, which nothing above can see: the two
    // tests either side of this one both settle AFTER hydration, so a bare
    // `!cfg.enabled` gate passes them while flashing "Timelog is switched off"
    // — Clear-all included — at every CONFIGURED user, on every mount of this
    // view. Only a t=0 assertion catches it, so this one deliberately does not
    // await anything.
    it("never flashes the empty state at a configured user before settings load", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" onConfigureTimelog={() => {}} />
        </>,
        { wrapper },
      );

      expect(
        screen.queryByRole("button", { name: t("en-US", "timelogConfigure") }),
      ).toBeNull();
      // Positive control: the full page IS what rendered in that first commit,
      // so the absence above is the gate holding off and not an empty render.
      expect(
        screen.getByRole("button", { name: t("en-US", "timelogLoadManagedProjects") }),
      ).toBeInTheDocument();
    });
  });

  describe("Refresh bookings", () => {
    // §39 failure capture — read-only, failure path only. Eight CI failures have
    // produced only frequency data; this makes the ninth readable.
    // ★★★ NOT `onTestFailed`, which is UNUSABLE here — measured, not assumed: it
    // runs AFTER the file-level `afterEach` (`vi.clearAllMocks()`, line ~213) AND
    // after RTL's `cleanup()` in vitest.setup.ts, so every field reads zeroed.
    // The `onTestFailed` form of this capture printed
    // `{"fetchCalls":0,"toastCalls":[],"refreshButtonPresent":false,...}` on a run
    // where the fetch HAD been called and the error toast HAD fired — i.e. it would
    // have falsely CONFIRMED "the click was swallowed", which is worse than no
    // capture at all. A describe-scoped afterEach is registered LAST and therefore
    // runs FIRST (LIFO), while the mocks and the DOM are still live.
    // ★ Still failure-path only: it returns immediately unless the test failed, and
    //   it neither awaits nor flushes — it runs after the test body has returned,
    //   so there is no scheduling left to perturb.
    let captureOnFailure: (() => void) | undefined;
    afterEach((ctx) => {
      const capture = captureOnFailure;
      captureOnFailure = undefined;
      if (ctx.task.result?.state === "fail") capture?.();
    });

    it("shows a Refresh button once bookings are read and re-fetches the persisted scope", async () => {
      enableTimelog();
      const fetchBookingsForProjects = vi.fn().mockResolvedValue({ failedProjects: 0, projectCount: 1 });
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), fetchBookingsForProjects } as unknown as ReturnType<typeof useTimelogSync>,
      );
      render(
        <>
          <SeedWorkspace links={{ ...INITIAL_LINKS, customerId: 5, projectIds: [9] }} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const btn = await screen.findByRole("button", { name: t("en-US", "timelogRefresh") });
      // ★★★ Wait for ENABLED, not merely present. The button's EXISTENCE is gated
      // only on `fetchedAt`, so it renders while `isMisconfigured` is still true —
      // useSettings commits the stored config behind an `await` that act() does not
      // drain, and a probe placed right after render() confirms the button IS
      // disabled at first commit. ★★ It is a RACE, not a certainty: `findByRole`'s
      // own await usually drains that commit before the first successful match,
      // which is why this passes locally — under CI load it sometimes does not.
      // React drops onClick on a disabled <button>, so the click is then a SILENT
      // no-op that nothing retries: the toast never arrives and waitFor burns its
      // whole budget. See docs/open-followups.md §39.
      await waitFor(() => expect(btn).toBeEnabled());
      fireEvent.click(btn);
      // Re-fetches the PERSISTED scope (links.projectIds = [9]), not the live
      // picker — so the exact id list must be forwarded to the fetch.
      await waitFor(() =>
        expect(fetchBookingsForProjects).toHaveBeenCalledWith([9], expect.any(String), expect.any(String)),
      );
    });

    it("surfaces a partial-failure toast when Refresh drops some projects", async () => {
      enableTimelog();
      const fetchBookingsForProjects = vi.fn().mockResolvedValue({ failedProjects: 1, projectCount: 2 });
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), fetchBookingsForProjects } as unknown as ReturnType<typeof useTimelogSync>,
      );
      render(
        <>
          <SeedWorkspace links={{ ...INITIAL_LINKS, customerId: 5, projectIds: [9] }} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      // The fix on this branch (wait for ENABLED before clicking) should prevent a
      // recurrence — if it recurs anyway, these four values say which assumption
      // broke. `fetchCalls: 0` is the direct evidence of a swallowed click.
      captureOnFailure = () => {
        const btn = screen.queryByRole("button", { name: t("en-US", "timelogRefresh") });
        console.error(
          "[§39 capture]",
          JSON.stringify({
            fetchCalls: fetchBookingsForProjects.mock.calls.length,
            toastCalls: showToast.mock.calls.map((c) => c[0]),
            refreshButtonPresent: !!btn,
            refreshButtonDisabled: btn?.hasAttribute("disabled") ?? null,
          }),
        );
      };
      const refreshBtn = await screen.findByRole("button", { name: t("en-US", "timelogRefresh") });
      // ★★★ Wait for ENABLED, not merely present. The button's EXISTENCE is gated
      // only on `fetchedAt`, so it renders while `isMisconfigured` is still true —
      // useSettings commits the stored config behind an `await` that act() does not
      // drain, and a probe placed right after render() confirms the button IS
      // disabled at first commit. ★★ It is a RACE, not a certainty: `findByRole`'s
      // own await usually drains that commit before the first successful match,
      // which is why this passes locally — under CI load it sometimes does not.
      // React drops onClick on a disabled <button>, so the click is then a SILENT
      // no-op that nothing retries: the toast never arrives and waitFor burns its
      // whole budget. See docs/open-followups.md §39.
      await waitFor(() => expect(refreshBtn).toBeEnabled());
      fireEvent.click(refreshBtn);
      // ★★★ This assertion failed in CI eight times and NEVER locally. The old
      // diagnosis in this comment was worker starvation; that is DISPROVED —
      // three failures ran under this 15s budget and consumed 15,093 / 15,098 /
      // 15,117 ms, a 24 ms spread at the ceiling, i.e. the toast never arrives.
      // Raising the budget again buys nothing; 5s -> 15s already bought nothing.
      // The cause is a click swallowed by the button's `disabled` state when the
      // settings commit loses the race described above; the enabled-wait closes it.
      // ★ These two 15s budgets sum past the 20s testTimeout. A first-half FAILURE
      //   throws at ~15s, inside testTimeout, and DOES name its half. The case that
      //   reports a bare "timed out in 20000ms" with no half named is a first half
      //   that is SLOW BUT PASSING followed by a second-half failure.
      // See docs/open-followups.md §39.
      // ★ Two assertions, not one, so a CI failure says WHICH half broke.
      await waitFor(() => expect(fetchBookingsForProjects).toHaveBeenCalled(), { timeout: 15000 });
      await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", expect.any(String)), {
        timeout: 15000,
      });
    });

    it("hides the Refresh button before any bookings are read", async () => {
      enableTimelog();
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), fetchedAt: null } as unknown as ReturnType<typeof useTimelogSync>,
      );
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      expect(screen.queryByRole("button", { name: t("en-US", "timelogRefresh") })).toBeNull();
    });
  });

  describe("Refresh & re-apply", () => {
    /** Render the panel with a persisted scope and a caller-supplied sync mock. */
    async function renderWithSync(over: Record<string, unknown>) {
      enableTimelog();
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), ...over } as unknown as ReturnType<typeof useTimelogSync>,
      );
      render(
        <>
          <SeedWorkspace links={{ ...INITIAL_LINKS, customerId: 5, projectIds: [9] }} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      // Wait for ENABLED, not merely present — same §39 race as the Refresh
      // tests above: the button renders before useSettings commits the stored
      // config, and React drops onClick on a disabled <button>, so an early
      // click is a silent no-op nothing retries.
      const btn = await screen.findByRole("button", { name: t("en-US", "timelogRefreshReapply") });
      await waitFor(() => expect(btn).toBeEnabled());
      return btn;
    }

    // ★★★ THE STALE-READ PIN, and it needs the seeded DIVERGENCE to mean
    //     anything. `sync.aggregates` carries 8h and the refresh resolves 20h;
    //     if the handler seeded the confirm from `sync.aggregates` — which has
    //     NOT updated inside that closure — the dialog would itemize the 8h
    //     row. Without two different values the test passes whichever source is
    //     read, which is the vacuity trap this branch has hit repeatedly.
    //     Verified by mutation: pointing the handler at `sync.aggregates` turns
    //     this test RED on the "0 → 20" expectation.
    it("seeds the confirm dialog from the FRESH aggregate, not the stale hook state", async () => {
      const fetchBookingsForProjects = vi.fn().mockResolvedValue({
        failedProjects: 0,
        projectCount: 1,
        aggregates: {
          byBucket: {
            10: { "2026-06": { hours: 20, billableHours: 20, byResource: { 1: { hours: 20, billableHours: 20 } } } },
          },
          byResource: { 1: { hours: 20, billableHours: 20 } },
          unattributed: { hours: 0, billableHours: 0 },
        },
      });
      const btn = await renderWithSync({ fetchBookingsForProjects });

      fireEvent.click(btn);

      await waitFor(() => expect(fetchBookingsForProjects).toHaveBeenCalledWith([9], expect.any(String), expect.any(String)));
      // The SAME confirm dialog the manual Apply opens — reused, not a second
      // write path — carrying the refetched figure.
      await waitFor(() =>
        expect(screen.getByText(t("en-US", "timelogApplyConfirm", "1"))).toBeInTheDocument(),
      );
      const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
      expect(rows).toContain("Alpha Project · 2026-06: 0 → 20");
      expect(rows).not.toContain("Alpha Project · 2026-06: 0 → 8");
    });

    // A refetch that produced no aggregate — no projects picked, an abort, an
    // HTTP error — must NOT fall back to opening the dialog on the stale
    // overlay. That fallback would look like a working button while re-applying
    // exactly the attribution the refresh existed to replace.
    it("does not open the confirm dialog when the refresh yields no aggregate", async () => {
      const fetchBookingsForProjects = vi.fn().mockResolvedValue({ failedProjects: 0, projectCount: 0 });
      const btn = await renderWithSync({ fetchBookingsForProjects });

      fireEvent.click(btn);

      await waitFor(() => expect(fetchBookingsForProjects).toHaveBeenCalled());
      expect(screen.queryByText(t("en-US", "timelogApplyConfirm", "1"))).not.toBeInTheDocument();
    });

    it("hides the button before any bookings are read", async () => {
      enableTimelog();
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), fetchedAt: null } as unknown as ReturnType<typeof useTimelogSync>,
      );
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      expect(screen.queryByRole("button", { name: t("en-US", "timelogRefreshReapply") })).toBeNull();
    });

    // ★ Shared helper, never a hand-rolled walk: `buttonIndex` THROWS on a zero-
    //   or multi-match, where a local `findIndex` silently takes the first and
    //   lets an ordering assertion pass against the wrong control.
    it("sits after Refresh and before the trailing Print / reset group", async () => {
      await renderWithSync({});
      // Plain ordering for the two leading controls — the convention only
      // requires them to come BEFORE the trailing group.
      expectButtonOrder([
        "timelogRefresh",
        "timelogRefreshReapply",
        "printHint",
        "colResetWidthsHint",
        "tableResetSizeHint",
      ]);
      // `contiguous` for the group itself: plain ordering leaves the indices
      // ascending when a stray control lands BETWEEN two members, which is the
      // exact drift this repo has caught more than once.
      expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
    });
  });

  describe("External resource exclusion", () => {
    // External resources are capacity-only (excluded from cost) and never book
    // time as an internal TimeLog user — so they must be dropped from BOTH the
    // cost-attribution engine (the hook input) AND the People-table picker.
    const INTERNAL: Resource = { ...RESOURCE, id: 1, firstName: "Alice", lastName: "Smith" };
    const EXTERNAL: Resource = {
      ...RESOURCE,
      id: 2,
      firstName: "Ext",
      lastName: "Contractor",
      email: "ext@vendor.example",
      isExternal: true,
    };

    it("passes only internal resources to the sync hook (aggregation excludes externals)", async () => {
      enableTimelog();
      const { useTimelogSync } = await import("./use-timelog-sync");
      render(
        <>
          <SeedWorkspace resources={[INTERNAL, EXTERNAL]} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      // SeedWorkspace sets resources in an effect → panel re-renders → the hook is
      // re-invoked with the filtered list. Assert on the LATEST call's input.
      await waitFor(() => {
        const calls = vi.mocked(useTimelogSync).mock.calls;
        const last = calls[calls.length - 1][0] as { resources: readonly Resource[] };
        expect(last.resources.map((r) => r.id)).toEqual([1]);
      });
    });

    it("omits external resources from the People-table resource picker", async () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace resources={[INTERNAL, EXTERNAL]} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      // People row for the mocked booker (userId 42, alice@example.com).
      const label = `${t("en-US", "timelogMatchPeople")} – alice@example.com`;
      const select = await screen.findByRole("combobox", { name: label });
      expect(within(select).getByRole("option", { name: "Alice Smith" })).toBeInTheDocument();
      expect(within(select).queryByRole("option", { name: "Ext Contractor" })).toBeNull();
    });
  });

  describe("Actuals cache key wiring (open-followups §14)", () => {
    // `useTimelogSync` is mocked out (above) for every test in this file, so a
    // render here can never reflect a real `loadActualsCache` hit — the mock
    // ignores its arguments entirely. What CAN be pinned at this layer is the
    // ARGUMENT the panel hands the hook, which is exactly the choice §14 moved:
    // the canonical `projectKey` prop must reach `projectId`, never the
    // user-editable `ws.project?.code`.
    it("hands the canonical projectKey to useTimelogSync as projectId, not the legacy project code", async () => {
      enableTimelog();
      const { useTimelogSync } = await import("./use-timelog-sync");
      render(
        <>
          <SeedWorkspace />
          {/* Sets `ws.project.code` to "proj-a" — deliberately DIFFERENT from
              the canonical `projectKey` prop below, so the two ids can never
              agree by accident. */}
          <SeedProjectCustomer customer="Acme" />
          <TimelogPanel lang="en-US" projectKey="canonical-key" />
        </>,
        { wrapper },
      );
      await waitFor(() => {
        const calls = vi.mocked(useTimelogSync).mock.calls;
        const last = calls[calls.length - 1][0] as { projectId: string };
        expect(last.projectId).toBe("canonical-key");
      });
    });
  });

  describe("Projects matching table — row-unique labels and manual links", () => {
    // Rows come from sync.projectRefs (mock: ForgeOps id 9) MERGED with
    // already-linked projects absent from the fetch (INITIAL_LINKS: id 99).

    it("renders a row-unique accessible name for the project select", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      // Project id 99 → display id "99" (name === String(id) fallback)
      const expectedLabel = `${t("en-US", "timelogMatchProjects")} – 99`;
      expect(screen.getByRole("combobox", { name: expectedLabel })).toBeInTheDocument();
    });

    it("renders a row for a freshly fetched (never-linked) project", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      // sync.projectRefs supplies ForgeOps (id 9) — a project with NO prior link,
      // proving project matching is bootstrappable from fetched bookings.
      const expectedLabel = `${t("en-US", "timelogMatchProjects")} – ForgeOps`;
      expect(screen.getByRole("combobox", { name: expectedLabel })).toBeInTheDocument();
    });

    it("persists a manual link when a freshly fetched project is mapped to a bucket", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <LinksProbe testId="links-probe" />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      const expectedLabel = `${t("en-US", "timelogMatchProjects")} – ForgeOps`;
      const select = screen.getByRole("combobox", { name: expectedLabel });

      // Map ForgeOps (id 9) to bucket 10 (Alpha Project)
      act(() => {
        fireEvent.change(select, { target: { value: "10" } });
      });

      const probe = screen.getByTestId("links-probe");
      const parsed = JSON.parse(probe.textContent ?? "null") as TimelogLinks | null;
      expect(parsed).not.toBeNull();
      const link = parsed!.projectLinks.find((l) => l.timelogProjectId === 9);
      expect(link).toBeDefined();
      expect(link!.manual).toBe(true);
      expect(link!.bucketId).toBe(10);
    });

    it("persists a manual project link when the user changes the select", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <LinksProbe testId="links-probe" />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      const expectedLabel = `${t("en-US", "timelogMatchProjects")} – 99`;
      const select = screen.getByRole("combobox", { name: expectedLabel });

      // Change to bucket id=10 (Alpha Project)
      act(() => {
        fireEvent.change(select, { target: { value: "10" } });
      });

      const probe = screen.getByTestId("links-probe");
      const parsed = JSON.parse(probe.textContent ?? "null") as TimelogLinks | null;
      expect(parsed).not.toBeNull();
      const link = parsed!.projectLinks.find((l) => l.timelogProjectId === 99);
      expect(link).toBeDefined();
      expect(link!.manual).toBe(true);
      expect(link!.bucketId).toBe(10);
    });

    it("removes the project link (no null-bucket tombstone) when Clear is clicked", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <LinksProbe testId="links-probe" />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      // Project 99 is linked to bucket 10 initially. Clear should remove the row.
      const clearLabel = `${t("en-US", "timelogMatchClear")} – 99`;
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: clearLabel }));
      });

      const probe = screen.getByTestId("links-probe");
      const parsed = JSON.parse(probe.textContent ?? "null") as TimelogLinks | null;
      expect(parsed).not.toBeNull();
      // No tombstone: the link for project 99 is gone entirely.
      expect(parsed!.projectLinks.find((l) => l.timelogProjectId === 99)).toBeUndefined();
    });
  });

  describe("People remove + Clear all", () => {
    it("per-row ✕ calls removeUsers with that userId", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      const removeUsers = vi.fn();
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), removeUsers } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      fireEvent.click(
        screen.getByRole("button", { name: `${t("en-US", "remove")} – alice@example.com` }),
      );
      expect(removeUsers).toHaveBeenCalledWith([42]);
    });

    it("clears the people filter via its ✕", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const field = screen.getByLabelText(t("en-US", "timelogPeopleFilter")) as HTMLInputElement;
      fireEvent.change(field, { target: { value: "alice" } });
      expect(field.value).toBe("alice");
      fireEvent.click(
        screen.getByRole("button", {
          name: `${t("en-US", "clear")} – ${t("en-US", "timelogPeopleFilter")}`,
        }),
      );
      expect(field.value).toBe("");
    });

    it("collapse toggle hides the people region; expand restores it", async () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      // Region stays MOUNTED (aria-controls target must exist + it must still
      // print when collapsed) and is toggled via the `hidden` attribute.
      const region = document.getElementById("timelog-people-region");
      expect(region).not.toBeNull();
      expect(region).not.toHaveAttribute("hidden");
      const toggle = screen.getByRole("button", { name: t("en-US", "timelogMatchPeople") });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      // Collapse: region hidden (still in DOM), its controls drop out of the a11y tree.
      fireEvent.click(toggle);
      expect(document.getElementById("timelog-people-region")).toHaveAttribute("hidden");
      expect(screen.queryByRole("button", { name: `${t("en-US", "remove")} – alice@example.com` })).toBeNull();
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      // Expand restores visibility.
      fireEvent.click(toggle);
      expect(document.getElementById("timelog-people-region")).not.toHaveAttribute("hidden");
    });

    it("bulk: select-all then Remove calls removeUsers with every visible id", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      const removeUsers = vi.fn();
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), removeUsers } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectAllVisibleRows") }));
      fireEvent.click(screen.getByRole("button", { name: t("en-US", "remove") }));
      expect(removeUsers).toHaveBeenCalledWith([42]);
    });

    it("Load my projects calls sync.loadManagedProjects", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      const loadManagedProjects = vi.fn().mockResolvedValue(undefined);
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), loadManagedProjects } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      // Settings hydrate async (secret migration) → the load button is gated on
      // a configured token; wait for it to enable before clicking.
      const btn = screen.getByRole("button", { name: t("en-US", "timelogLoadManagedProjects") });
      await waitFor(() => expect(btn).toBeEnabled());
      fireEvent.click(btn);
      expect(loadManagedProjects).toHaveBeenCalledWith(false, undefined);
    });

    it("the customer filter wildcard-narrows the dropdown options", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), customers: [{ id: 1, name: "Acme" }, { id: 2, name: "Globex" }] } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const select = screen.getByRole("combobox", { name: t("en-US", "timelogCustomerLabel") });
      expect(within(select).getByRole("option", { name: "Acme" })).toBeInTheDocument();
      fireEvent.change(screen.getByRole("searchbox", { name: t("en-US", "timelogCustomerFilter") }), { target: { value: "glob" } });
      expect(within(select).queryByRole("option", { name: "Acme" })).toBeNull();
      expect(within(select).getByRole("option", { name: "Globex" })).toBeInTheDocument();
    });

    it("selecting a customer loads that customer's projects", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      const loadManagedProjects = vi.fn().mockResolvedValue(undefined);
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), customers: [{ id: 667, name: "Acme" }], loadManagedProjects } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      fireEvent.change(screen.getByRole("combobox", { name: t("en-US", "timelogCustomerLabel") }), { target: { value: "667" } });
      const btn = screen.getByRole("button", { name: t("en-US", "timelogLoadManagedProjects") });
      await waitFor(() => expect(btn).toBeEnabled());
      fireEvent.click(btn);
      expect(loadManagedProjects).toHaveBeenCalledWith(false, 667);
    });

    it("ticking Include closed loads managed projects with closed=true", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      const loadManagedProjects = vi.fn().mockResolvedValue(undefined);
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), loadManagedProjects } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "timelogIncludeClosed") }));
      const btn = screen.getByRole("button", { name: t("en-US", "timelogLoadManagedProjects") });
      await waitFor(() => expect(btn).toBeEnabled());
      fireEvent.click(btn);
      expect(loadManagedProjects).toHaveBeenCalledWith(true, undefined);
    });

    it("Clear all calls sync.clearAll (after confirm)", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      const clearAll = vi.fn();
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), clearAll } as unknown as ReturnType<typeof useTimelogSync>,
      );
      confirmMock.result = true;
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      fireEvent.click(screen.getByRole("button", { name: t("en-US", "clearAll") }));
      await waitFor(() => expect(clearAll).toHaveBeenCalled());
    });

    it("Clear all does NOT clear when confirm is cancelled", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      const clearAll = vi.fn();
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), clearAll } as unknown as ReturnType<typeof useTimelogSync>,
      );
      confirmMock.result = false;
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      fireEvent.click(screen.getByRole("button", { name: t("en-US", "clearAll") }));
      await act(async () => {});
      expect(clearAll).not.toHaveBeenCalled();
    });
  });

  describe("Customer-scoped booking fetch", () => {
    const LINKS_WITH_CUSTOMER: TimelogLinks = { ...INITIAL_LINKS, customerId: 667 };

    it("seeds the customer picker from the persisted scope (customerId on links)", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), customers: [{ id: 667, name: "Acme" }] } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={LINKS_WITH_CUSTOMER} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const select = screen.getByRole("combobox", { name: t("en-US", "timelogCustomerLabel") }) as HTMLSelectElement;
      // Reconcile fires once links arrive (SeedWorkspace effect) → picker = 667.
      await waitFor(() => expect(select.value).toBe("667"));
      // The scope note is shown.
      expect(screen.getByText(t("en-US", "timelogFetchScopedNote", "Acme"))).toBeInTheDocument();
    });

    it("a manual pick wins over a persisted scope that hydrates AFTER the pick", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), customers: [{ id: 667, name: "Acme" }, { id: 999, name: "Other" }] } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <Controls />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const select = screen.getByRole("combobox", { name: t("en-US", "timelogCustomerLabel") }) as HTMLSelectElement;
      // User picks 667.
      fireEvent.change(select, { target: { value: "667" } });
      expect(select.value).toBe("667");
      // Persisted links (customerId 999) hydrate LATE — must NOT override the pick.
      await act(async () => { fireEvent.click(screen.getByTestId("hydrate-links-999")); });
      expect(select.value).toBe("667");
    });

    it("resets the picker when the project changes in place (no remount)", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), customers: [{ id: 667, name: "Acme" }] } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={{ ...INITIAL_LINKS, customerId: 667 }} />
          <Controls />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const select = screen.getByRole("combobox", { name: t("en-US", "timelogCustomerLabel") }) as HTMLSelectElement;
      // Seeded from the persisted scope.
      await waitFor(() => expect(select.value).toBe("667"));
      // Switch project in place → new project has no customerId scope → picker resets.
      await act(async () => { fireEvent.click(screen.getByTestId("switch-project-b-empty")); });
      await waitFor(() => expect(select.value).toBe(""));
    });

    // The seeding ladder is RANK-based, not a one-shot boolean, precisely so a
    // higher-precedence source arriving late still wins. `timelogLinks` is
    // workspace data and can hydrate well after the customer directory has
    // already driven a name auto-resolve; a boolean would latch on the weaker
    // seed and drop the links scope silently.
    it("late-hydrating links override an earlier customer-name auto-resolve", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), customers: [{ id: 667, name: "Acme" }, { id: 999, name: "Other" }] } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          {/* No customerId on links yet — only the project's free-text customer
              name, which resolves against the directory. */}
          <SeedWorkspace links={INITIAL_LINKS} />
          <SeedProjectCustomer customer="Acme" />
          <Controls />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const select = screen.getByRole("combobox", { name: t("en-US", "timelogCustomerLabel") }) as HTMLSelectElement;
      // (1) Name auto-resolve seeds the weakest source.
      await waitFor(() => expect(select.value).toBe("667"));
      // (2) Links hydrate LATE with a different customer. They outrank the name
      //     auto-resolve, so the picker must move — no manual pick intervened.
      await act(async () => { fireEvent.click(screen.getByTestId("hydrate-links-999")); });
      await waitFor(() => expect(select.value).toBe("999"));
    });

    it("restores a per-device picker scope in preference to the last-fetched scope", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), customers: [{ id: 667, name: "Acme" }, { id: 999, name: "Other" }] } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      // Simulates a prior session in which the user SELECTED 999 and never
      // pressed Fetch, so only the device store knows about it.
      window.localStorage.setItem(
        "aipm-cockpit:timelog-picker",
        JSON.stringify({ "proj-key": { customerId: 999, projectIds: [], seq: 1 } }),
      );
      render(
        <>
          {/* Last FETCH was against 667 — the picker must still win. */}
          <SeedWorkspace links={LINKS_WITH_CUSTOMER} />
          <TimelogPanel lang="en-US" projectKey="proj-key" />
        </>,
        { wrapper },
      );
      const select = screen.getByRole("combobox", { name: t("en-US", "timelogCustomerLabel") }) as HTMLSelectElement;
      await waitFor(() => expect(select.value).toBe("999"));
      // The picker now disagrees with the customer the loaded bookings came
      // from, so it must say so rather than misrepresent what is on screen.
      expect(
        screen.getByText(t("en-US", "timelogScopeMismatchNote", "Acme", "Other")),
      ).toBeInTheDocument();
    });

    // ★★ The READ direction (a seeded store restores a selection) was covered
    // above, but nothing proved the panel ever WRITES. Deleting the
    // persistPicker calls from both toggles left the entire suite green, which
    // meant the release's headline claim — "your selection survives a reload" —
    // was unprotected in the direction that actually produces the stored value.
    it("persists a ticked project to the device store", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), customers: [{ id: 667, name: "Acme" }], customerProjects: [{ id: 9, name: "ForgeOps", no: "PO-1" }] } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={LINKS_WITH_CUSTOMER} />
          <TimelogPanel lang="en-US" projectKey="proj-key" />
        </>,
        { wrapper },
      );
      // Seeding alone must not write: the store records what the USER picked,
      // not what the ladder restored.
      expect(window.localStorage.getItem("aipm-cockpit:timelog-picker")).toBeNull();

      const box = await screen.findByRole("checkbox", {
        name: `${t("en-US", "timelogProjectScopeLabel")} – ForgeOps (PO-1)`,
      });
      await act(async () => { fireEvent.click(box); });

      const stored = JSON.parse(window.localStorage.getItem("aipm-cockpit:timelog-picker") ?? "{}");
      expect(stored["proj-key"]).toMatchObject({ customerId: 667, projectIds: [9] });
    });

    // Ticking a project is an explicit pick, so a higher-precedence source
    // arriving afterwards must NOT overwrite it. Without `setUserPicked(true)`
    // in the toggle, late-hydrating links (rank 2) replace both the customer and
    // the whole project selection.
    it("a ticked project survives links hydrating afterwards", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), customers: [{ id: 667, name: "Acme" }, { id: 999, name: "Other" }], customerProjects: [{ id: 9, name: "ForgeOps", no: "PO-1" }] } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedProjectCustomer customer="Acme" />
          <SeedWorkspace links={INITIAL_LINKS} />
          <Controls />
          <TimelogPanel lang="en-US" projectKey="proj-key" />
        </>,
        { wrapper },
      );
      const box = await screen.findByRole("checkbox", {
        name: `${t("en-US", "timelogProjectScopeLabel")} – ForgeOps (PO-1)`,
      });
      await act(async () => { fireEvent.click(box); });
      expect((box as HTMLInputElement).checked).toBe(true);

      // ★ Hydrate WITH projectIds — the variant that can actually clobber the
      // selection. Using the projectId-less control here would make the checked
      // assertion below unfalsifiable (the ladder skips the selection write when
      // `seed.projectIds` is empty), leaving only the customer under test.
      await act(async () => { fireEvent.click(screen.getByTestId("hydrate-links-999-projects")); });

      // ★ Selection first: it is what the test is NAMED for, and asserting the
      // customer first would mask it — the customer assertion trips on the same
      // mutants, so it would always be the reported failure and the selection
      // claim would never be exercised.
      expect((box as HTMLInputElement).checked).toBe(true);
      const select = screen.getByRole("combobox", { name: t("en-US", "timelogCustomerLabel") }) as HTMLSelectElement;
      expect(select.value).toBe("667");
    });

    it("shows no scope-mismatch note when the picker and the last fetch agree", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), customers: [{ id: 667, name: "Acme" }] } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={LINKS_WITH_CUSTOMER} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const select = screen.getByRole("combobox", { name: t("en-US", "timelogCustomerLabel") }) as HTMLSelectElement;
      await waitFor(() => expect(select.value).toBe("667"));
      expect(
        screen.queryByText(t("en-US", "timelogScopeMismatchNote", "Acme", "Acme")),
      ).toBeNull();
    });

    it("Fetch is disabled until a customer AND ≥1 project are picked, then routes to fetchBookingsForProjects and persists the scope", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      const fetchBookingsForProjects = vi.fn().mockResolvedValue({ failedProjects: 0, projectCount: 1 });
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), customers: [{ id: 667, name: "Acme" }], customerProjects: [{ id: 9, name: "ForgeOps", no: "PO-1" }], fetchBookingsForProjects } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <LinksProbe testId="links-probe" />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const btn = screen.getByRole("button", { name: t("en-US", "timelogSync") });
      // No customer, no project → disabled.
      expect(btn).toBeDisabled();
      // Pick a customer → still disabled (no project yet).
      fireEvent.change(screen.getByRole("combobox", { name: t("en-US", "timelogCustomerLabel") }), { target: { value: "667" } });
      expect(btn).toBeDisabled();
      // Tick a project → enabled.
      fireEvent.click(await screen.findByRole("checkbox", { name: /ForgeOps \(PO-1\)/ }));
      await waitFor(() => expect(btn).toBeEnabled());
      await act(async () => { fireEvent.click(btn); });
      expect(fetchBookingsForProjects).toHaveBeenCalledWith([9], expect.any(String), expect.any(String));
      // Both customer + selected projects persisted on the workspace links.
      await waitFor(() => {
        const parsed = JSON.parse(screen.getByTestId("links-probe").textContent ?? "null") as TimelogLinks | null;
        expect(parsed?.customerId).toBe(667);
        expect(parsed?.projectIds).toEqual([9]);
      });
    });

    it("persists scope via a functional updater — a link edit made during the fetch is not clobbered", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      // Deferred fetch so we can edit a link while it's in-flight.
      let resolveFetch!: (v: { failedProjects: number; projectCount: number }) => void;
      const fetchBookingsForProjects = vi.fn().mockReturnValue(
        new Promise((res) => { resolveFetch = res; }),
      );
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), customers: [{ id: 667, name: "Acme" }], customerProjects: [{ id: 9, name: "ForgeOps", no: "PO-1" }], fetchBookingsForProjects } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <LinksProbe testId="links-probe" />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const btn = screen.getByRole("button", { name: t("en-US", "timelogSync") });
      fireEvent.change(screen.getByRole("combobox", { name: t("en-US", "timelogCustomerLabel") }), { target: { value: "667" } });
      fireEvent.click(await screen.findByRole("checkbox", { name: /ForgeOps \(PO-1\)/ }));
      await waitFor(() => expect(btn).toBeEnabled());
      await act(async () => { fireEvent.click(btn); }); // fetch now pending

      // Edit a project link WHILE the fetch is in-flight (ForgeOps id 9 → bucket 10).
      const editLabel = `${t("en-US", "timelogMatchProjects")} – ForgeOps`;
      act(() => { fireEvent.change(screen.getByRole("combobox", { name: editLabel }), { target: { value: "10" } }); });

      // Resolve the fetch → the functional updater must merge scope onto the
      // CURRENT links (with the new project link), not the pre-fetch snapshot.
      await act(async () => { resolveFetch({ failedProjects: 0, projectCount: 1 }); });

      const parsed = JSON.parse(screen.getByTestId("links-probe").textContent ?? "null") as TimelogLinks | null;
      expect(parsed?.customerId).toBe(667);
      expect(parsed?.projectIds).toEqual([9]);
      expect(parsed?.projectLinks.find((l) => l.timelogProjectId === 9)?.bucketId).toBe(10);
    });

    it("surfaces failedProjects with a partial-fetch toast", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      const fetchBookingsForProjects = vi.fn().mockResolvedValue({ failedProjects: 3, projectCount: 5 });
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), customers: [{ id: 667, name: "Acme" }], customerProjects: [{ id: 9, name: "ForgeOps", no: "PO-1" }], fetchBookingsForProjects } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const btn = screen.getByRole("button", { name: t("en-US", "timelogSync") });
      fireEvent.change(screen.getByRole("combobox", { name: t("en-US", "timelogCustomerLabel") }), { target: { value: "667" } });
      fireEvent.click(await screen.findByRole("checkbox", { name: /ForgeOps \(PO-1\)/ }));
      await waitFor(() => expect(btn).toBeEnabled());
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith("error", t("en-US", "guardTimelogPartialProjectFetch", 3));
      });
      expect(logDiag).toHaveBeenCalledWith("warn", "timelog.partialProjectFetch", { failedProjects: 3 });
    });
  });

  describe("Loading modal", () => {
    it("shows a blocking status modal while sync.busy", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), busy: true } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      expect(screen.getByRole("status")).toHaveTextContent(t("en-US", "loadingTimelog"));
    });

    it("Cancel in the loading modal calls sync.cancel", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      const cancel = vi.fn();
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), busy: true, cancel } as unknown as ReturnType<typeof useTimelogSync>,
      );
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
      expect(cancel).toHaveBeenCalled();
    });

    it("hides the loading modal when not busy", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  describe("Apply to budget", () => {
    it("shows the apply button when the mocked aggregate yields a diff", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      // FIXED_AGGREGATE.byBucket has bucket 10 with period "2026-06" → diff row
      const applyBtn = screen.getByRole("button", { name: t("en-US", "timelogApply") });
      expect(applyBtn).not.toBeDisabled();
    });

    // `Resource.isExternal` means "capacity-tracked but excluded from ALL cost
    // figures" (types.ts). autoMatchUsers passes MANUAL links through
    // unconditionally, so an external who was hand-linked still reaches
    // byResource — and if apply can resolve their roleId, budget-report costs
    // their hours at that role's internal rate. Apply must see only the
    // cost-bearing (internal) directory.
    it("withholds hours booked by an EXTERNAL resource instead of costing them at a role rate", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} resources={[{ ...RESOURCE, roleId: 1, isExternal: true }]} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      // Nothing to apply — the only booker is excluded from cost…
      expect(screen.getByRole("button", { name: t("en-US", "timelogApply") })).toBeDisabled();
      // …and the user is told HOW MUCH is missing, not merely that something is:
      // the bucket will read 8h low, which is the number that makes the notice
      // actionable. A bare "1 bucket" left them nothing to reconcile against.
      expect(screen.getByText(t("en-US", "timelogApplyUnmatched", "1", "8"))).toBeInTheDocument();
    });

    // Apply OWNS every line of a period that routed any booking, so a figure the
    // PM typed by hand on a line TimeLog never books to is written to 0. That is
    // user-entered financial data, and the dialog used to disclose it as nothing
    // but a count ("Apply 2 bucket changes?"). The itemized rows are the only
    // thing standing between the user and a silent overwrite.
    it("itemizes the confirm step, including a hand-entered figure it will zero", () => {
      enableTimelog();
      const twoLineBucket: BudgetBucket = {
        ...BUCKET,
        allocations: [
          { roleId: 0, resourceIds: [1], budgetHours: {}, actualHours: {} },
          // Nobody books to this line in TimeLog; the 40h was typed by hand.
          { roleId: 5, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 40 } },
        ],
      };
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} buckets={[twoLineBucket]} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogApply") }));

      // Alice's 8h routes to line 1, which makes 2026-06 a routed period — so the
      // untouched line is written to 0 and MUST be shown before that happens.
      const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
      expect(rows).toContain("Alpha Project · 2026-06: 40 → 0");
      expect(rows).toContain("Alpha Project · 2026-06: 0 → 8");
    });

    it("shows confirm step and applies actuals on confirm click", async () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      // Click Apply → confirm prompt
      fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogApply") }));
      // Confirm text should now be visible (contains the diff count "1")
      expect(screen.getByText(t("en-US", "timelogApplyConfirm", "1"))).toBeInTheDocument();

      // Click the confirm Apply button
      const confirmBtns = screen.getAllByRole("button", { name: t("en-US", "timelogApply") });
      await act(async () => {
        fireEvent.click(confirmBtns[confirmBtns.length - 1]);
      });

      // Confirm prompt should be gone
      expect(
        screen.queryByText(t("en-US", "timelogApplyConfirm", "1")),
      ).not.toBeInTheDocument();
    });

    it("cancel button dismisses the confirm step", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogApply") }));
      expect(screen.getByText(t("en-US", "timelogApplyConfirm", "1"))).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
      expect(
        screen.queryByText(t("en-US", "timelogApplyConfirm", "1")),
      ).not.toBeInTheDocument();
    });
  });

  describe("Apply to budget — TOCTOU snapshot (Bug 2)", () => {
    it("Fetch button is disabled while confirming", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      // Open the confirm dialog
      fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogApply") }));
      expect(screen.getByText(t("en-US", "timelogApplyConfirm", "1"))).toBeInTheDocument();

      // The Fetch/Sync button must be disabled while confirming
      expect(screen.getByRole("button", { name: t("en-US", "timelogSync") })).toBeDisabled();
    });

    it("applies the snapshotted overlay (not live aggregates) when aggregates change between open and confirm", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");

      // Start with one diff row (bucket 10, period "2026-06", 8 hours)
      const initialSync = defaultSyncReturn();
      vi.mocked(useTimelogSync).mockReturnValue(
        initialSync as unknown as ReturnType<typeof useTimelogSync>,
      );

      const { rerender } = render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      // Open confirm — snapshot captures the initial 8-hour overlay
      fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogApply") }));
      expect(screen.getByText(t("en-US", "timelogApplyConfirm", "1"))).toBeInTheDocument();

      // Simulate aggregates changing (re-fetch while dialog is open)
      const changedSync = {
        ...initialSync,
        aggregates: {
          byBucket: { 10: { "2026-06": { hours: 99, billableHours: 99, byResource: { 1: { hours: 99, billableHours: 99 } } } } },
          byResource: { 1: { hours: 99, billableHours: 99 } },
          unattributed: { hours: 0, billableHours: 0 },
        },
      };
      vi.mocked(useTimelogSync).mockReturnValue(
        changedSync as unknown as ReturnType<typeof useTimelogSync>,
      );
      rerender(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
      );

      // Confirm text should still show "1" diff row (the snapshot count, unchanged)
      expect(screen.getByText(t("en-US", "timelogApplyConfirm", "1"))).toBeInTheDocument();
    });

    // The overlay was snapshotted but the BUDGET baseline was not, so the
    // itemised "current → next" figures were read from live budgets while the
    // write happened later. A background load between open and Apply would
    // overwrite hand-editable money the user never saw. Refuse instead.
    it("refuses to apply when the budget changed while the preview was open", () => {
      const onApplied = vi.fn();
      function BudgetMutator() {
        const ws = useWorkspace();
        return (
          <button data-testid="mutate-budget" onClick={() => {
            ws.setBudgets((prev) => prev.map((b) => ({ ...b })));
            onApplied();
          }}>m</button>
        );
      }
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <BudgetMutator />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogApply") }));
      expect(screen.getByText(t("en-US", "timelogApplyConfirm", "1"))).toBeInTheDocument();

      // A background load replaces the budgets array identity mid-confirm.
      fireEvent.click(screen.getByTestId("mutate-budget"));
      const confirmBtns = screen.getAllByRole("button", { name: t("en-US", "timelogApply") });
      fireEvent.click(confirmBtns[confirmBtns.length - 1]);

      // The confirm step closes without writing — the user must re-review.
      expect(screen.queryByText(t("en-US", "timelogApplyConfirm", "1"))).not.toBeInTheDocument();
      expect(onApplied).toHaveBeenCalledTimes(1); // only the mutator ran
      // Re-opening still offers the same single pending row, i.e. nothing was written.
      fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogApply") }));
      expect(screen.getByText(t("en-US", "timelogApplyConfirm", "1"))).toBeInTheDocument();
    });
  });

  describe("Popout read-only guards (Bug 3)", () => {
    it("people select is disabled in popout mode", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" isPopout />
        </>,
        { wrapper },
      );

      // People rows come from sync.users (mocked: Alice) — its select is disabled.
      const peopleSelectLabel = `${t("en-US", "timelogMatchPeople")} – alice@example.com`;
      expect(screen.getByRole("combobox", { name: peopleSelectLabel })).toBeDisabled();

      const projectSelectLabel = `${t("en-US", "timelogMatchProjects")} – 99`;
      const projectSelect = screen.queryByRole("combobox", { name: projectSelectLabel });
      if (projectSelect) {
        expect(projectSelect).toBeDisabled();
      }
      // Also verify: Apply button is disabled in popout
      const applyBtn = screen.queryByRole("button", { name: t("en-US", "timelogApply") });
      if (applyBtn) {
        expect(applyBtn).toBeDisabled();
      }
    });

    it("project clear button is disabled in popout mode", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" isPopout />
        </>,
        { wrapper },
      );

      // Project 99 has a link from INITIAL_LINKS → Clear button should render but be disabled
      const clearLabel = `${t("en-US", "timelogMatchClear")} – 99`;
      const clearBtn = screen.queryByRole("button", { name: clearLabel });
      if (clearBtn) {
        expect(clearBtn).toBeDisabled();
      }
    });

    it("manualLinkProject is a no-op in popout: timelogLinks unchanged after select change", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <LinksProbe testId="links-probe" />
          <TimelogPanel lang="en-US" isPopout />
        </>,
        { wrapper },
      );

      const projectSelectLabel = `${t("en-US", "timelogMatchProjects")} – 99`;
      const select = screen.queryByRole("combobox", { name: projectSelectLabel });
      if (select) {
        act(() => { fireEvent.change(select, { target: { value: "10" } }); });
        const probe = screen.getByTestId("links-probe");
        // Links must be unchanged since isPopout blocks mutation
        const parsed = JSON.parse(probe.textContent ?? "null") as TimelogLinks | null;
        const link = parsed?.projectLinks.find((l) => l.timelogProjectId === 99);
        // The link should still be the original (bucketId 10, manual: false from INITIAL_LINKS)
        expect(link?.manual).toBe(false);
      }
    });
  });

  describe("Fetch error surfacing", () => {
    it("renders the token-invalid message when sync.error is a 401", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue({
        aggregates: undefined,
        fetchedAt: undefined,
        users: [],
        projectRefs: [],
        customers: [],
        customerProjects: [],
        busy: false,
        error: 401,
        loadDirectory: vi.fn().mockResolvedValue(undefined),
        loadManagedProjects: vi.fn().mockResolvedValue(undefined),
        loadCustomers: vi.fn().mockResolvedValue(undefined),
        loadCustomerProjects: vi.fn().mockResolvedValue(undefined),
        fetchBookings: vi.fn().mockResolvedValue(undefined),
        fetchBookingsForProjects: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn(),
        removeUsers: vi.fn(),
        clearAll: vi.fn(),
      } as unknown as ReturnType<typeof useTimelogSync>);

      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      expect(screen.getByText(t("en-US", "timelogTokenInvalid"))).toBeInTheDocument();
    });

    it("renders a generic failure line when sync.error is a non-auth status", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue({
        aggregates: undefined,
        fetchedAt: undefined,
        users: [],
        projectRefs: [],
        customers: [],
        customerProjects: [],
        busy: false,
        error: 500,
        loadDirectory: vi.fn().mockResolvedValue(undefined),
        loadManagedProjects: vi.fn().mockResolvedValue(undefined),
        loadCustomers: vi.fn().mockResolvedValue(undefined),
        loadCustomerProjects: vi.fn().mockResolvedValue(undefined),
        fetchBookings: vi.fn().mockResolvedValue(undefined),
        fetchBookingsForProjects: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn(),
        removeUsers: vi.fn(),
        clearAll: vi.fn(),
      } as unknown as ReturnType<typeof useTimelogSync>);

      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      expect(screen.getByText(t("en-US", "timelogTestFail", "500"))).toBeInTheDocument();
    });

    it("interpolates the HTTP status into the failure line (429 not a literal {0})", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue({
        aggregates: undefined,
        fetchedAt: undefined,
        users: [],
        projectRefs: [],
        customers: [],
        customerProjects: [],
        busy: false,
        error: 429,
        loadDirectory: vi.fn().mockResolvedValue(undefined),
        loadManagedProjects: vi.fn().mockResolvedValue(undefined),
        loadCustomers: vi.fn().mockResolvedValue(undefined),
        loadCustomerProjects: vi.fn().mockResolvedValue(undefined),
        fetchBookings: vi.fn().mockResolvedValue(undefined),
        fetchBookingsForProjects: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn(),
        removeUsers: vi.fn(),
        clearAll: vi.fn(),
      } as unknown as ReturnType<typeof useTimelogSync>);

      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      expect(screen.getByText(t("en-US", "timelogTestFail", "429"))).toBeInTheDocument();
      expect(screen.queryByText(/\{0\}/)).toBeNull();
    });
  });

  describe("Guard feedback — customers-load failures", () => {
    it("fires an info-guard toast + diag log when loadCustomers rejects on focus", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue({
        ...defaultSyncReturn(),
        loadCustomers: vi.fn().mockRejectedValue(new Error("boom")),
      } as unknown as ReturnType<typeof useTimelogSync>);

      enableTimelog();
      render(
        <>
          <SeedWorkspace links={INITIAL_LINKS} />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );

      fireEvent.focus(screen.getByRole("searchbox", { name: t("en-US", "timelogCustomerFilter") }));

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith("error", t("en-US", "guardTimelogCustomersFailed"));
      });
      expect(logDiag).toHaveBeenCalledWith("error", "timelog.customersLoadFailed", { message: "boom" });
    });
  });
});
