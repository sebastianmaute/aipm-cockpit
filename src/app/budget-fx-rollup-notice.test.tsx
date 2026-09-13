import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetFxRollupNotice } from "./budget-fx-rollup-notice";
import { loadI18n, t } from "./i18n";
import type { BudgetBucket, FxRates } from "./types";

// §474 (rollup half): both budget-panel.tsx and budget-report-panel.tsx sum
// every bucket's EUR-reported figure into a EUR-labelled project rollup
// regardless of whether a rate was ever confirmed for the bucket — a bucket
// whose `resolveRateSource` (fx.ts) reads "unresolved" is summed in AT PAR,
// with nothing on screen saying so. This notice is that disclosure, shared
// by both surfaces so they cannot report a different count for the same
// buckets.
const bucket = (extra: Partial<BudgetBucket> = {}): BudgetBucket =>
  ({ id: 1, name: "B", type: "tm", currency: "USD", startDate: "", endDate: "", status: "open", allocations: [], ...extra });

describe("BudgetFxRollupNotice", () => {
  test("renders nothing when no bucket is unresolved", () => {
    const { container } = render(
      <BudgetFxRollupNotice lang="en-US" buckets={[bucket({ currency: "EUR" })]} fxRates={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing for an empty project", () => {
    const { container } = render(<BudgetFxRollupNotice lang="en-US" buckets={[]} fxRates={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("names the exact count of unresolved buckets", () => {
    const mixed = [
      bucket({ id: 1, currency: "EUR" }), // resolved ("eur")
      bucket({ id: 2, currency: "USD" }), // unresolved — no override, no cache
      bucket({ id: 3, currency: "GBP" }), // unresolved — no override, no cache
    ];
    render(<BudgetFxRollupNotice lang="en-US" buckets={mixed} fxRates={null} />);
    expect(screen.getByText(t("en-US", "budgetFxRollupUnresolved", "2"))).toBeInTheDocument();
  });

  test("a resolved (cached or overridden) bucket is not counted", () => {
    const fxRates: FxRates = { base: "EUR", date: "2026-01-01", fetchedAt: "x", rates: { EUR: 1, USD: 1.1 } };
    const buckets = [bucket({ id: 1, currency: "USD" }), bucket({ id: 2, currency: "GBP", fxRateOverride: 1.3 })];
    render(<BudgetFxRollupNotice lang="en-US" buckets={buckets} fxRates={fxRates} />);
    expect(screen.queryByText(/without an FX rate/i)).toBeNull();
  });

  test("renders in German too", async () => {
    await loadI18n("de");
    render(<BudgetFxRollupNotice lang="de" buckets={[bucket({ currency: "USD" })]} fxRates={null} />);
    expect(screen.getByText(t("de", "budgetFxRollupUnresolved", "1"))).toBeInTheDocument();
  });
});
