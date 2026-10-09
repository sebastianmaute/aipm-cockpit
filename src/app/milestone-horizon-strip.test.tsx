import { describe, expect, it, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MilestoneHorizonStrip } from "./milestone-horizon-strip";
import type { MilestoneHorizonBuckets } from "./milestones";
import type { Milestone } from "./types";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { buttonClassFor } from "../test/button-variant";

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

// §669 — two milestones can share a name and a date.
describe("MilestoneHorizonStrip row names", () => {
  it("names two chips with one name and date apart by a row token", () => {
    const twin = (id: number): Milestone => ({ ...m(id, "2026-08-01"), name: "Go-live" });
    render(
      <MilestoneHorizonStrip
        lang="en-US"
        buckets={buckets({ later: [{ milestone: twin(1), status: "on-track" }, { milestone: twin(2), status: "on-track" }] })}
        onOpenMilestone={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Go-live · 2026-08-01 (2)" })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true });
  });
});

// §669 review — two buckets overflowing by the same count both read "+2 more".
describe("MilestoneHorizonStrip more buttons", () => {
  it("names each bucket's more button by its bucket", () => {
    const seven = (base: number) =>
      Array.from({ length: 7 }, (_, i) => ({ milestone: m(base + i, "2026-08-01"), status: "on-track" as const }));
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets({ next2Weeks: seven(100), later: seven(200) })} onOpenMilestone={vi.fn()} />);
    expect(screen.getByRole("button", { name: "+2 more – Later" })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 12 });
  });
});

// §102 (batch 23, owner decision 2026-10-09): the near-size buttons moved to the shared `xs`.
describe("MilestoneHorizonStrip buttons on the shared Button", () => {
  test("draws a chip and '+N more' as secondary xs", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ milestone: m(i + 1, `2026-09-0${(i % 9) + 1}`), status: "on-track" as const }));
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets({ later: many })} onOpenMilestone={vi.fn()} />);
    expect(screen.getByRole("button", { name: /M1 · 2026-09-01/ }).className).toBe(
      buttonClassFor({ variant: "secondary", size: "xs", className: "inline-flex items-center gap-1" }),
    );
    expect(screen.getByRole("button", { name: /^\+3 more/ }).className).toBe(
      buttonClassFor({ variant: "secondary", size: "xs" }),
    );
  });
});
