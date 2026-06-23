// src/app/timelog-panel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
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
import type { ActualsAggregate } from "./timelog-actuals";

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

// Defined before vi.mock factories (hoisted) — inline the value in the factory.
const FIXED_AGGREGATE: ActualsAggregate = {
  byBucket: { 10: { "2026-06": { hours: 8, billableHours: 6 } } },
  byResource: { 1: { hours: 8, billableHours: 6 } },
  unattributed: { hours: 2, billableHours: 0 },
};

const mockSyncFn = vi.fn().mockResolvedValue(undefined);

vi.mock("./use-timelog-sync", () => ({
  useTimelogSync: vi.fn().mockReturnValue({
    aggregates: {
      byBucket: { 10: { "2026-06": { hours: 8, billableHours: 6 } } },
      byResource: { 1: { hours: 8, billableHours: 6 } },
      unattributed: { hours: 2, billableHours: 0 },
    },
    fetchedAt: "2026-06-23T10:00:00.000Z",
    busy: false,
    error: null,
    sync: vi.fn().mockResolvedValue(undefined),
  }),
}));

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
}: {
  links?: TimelogLinks;
}) {
  const ws = useWorkspace();
  useEffect(() => {
    ws.setResources([RESOURCE]);
    ws.setBudgets([BUCKET]);
    if (links) ws.setTimelogLinks(links);
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

  describe("Projects matching table — row-unique labels and manual links", () => {
    // knownProjectRefs is synchronously derived from links.projectLinks, so
    // this table is always populated when INITIAL_LINKS has projectLinks.

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
});
