import { describe, it, expect, vi, beforeAll } from "vitest";
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SimExplainer, FORECAST_SIM_HELP_ID, buildHistogramBins } from "./sim-explainer";
import { loadI18n } from "./i18n";
import { MAX_HORIZON_WORKING_DAYS } from "./forecast/constants";

// The engine's encoding of a trial (or a percentile) that never finished inside the horizon.
const HORIZON_SENTINEL = MAX_HORIZON_WORKING_DAYS + 1;
const markers = { p50: 10, p80: 14, p95: 20 };
// 100 runs spread over days 5..24, all inside the horizon.
const distribution = Array.from({ length: 100 }, (_, i) => 5 + (i % 20));

function setup(props: Partial<ComponentProps<typeof SimExplainer>> = {}) {
  return render(
    <SimExplainer lang="en-US" windowDays={60} distribution={distribution} trials={100} markers={markers} {...props} />,
  );
}

describe("SimExplainer", () => {
  it("is closed by default", () => {
    setup();
    expect(screen.getByRole("button", { name: "How to read this" })).toBeInTheDocument();
    expect(screen.queryByText(/replayed your team's real past days 10,000 times/)).not.toBeInTheDocument();
  });

  it("opens on click and shows both copy lines", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "How to read this" }));
    expect(screen.getByText(/replayed your team's real past days 10,000 times/)).toBeInTheDocument();
    expect(screen.getByText("Based on the last 60 working days.")).toBeInTheDocument();
  });

  it("opens by keyboard alone (tab, Enter)", async () => {
    const user = userEvent.setup();
    setup();
    await user.tab();
    expect(screen.getByRole("button", { name: "How to read this" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Based on the last 60 working days.")).toBeInTheDocument();
  });

  it("Escape closes it and focus returns to the button", async () => {
    const user = userEvent.setup();
    setup();
    const btn = screen.getByRole("button", { name: "How to read this" });
    await user.click(btn);
    expect(screen.getByText("Based on the last 60 working days.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Based on the last 60 working days.")).not.toBeInTheDocument();
    expect(btn).toHaveFocus();
  });

  it("closes on an outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">outside</button>
        <SimExplainer lang="en-US" windowDays={60} distribution={distribution} trials={100} markers={markers} />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "How to read this" }));
    expect(screen.getByText("Based on the last 60 working days.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByText("Based on the last 60 working days.")).not.toBeInTheDocument();
  });

  it("renders a labelled histogram summarising the three cut values", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "How to read this" }));
    const img = screen.getByRole("img", {
      name: "Spread of simulated finish times. Even odds in 10 working days, safe to commit in 14 working days, cautious in 20 working days.",
    });
    const bars = img.querySelectorAll("rect[data-bin]");
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.length).toBeLessThanOrEqual(20);
    expect(img.querySelectorAll("line[data-cut]")).toHaveLength(3);
  });

  it("names a beyond-horizon percentile as such, never as an impossible day count", async () => {
    const user = userEvent.setup();
    setup({ markers: { p50: 10, p80: 14, p95: HORIZON_SENTINEL } });
    await user.click(screen.getByRole("button", { name: "How to read this" }));
    const img = screen.getByRole("img", {
      name: "Spread of simulated finish times. Even odds in 10 working days, safe to commit in 14 working days, cautious beyond the horizon.",
    });
    expect(img.getAttribute("aria-label")).not.toContain(String(HORIZON_SENTINEL));
  });

  it("still names the last day inside the horizon as a day count", async () => {
    const user = userEvent.setup();
    setup({ markers: { p50: 10, p80: 14, p95: MAX_HORIZON_WORKING_DAYS } });
    await user.click(screen.getByRole("button", { name: "How to read this" }));
    expect(screen.getByRole("img", { name: new RegExp(`cautious in ${MAX_HORIZON_WORKING_DAYS.toLocaleString("en-US")} working days\\.$`) })).toBeInTheDocument();
  });

  it("excludes beyond-horizon trials from the bars and says so", async () => {
    const user = userEvent.setup();
    const dist = [...distribution.slice(0, 90), ...Array(10).fill(HORIZON_SENTINEL)];
    setup({ distribution: dist, trials: 100 });
    await user.click(screen.getByRole("button", { name: "How to read this" }));
    expect(screen.getByText("10% of runs did not finish within the horizon.")).toBeInTheDocument();
  });

  it.each([
    [1, 10000, "<1% of runs did not finish within the horizon."],
    [9960, 10000, ">99% of runs did not finish within the horizon."],
  ])("never rounds a beyond-horizon share of %s in %s to certainty", async (beyondRuns, trials, text) => {
    const user = userEvent.setup();
    const dist = [...Array(trials - beyondRuns).fill(5), ...Array(beyondRuns).fill(HORIZON_SENTINEL)];
    setup({ distribution: dist, trials });
    await user.click(screen.getByRole("button", { name: "How to read this" }));
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("omits the beyond-horizon note when every run finished", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "How to read this" }));
    expect(screen.getByText("Based on the last 60 working days.")).toBeInTheDocument();
    expect(screen.queryByText(/did not finish within the horizon/)).not.toBeInTheDocument();
  });

  it("has no Help link without onOpenHelp", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "How to read this" }));
    expect(screen.getByText("Based on the last 60 working days.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Learn more in Help" })).not.toBeInTheDocument();
  });

  it("calls onOpenHelp with the concept id when the Help link is used", async () => {
    const user = userEvent.setup();
    const onOpenHelp = vi.fn();
    setup({ onOpenHelp });
    await user.click(screen.getByRole("button", { name: "How to read this" }));
    await user.click(screen.getByRole("button", { name: "Learn more in Help" }));
    expect(onOpenHelp).toHaveBeenCalledWith(FORECAST_SIM_HELP_ID);
    expect(FORECAST_SIM_HELP_ID).toBe("concept-forecast-simulation");
  });
});

