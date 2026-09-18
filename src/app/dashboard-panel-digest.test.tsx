import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { DashboardPanel } from "./dashboard-panel";

/**
 * Spec C fix round 1: pins that the panel really passes the digest into row
 * 1's digest slot, at the panel level — not just that the slot exists
 * (`dashboard-panel-layout.test.tsx`) or that `DashboardTopRow`'s slot collapses
 * when empty (`dashboard-rows.test.tsx`).
 *
 * ★ A DEDICATED FILE, NOT A TEST INSIDE `dashboard-panel-layout.test.tsx`.
 * `vi.mock` is hoisted to the top of its module and applies for the whole
 * file, so mocking `./digest/digest-card-connected` here — rather than in the
 * shared layout-test file — keeps every other row-1/row-2 test in this branch
 * exercising the REAL `DigestCardConnected` (which self-hides without a
 * generated digest, so it renders nothing there today; a future test that
 * needs it non-null would otherwise be exercising this stub instead).
 *
 * The stub deliberately ignores its real props (`lang`/`dc`/`model`/`raid`/
 * `projectId`/`isPopout`) — this test is about WHERE the panel renders it, not
 * about `useDigest`'s own generate/enable logic, which is covered elsewhere
 * (`use-digest.test.tsx`, `digest-card.tsx`'s own tests).
 */
vi.mock("./digest/digest-card-connected", () => ({
  DigestCardConnected: () => <p data-testid="digest-probe">digest</p>,
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const EN = "en-US" as const;
const plan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" as const };
const baseProps = {
  lang: EN, tasks: [], raid: [], budgets: [], plan, roles: [], resources: [], absences: [],
  holidaySet: new Set<string>(), workdayHours: 8, today: "2026-06-02",
};

describe("DashboardPanel row 1 digest wiring (spec C fix round 1)", () => {
  it("renders the digest exactly once, inside row 1's digest slot", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row1-digest-wiring" />, { wrapper });
    expect(screen.getAllByTestId("digest-probe")).toHaveLength(1);
    const slot = screen.getByTestId("dashboard-row-top-digest");
    expect(within(slot).getByTestId("digest-probe")).toBeInTheDocument();
  });
});
