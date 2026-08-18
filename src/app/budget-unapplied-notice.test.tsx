import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BudgetUnappliedNotice } from "./budget-unapplied-notice";
import { TIMELOG_ACTUALS_KEY, saveActualsCache } from "./timelog-actuals-store";
import { t } from "./i18n";
import type { ActualsAggregate } from "./timelog-actuals";
import type { BudgetBucket, Resource, Role } from "./types";

const PROJECT = "p1";

const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];

const bucket = (id: number, name: string): BudgetBucket => ({
  id, name, type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
  allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: {} }],
});

const res = (id: number, firstName: string, isExternal?: boolean): Resource => ({
  id, firstName, lastName: "R", roleId: 3, isExternal, utilizationMode: "percent", utilization: {},
});

/** One bucket·period cell with a per-person breakdown — the shape a real fetch
 *  writes, and the only shape `buildApplyPlan` can route. */
const cell = (resourceId: number, hours: number) => ({
  hours, billableHours: hours, byResource: { [resourceId]: { hours, billableHours: hours } },
});

const aggregate = (over: Partial<ActualsAggregate>): ActualsAggregate => ({
  byBucket: {}, byResource: {}, unattributed: { hours: 0, billableHours: 0 }, ...over,
});

function seed(agg: ActualsAggregate): void {
  saveActualsCache(PROJECT, { fetchedAt: "2026-02-01T00:00:00.000Z", aggregates: agg });
}

/** The same entry, marked as having lost a project to a fetch error (§172). */
function seedPartial(agg: ActualsAggregate): void {
  saveActualsCache(PROJECT, { fetchedAt: "2026-02-01T00:00:00.000Z", aggregates: agg, partial: true });
}

const props = {
  lang: "en-US" as const,
  projectId: PROJECT,
  buckets: [bucket(1, "PAM")],
  roles,
  resources: [res(1, "Ina")],
  onGoToTimelog: vi.fn(),
};

