import { describe, expect, it, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SimExplainer } from "./sim-explainer";
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

// §102 (batch 23): read-only and composite chips take the same 30px box as the xs Buttons they sit beside or stand in for.
describe("MilestoneHorizonStrip read-only chips at the xs size", () => {
  test("draws a read-only chip and +N more in the same box as their buttons", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ milestone: m(i + 1, `2026-09-0${(i % 9) + 1}`), status: "on-track" as const }));
    render(<MilestoneHorizonStrip lang="en-US" buckets={buckets({ later: many })} />);
    expect(screen.getByText(/M1 · 2026-09-01/).className).toBe(
      "inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-muted-foreground",
    );
    expect(screen.getByText(/\+3 more/).className).toBe("rounded-md border border-line px-2.5 py-1.5 text-xs text-muted-foreground");
  });
});
// §502 part 2 — the simulated chance chip. Captured from the component BEFORE the chip existed.
const PRE_CHIP_BUTTONS = "<div class=\"space-y-3\"><div><p class=\"mb-1 text-xs font-semibold uppercase text-muted-foreground\">Overdue (1)</p><ul class=\"flex flex-wrap gap-2\"><li><button type=\"button\" class=\"cursor-pointer rounded-md font-medium disabled:cursor-not-allowed disabled:opacity-50 px-2.5 py-1.5 text-xs border border-line bg-surface text-foreground hover:bg-surface-muted transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-ui-green active:translate-y-px inline-flex items-center gap-1\" aria-label=\"⚠ M1 · 2026-06-01\"><span aria-hidden=\"true\"><span role=\"img\" aria-label=\"Red\" title=\"Red\" data-rag-chip=\"R\" class=\"inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold [-webkit-print-color-adjust:exact] [print-color-adjust:exact] bg-[var(--rag-badge-red)] text-white\">R</span></span>⚠ M1 · 2026-06-01</button></li></ul></div><div><p class=\"mb-1 text-xs font-semibold uppercase text-muted-foreground\">This week (1)</p><ul class=\"flex flex-wrap gap-2\"><li><button type=\"button\" class=\"cursor-pointer rounded-md font-medium disabled:cursor-not-allowed disabled:opacity-50 px-2.5 py-1.5 text-xs border border-line bg-surface text-foreground hover:bg-surface-muted transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-ui-green active:translate-y-px inline-flex items-center gap-1\" aria-label=\"⚠ M2 · 2026-06-28\"><span aria-hidden=\"true\"><span role=\"img\" aria-label=\"Amber\" title=\"Amber\" data-rag-chip=\"A\" class=\"inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold [-webkit-print-color-adjust:exact] [print-color-adjust:exact] bg-[var(--rag-amber)] text-[var(--rag-badge-amber-ink)]\">A</span></span>⚠ M2 · 2026-06-28</button></li></ul></div><div><p class=\"mb-1 text-xs font-semibold uppercase text-muted-foreground\">Later (1)</p><ul class=\"flex flex-wrap gap-2\"><li><button type=\"button\" class=\"cursor-pointer rounded-md font-medium disabled:cursor-not-allowed disabled:opacity-50 px-2.5 py-1.5 text-xs border border-line bg-surface text-foreground hover:bg-surface-muted transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-ui-green active:translate-y-px inline-flex items-center gap-1\" aria-label=\"M3 · 2026-08-01\">M3 · 2026-08-01</button></li></ul></div></div>";
const PRE_CHIP_SPANS = "<div class=\"space-y-3\"><div><p class=\"mb-1 text-xs font-semibold uppercase text-muted-foreground\">Overdue (1)</p><ul class=\"flex flex-wrap gap-2\"><li><span class=\"inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-muted-foreground\"><span aria-hidden=\"true\"><span role=\"img\" aria-label=\"Red\" title=\"Red\" data-rag-chip=\"R\" class=\"inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold [-webkit-print-color-adjust:exact] [print-color-adjust:exact] bg-[var(--rag-badge-red)] text-white\">R</span></span>⚠ M1 · 2026-06-01</span></li></ul></div><div><p class=\"mb-1 text-xs font-semibold uppercase text-muted-foreground\">This week (1)</p><ul class=\"flex flex-wrap gap-2\"><li><span class=\"inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-muted-foreground\"><span aria-hidden=\"true\"><span role=\"img\" aria-label=\"Amber\" title=\"Amber\" data-rag-chip=\"A\" class=\"inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold [-webkit-print-color-adjust:exact] [print-color-adjust:exact] bg-[var(--rag-amber)] text-[var(--rag-badge-amber-ink)]\">A</span></span>⚠ M2 · 2026-06-28</span></li></ul></div><div><p class=\"mb-1 text-xs font-semibold uppercase text-muted-foreground\">Later (1)</p><ul class=\"flex flex-wrap gap-2\"><li><span class=\"inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-muted-foreground\">M3 · 2026-08-01</span></li></ul></div></div>";
const lm = (id: number, date: string): Milestone => ({ id, name: `M${id}`, date, linkedTaskIds: [1] } as Milestone);
function fixture(): MilestoneHorizonBuckets {
  return buckets({
    overdue: [{ milestone: lm(1, "2026-06-01"), status: "overdue" }],
    thisWeek: [{ milestone: lm(2, "2026-06-28"), status: "at-risk" }],
    later: [{ milestone: lm(3, "2026-08-01"), status: "on-track" }],
  });
}

