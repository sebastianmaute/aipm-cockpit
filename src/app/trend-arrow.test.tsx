import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendArrow } from "./trend-arrow";
import type { MetricTrend } from "./dashboard-trends";

function trend(over: Partial<MetricTrend> = {}): MetricTrend {
  return { value: 0, delta: 0, direction: "flat", improved: false, ...over };
}

describe("TrendArrow", () => {
  test("renders nothing on first visit (improved null, no prior)", () => {
    const { container } = render(
      <TrendArrow lang="en-US" metricLabel="Overdue" trend={trend({ value: 3, delta: null, direction: "flat", improved: null })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("completion up is improved → green token, accessible 'up' label", () => {
    render(<TrendArrow lang="en-US" metricLabel="Completion" trend={trend({ value: 60, delta: 2, direction: "up", improved: true })} />);
    const el = screen.getByLabelText(/Completion up 2 since/i);
    expect(el.className).toContain("text-[var(--rag-green-text)]");
  });

  test("overdue down is improved → green token, real minus glyph in visible text", () => {
    render(<TrendArrow lang="en-US" metricLabel="Overdue" trend={trend({ value: 1, delta: -2, direction: "down", improved: true })} />);
    const el = screen.getByLabelText(/Overdue down 2 since/i);
    expect(el.className).toContain("text-[var(--rag-green-text)]");
    expect(el.textContent).toContain("−2");
  });

  test("overdue up is worse → pink token", () => {
    render(<TrendArrow lang="en-US" metricLabel="Overdue" trend={trend({ value: 5, delta: 3, direction: "up", improved: false })} />);
    const el = screen.getByLabelText(/Overdue up 3 since/i);
    expect(el.className).toContain("text-[var(--rag-red-text)]");
  });

  test("unit suffix appears in both the visible delta and the accessible label", () => {
    render(<TrendArrow lang="en-US" metricLabel="Complete" unit="%" trend={trend({ value: 65, delta: 5, direction: "up", improved: true })} />);
    const el = screen.getByLabelText(/Complete up 5% since/i);
    expect(el.textContent).toContain("+5%");
  });

  test("flat (delta 0) → muted token, 'unchanged' label", () => {
    render(<TrendArrow lang="en-US" metricLabel="Overdue" trend={trend({ value: 5, delta: 0, direction: "flat", improved: false })} />);
    const el = screen.getByLabelText(/Overdue unchanged/i);
    expect(el.className).toContain("text-muted-foreground");
  });

  // Pill chip tests — verify token-driven chip bg and rounded-full pill shape.
  // Under AIPM the tokens are transparent so the pill is invisible; under mockup
  // the tokens resolve to tinted bg colours.

  test("(a) improved trend renders green chip bg and rounded-full pill", () => {
    render(<TrendArrow lang="en-US" metricLabel="Completion" trend={trend({ value: 60, delta: 5, direction: "up", improved: true })} />);
    const el = screen.getByLabelText(/Completion up 5 since/i);
    expect(el.className).toContain("bg-[var(--rag-green-chip)]");
    expect(el.className).toContain("rounded-full");
  });

  test("(b) worsened (up, non-improved) trend renders red chip bg", () => {
    render(<TrendArrow lang="en-US" metricLabel="Overdue" trend={trend({ value: 5, delta: 3, direction: "up", improved: false })} />);
    const el = screen.getByLabelText(/Overdue up 3 since/i);
    expect(el.className).toContain("bg-[var(--rag-red-chip)]");
    expect(el.className).toContain("rounded-full");
  });

  test("(c) worsened (down, non-improved) trend renders red chip bg", () => {
    render(<TrendArrow lang="en-US" metricLabel="Completion" trend={trend({ value: 40, delta: -5, direction: "down", improved: false })} />);
    const el = screen.getByLabelText(/Completion down 5 since/i);
    expect(el.className).toContain("bg-[var(--rag-red-chip)]");
  });

  test("(d) flat trend has no chip bg token (neither green nor red chip)", () => {
    render(<TrendArrow lang="en-US" metricLabel="Overdue" trend={trend({ value: 5, delta: 0, direction: "flat", improved: false })} />);
    const el = screen.getByLabelText(/Overdue unchanged/i);
    expect(el.className).not.toContain("bg-[var(--rag-green-chip)]");
    expect(el.className).not.toContain("bg-[var(--rag-red-chip)]");
  });

  test("(e) null improved (first visit) renders nothing", () => {
    const { container } = render(
      <TrendArrow lang="en-US" metricLabel="Overdue" trend={trend({ value: 3, delta: null, direction: "flat", improved: null })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