describe("buildHistogramBins", () => {
  it("never exceeds the bin cap and counts every in-horizon trial once", () => {
    const H = MAX_HORIZON_WORKING_DAYS;
    const { bins, beyond } = buildHistogramBins([1, 2, 3, 400, 800, H, HORIZON_SENTINEL, HORIZON_SENTINEL], 20);
    expect(bins.length).toBeLessThanOrEqual(20);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(6);
    expect(beyond).toBe(2);
  });

  it("returns no bins for an empty distribution", () => {
    expect(buildHistogramBins([], 20)).toEqual({ bins: [], beyond: 0 });
  });
});

describe("SimExplainer in German", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("renders the explainer in German with real umlauts", async () => {
    const user = userEvent.setup();
    render(<SimExplainer lang="de" windowDays={60} distribution={distribution} trials={100} markers={markers} />);
    await user.click(screen.getByRole("button", { name: "So lesen Sie das" }));
    expect(screen.getByText(/tatsächlichen vergangenen Tage Ihres Teams 10\.000-mal durchgespielt/)).toBeInTheDocument();
    expect(screen.getByText("Basierend auf den letzten 60 Arbeitstagen.")).toBeInTheDocument();
  });
});

describe("SimExplainer kind milestone (§502)", () => {
  it("says the milestone line and the window, draws no histogram and no percentile list", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<SimExplainer lang="en-US" kind="milestone" windowDays={60} label="About these chances" onOpenHelp={() => {}} />);
    await user.click(screen.getByRole("button", { name: "How to read this: About these chances" }));
    expect(screen.getByText(/share of the 10,000 runs that finished the milestone's last linked task by its date/)).toBeInTheDocument();
    expect(screen.getByText(/also shows the chance if the milestone's tasks went first/)).toBeInTheDocument();
    expect(screen.getByText("Based on the last 60 working days.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Learn more in Help" })).toBeInTheDocument();
    expect(baseElement.querySelector("svg[role='img']")).toBeNull();
    expect(screen.queryByText(/P50|P80|P95/)).toBeNull();
  });
});