describe("MilestoneHorizonStrip chance chip (§502)", () => {
  test("without chances the markup is byte-identical to the pre-chip render (button and span chips)", () => {
    const withButtons = render(<MilestoneHorizonStrip lang="en-US" buckets={fixture()} onOpenMilestone={() => {}} />);
    expect(withButtons.container.innerHTML).toBe(PRE_CHIP_BUTTONS);
    const withSpans = render(<MilestoneHorizonStrip lang="en-US" buckets={fixture()} />);
    expect(withSpans.container.innerHTML).toBe(PRE_CHIP_SPANS);
  });

  test("a chance milestone shows 62% and its name says so, simulated; overdue shows none", () => {
    render(<MilestoneHorizonStrip lang="en-US" buckets={fixture()} chances={new Map([[3, 0.62]])} onOpenMilestone={() => {}} />);
    const chip = screen.getByRole("button", { name: /M3 · 2026-08-01, 62% chance on time, simulated/ });
    expect(chip).toHaveTextContent("62%");
    expect(chip.querySelector("[data-sim-chip]")).not.toBeNull();
    expect(chip.querySelector("[data-sim-chip]")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: /M1/ })).not.toHaveTextContent("%");
    expect(screen.getByRole("button", { name: /M2/ })).not.toHaveTextContent("%");
  });

  test("the chip's name carries every visible word, in order (WCAG 2.5.3 label in name)", () => {
    // Visible: the label, then "62%", then the "sim" badge. Name: "<label>, 62% chance on time,
    // simulated". A speech user saying what they see must hit the name, so each visible piece has to
    // occur in it after the one before; "sim" is the start of "simulated".
    render(<MilestoneHorizonStrip lang="en-US" buckets={fixture()} chances={new Map([[3, 0.62]])} onOpenMilestone={() => {}} />);
    const chip = screen.getByRole("button", { name: /M3/ });
    const name = chip.getAttribute("aria-label")!;
    expect(chip).toHaveTextContent(/M3 · 2026-08-01\s*62%\s*sim/);
    let from = 0;
    for (const piece of ["M3 · 2026-08-01", "62%", "sim"]) {
      const at = name.indexOf(piece, from);
      expect(at, `"${piece}" after index ${from} in "${name}"`).toBeGreaterThanOrEqual(from);
      from = at + piece.length;
    }
    expect(name.startsWith("M3 · 2026-08-01")).toBe(true);
  });

  test("the non-button chip shows the same visible chip with the sentence visually hidden", () => {
    render(<MilestoneHorizonStrip lang="en-US" buckets={fixture()} chances={new Map([[3, 0.62]])} />);
    expect(screen.queryByRole("button")).toBeNull();
    const li = screen.getByText(/M3 · 2026-08-01/).closest("li")!;
    expect(li.querySelector("[data-sim-chip]")).toHaveTextContent("62%");
    expect(li.querySelector(".sr-only")).toHaveTextContent("62% chance on time, simulated");
  });

  test("rows with equal names and dates stay uniquely named with chips on", () => {
    const b = buckets({ later: [
      { milestone: lm(5, "2026-08-01"), status: "on-track" },
      { milestone: { ...lm(6, "2026-08-01"), name: "M5" }, status: "on-track" },
    ] });
    render(<MilestoneHorizonStrip lang="en-US" buckets={b} chances={new Map([[5, 0.4], [6, 0.7]])} onOpenMilestone={() => {}} />);
    const names = screen.getAllByRole("button").map((x) => x.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
  });

  test("simPending puts a placeholder on each linked, not-overdue chip and no percent", () => {
    const { container } = render(<MilestoneHorizonStrip lang="en-US" buckets={fixture()} simPending onOpenMilestone={() => {}} />);
    expect(container.querySelectorAll("[data-sim-placeholder]")).toHaveLength(2);
    expect(container).not.toHaveTextContent("%");
  });

  test("a chance only on a milestone behind the +N more cap draws no chip and no explainer", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ milestone: lm(i + 1, `2026-09-0${i + 1}`), status: "on-track" as const }));
    const explainer = <SimExplainer lang="en-US" kind="milestone" windowDays={60} label="About these chances" />;
    const { container } = render(<MilestoneHorizonStrip lang="en-US" buckets={buckets({ later: six })} chances={new Map([[6, 0.5]])} explainer={explainer} />);
    expect(container.querySelectorAll("[data-sim-chip]")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /About these chances/ })).toBeNull();
  });

  test("the explainer node renders above the buckets only when given and a chip shows", () => {
    const { container, rerender } = render(<MilestoneHorizonStrip lang="en-US" buckets={fixture()} />);
    expect(screen.queryByRole("button", { name: /About these chances/ })).toBeNull();
    rerender(<MilestoneHorizonStrip lang="en-US" buckets={fixture()} chances={new Map([[3, 0.5]])} explainer={<SimExplainer lang="en-US" kind="milestone" windowDays={60} label="About these chances" />} />);
    const btn = screen.getByRole("button", { name: /About these chances/ });
    expect(container.firstElementChild!.firstElementChild!.contains(btn)).toBe(true);
    rerender(<MilestoneHorizonStrip lang="en-US" buckets={fixture()} explainer={<SimExplainer lang="en-US" kind="milestone" windowDays={60} label="About these chances" />} />);
    expect(screen.queryByRole("button", { name: /About these chances/ })).toBeNull();
  });
});

