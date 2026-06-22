import { describe, expect, it, test, vi } from "vitest";
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

  test("caps a bucket at 5 chips and shows '+N more' (header keeps the true total)", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ milestone: m(i + 1, `2026-09-0${(i % 9) + 1}`), status: "on-track" as const }));
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets({ later: many })} />);
    expect(screen.getByText(/Later \(8\)/)).toBeInTheDocument();
    expect(screen.getByText(/\+3 more/)).toBeInTheDocument();
  });
});

describe("MilestoneHorizonStrip click-through", () => {
  it("calls onOpenMilestone with the chip's milestone id", () => {
    const onOpen = vi.fn();
    const buckets = {
      overdue: [],
      thisWeek: [{ milestone: { id: 42, name: "M42", date: "2026-07-01" }, status: "upcoming" }],
      next2Weeks: [],
      later: [],
    } as never;
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets} onOpenMilestone={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /M42/ }));
    expect(onOpen).toHaveBeenCalledWith(42);
  });

  it("calls onOpenMilestone with -1 for the +N more affordance", () => {
    const onOpen = vi.fn();
    const entry = (id: number) => ({ milestone: { id, name: `M${id}`, date: "2026-07-01" }, status: "upcoming" });
    const buckets = {
      overdue: [],
      thisWeek: [],
      next2Weeks: [],
      later: [entry(1), entry(2), entry(3), entry(4), entry(5), entry(6)],
    } as never;
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets} onOpenMilestone={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /more|\+1/ }));
    expect(onOpen).toHaveBeenCalledWith(-1);
  });
});
