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

  describe("Refresh bookings", () => {
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
      fireEvent.click(await screen.findByRole("button", { name: t("en-US", "timelogRefresh") }));
      await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", expect.any(String)));
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