describe("BudgetUnappliedNotice", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  test("names the bucket count when the cached overlay yields a non-empty plan", () => {
    seed(aggregate({ byBucket: { 1: { "2026-01": cell(1, 10) } } }));
    render(<BudgetUnappliedNotice {...props} />);
    expect(screen.getByText(/1 budget bucket/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /time bookings/i })).toBeInTheDocument();
  });

  // ★★★ §172. The fixture is DELIBERATELY the union of the two tests around it
  //     — a routable bucket cell AND unattributed hours — so both of the signals
  //     those tests assert are provably present on this data. `partial: true` is
  //     the only difference, which is what makes each suppression assertion
  //     below observable: drop the `!partial` guard on either branch and the
  //     matching `queryByText` goes non-null.
  //     Why suppress rather than annotate: every signal here is DERIVED from the
  //     short overlay, so on a partial entry all of them describe hours the
  //     Timelog panel now refuses to write. Reporting them would send the user
  //     down a "Go to Time bookings →" that ends on a disabled Apply.
  test("suppresses every derived signal when the cached fetch lost a project", () => {
    seedPartial(aggregate({
      byBucket: { 1: { "2026-01": cell(1, 10) } },
      unattributed: { hours: 12, billableHours: 12 },
    }));
    render(<BudgetUnappliedNotice {...props} />);
    expect(screen.getByText(t("en-US", "timelogApplyPartial"))).toBeInTheDocument();
    expect(screen.queryByText(/budget bucket/i)).toBeNull();
    expect(screen.queryByText(/12h/i)).toBeNull();
    // The Go button STAYS — Time bookings is where the Refresh that repairs
    // this lives, so the one action still worth offering must not be removed.
    expect(screen.getByRole("button", { name: /time bookings/i })).toBeInTheDocument();
  });

  test("the Time bookings link calls onGoToTimelog", () => {
    seed(aggregate({ byBucket: { 1: { "2026-01": cell(1, 10) } } }));
    const onGoToTimelog = vi.fn();
    render(<BudgetUnappliedNotice {...props} onGoToTimelog={onGoToTimelog} />);
    fireEvent.click(screen.getByRole("button", { name: /time bookings/i }));
    expect(onGoToTimelog).toHaveBeenCalledTimes(1);
  });

  // ★ The state the user's report was actually in: hours exist but were never
  //   attributed, while the People/Projects tables show the links as healthy.
  test("warns about unattributed hours even when the plan is empty", () => {
    seed(aggregate({ byBucket: {}, unattributed: { hours: 12, billableHours: 12 } }));
    render(<BudgetUnappliedNotice {...props} />);
    expect(screen.getByText(/12h/i)).toBeInTheDocument();
    // The ready-to-apply half must NOT claim a bucket — nothing can be applied.
    expect(screen.queryByText(/budget bucket/i)).toBeNull();
  });

  test("renders both signals together when the cache carries both", () => {
    seed(aggregate({
      byBucket: { 1: { "2026-01": cell(1, 10) } },
      unattributed: { hours: 4, billableHours: 4 },
    }));
    render(<BudgetUnappliedNotice {...props} />);
    expect(screen.getByText(/1 budget bucket/i)).toBeInTheDocument();
    expect(screen.getByText(/4h/i)).toBeInTheDocument();
  });

  test("renders nothing when the plan is empty and nothing is unattributed", () => {
    seed(aggregate({ byBucket: {} }));
    const { container } = render(<BudgetUnappliedNotice {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  // ★ loadActualsCache does NOT throw (readDeviceJson try/catches; per-entry
  //   isEntry validation drops malformed entries silently). This pins that.
  test("renders nothing and does not throw on a malformed cache", () => {
    window.localStorage.setItem(TIMELOG_ACTUALS_KEY, "{{{not json");
    const { container } = render(<BudgetUnappliedNotice {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing when there is no cache at all", () => {
    const { container } = render(<BudgetUnappliedNotice {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing for a project that is not the cached one", () => {
    seed(aggregate({ byBucket: { 1: { "2026-01": cell(1, 10) } } }));
    const { container } = render(<BudgetUnappliedNotice {...props} projectId="other" />);
    expect(container).toBeEmptyDOMElement();
  });

  // ★★★ THE REPORTED STATE, and the one the notice was SILENT in. Hours DID
  //     resolve to a bucket at fetch time, so nothing is unattributed — they
  //     just match no allocation line, which `buildApplyPlan` records only in
  //     `unmatchedBuckets`. Reading `.rows` alone yields NOTHING here, so the
  //     notice appeared only AFTER the user added the missing line, i.e. after
  //     they had fixed the thing it existed to warn them about.
  // ★★ ANTI-VACUITY: the ready-to-apply half must be ABSENT. If the fixture
  //     also produced plan rows, the existing `.rows` branch would render the
  //     notice and this test would pass with the new signal deleted.
  test("warns when booked hours match no allocation line in their bucket", () => {
    // Ina holds role 3; the only line on the bucket is role 9 → no line fits.
    const mismatched: BudgetBucket = {
      ...bucket(1, "PAM"),
      allocations: [{ roleId: 9, resourceIds: [], budgetHours: {}, actualHours: {} }],
    };
    seed(aggregate({ byBucket: { 1: { "2026-01": cell(1, 10) } } }));
    render(<BudgetUnappliedNotice {...props} buckets={[mismatched]} />);
    expect(screen.getByText(/couldn't be matched to a role line/i)).toBeInTheDocument();
    expect(screen.queryByText(/waiting to be applied/i)).toBeNull();
    expect(screen.queryByText(/could not be placed on any budget line/i)).toBeNull();
  });

  // ★★★ The OTHER silent state, and it is silent for a different reason:
  //     `routeBucket` returns null for a bucket with no target allocations and
  //     `buildApplyPlan` `continue`s, so such a bucket is not even recorded as
  //     unmatched. Only `bucketsMissingAllocations` sees it.
  test("warns when a bucket carrying booked hours has no allocation line at all", () => {
    const empty: BudgetBucket = { ...bucket(1, "PAM"), allocations: [] };
    seed(aggregate({ byBucket: { 1: { "2026-01": cell(1, 6) } } }));
    render(<BudgetUnappliedNotice {...props} buckets={[empty]} />);
    expect(screen.getByText(/no role or discipline line to hold them/i)).toBeInTheDocument();
    expect(screen.queryByText(/waiting to be applied/i)).toBeNull();
    expect(screen.queryByText(/couldn't be matched to a role line/i)).toBeNull();
  });

  // ★★★ An external must never reach buildApplyPlan — it would resolve a roleId
  //     and cost their hours at an internal rate. A fixture with no externals
  //     cannot express this, so seed one, and give the run a POSITIVE observable
  //     (one bucket, not two) so the assertion cannot pass by rendering nothing.
  test("excludes external resources from the plan", () => {
    seed(aggregate({
      byBucket: {
        1: { "2026-01": cell(1, 10) }, // internal → routes
        2: { "2026-01": cell(2, 8) },  // external → must NOT route
      },
    }));
    render(
      <BudgetUnappliedNotice
        {...props}
        buckets={[bucket(1, "PAM"), bucket(2, "DEV")]}
        resources={[res(1, "Ina"), res(2, "Ext", true)]}
      />,
    );
    expect(screen.getByText(/1 budget bucket/i)).toBeInTheDocument();
    expect(screen.queryByText(/2 budget bucket/i)).toBeNull();
  });
});
