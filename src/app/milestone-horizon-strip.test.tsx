import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MilestoneHorizonStrip } from "./milestone-horizon-strip";
import type { MilestoneHorizonBuckets } from "./milestones";
import type { Milestone } from "./types";

const m = (id: number, date: string): Milestone => ({ id, name: `M${id}`, date, linkedTaskIds: [] } as Milestone);
function buckets(over: Partial<MilestoneHorizonBuckets> = {}): MilestoneHorizonBuckets {
  return { overdue: [], thisWeek: [], next2Weeks: [], later: [], ...over };
}

describe("MilestoneHorizonStrip", () => {
  test("all buckets empty → 'No upcoming milestones'", () => {
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets()} />);
    expect(screen.getByText(/No upcoming milestones/i)).toBeInTheDocument();
  });

  test("renders a bucket header with its count", () => {
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets({ thisWeek: [{ milestone: m(1, "2026-06-28"), status: "due-soon" }] })} />);
    expect(screen.getByText(/This week \(1\)/)).toBeInTheDocument();
  });

  test("a chip click invokes onOpenMilestone", () => {
    const onOpen = vi.fn();
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets({ later: [{ milestone: m(2, "2026-08-01"), status: "on-track" }] })} onOpenMilestone={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /M2 · 2026-08-01/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test("handler-less chip is a span, not a button", () => {
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets({ later: [{ milestone: m(3, "2026-08-01"), status: "on-track" }] })} />);
    expect(screen.queryByRole("button", { name: /M3/ })).toBeNull();
    expect(screen.getByText(/M3 · 2026-08-01/)).toBeInTheDocument();
  });

  test("at-risk entry shows the warning marker", () => {
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets({ thisWeek: [{ milestone: m(4, "2026-06-28"), status: "at-risk" }] })} />);
    expect(screen.getByText(/⚠/)).toBeInTheDocument();
  });
});
