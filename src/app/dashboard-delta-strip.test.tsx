import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardDeltaStrip } from "./dashboard-delta-strip";
import type { DeltaResult } from "./dashboard-delta";

function emptyCounts() {
  const z = () => ({ created: 0, updated: 0, completed: 0, statusChanged: 0 });
  return { tasks: z(), raid: z(), milestone: z(), change: z() };
}
function delta(over: Partial<DeltaResult> = {}): DeltaResult {
  return { isFirstVisit: false, since: "2026-06-20T00:00:00.000Z", counts: emptyCounts(), newOverdue: [], ragFlips: [], total: 0, ...over };
}

describe("DashboardDeltaStrip", () => {
  test("first visit → welcome copy, no chips", () => {
    render(<DashboardDeltaStrip lang="en-US" delta={delta({ isFirstVisit: true, total: 0 })} greeting={{ greetingKey: "dashboardGreetingMorning", summary: { needsYou: 0, milestonesSoon: 0 } }} />);
    expect(screen.getByText(/Welcome/i)).toBeInTheDocument();
  });

  test("suppresses the greeting summary when nothing needs the user (blank project)", () => {
    render(<DashboardDeltaStrip lang="en-US" delta={delta({ isFirstVisit: true, total: 0 })} greeting={{ greetingKey: "dashboardGreetingMorning", summary: { needsYou: 0, milestonesSoon: 0 } }} />);
    expect(screen.queryByText(/items need you/i)).toBeNull();
  });

  test("shows the greeting summary when there is something to surface", () => {
    render(<DashboardDeltaStrip lang="en-US" delta={delta({ total: 0 })} greeting={{ greetingKey: "dashboardGreetingMorning", summary: { needsYou: 2, milestonesSoon: 1 } }} />);
    expect(screen.getByText(/2 items need you/i)).toBeInTheDocument();
  });

  test("zero delta (returning) → all caught up", () => {
    render(<DashboardDeltaStrip lang="en-US" delta={delta({ total: 0 })} greeting={{ greetingKey: "dashboardGreetingAfternoon", summary: { needsYou: 0, milestonesSoon: 0 } }} />);
    expect(screen.getByText(/All caught up/i)).toBeInTheDocument();
  });

  test("strip root opts into the shadow-card token (no-op under AIPM)", () => {
    const { container } = render(<DashboardDeltaStrip lang="en-US" delta={delta({ total: 0 })} greeting={{ greetingKey: "dashboardGreetingMorning", summary: { needsYou: 0, milestonesSoon: 0 } }} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className.includes("shadow-[var(--shadow-card)]")).toBe(true);
  });

  test("renders a task-updated chip and routes its click", () => {
    const onOpenTask = vi.fn();
    const counts = emptyCounts(); counts.tasks.updated = 4;
    render(<DashboardDeltaStrip lang="en-US" delta={delta({ counts, total: 4 })} greeting={{ greetingKey: "dashboardGreetingMorning", summary: { needsYou: 1, milestonesSoon: 0 } }} onOpenTask={onOpenTask} />);
    const chip = screen.getByRole("button", { name: /4 tasks updated/i });
    fireEvent.click(chip);
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  });

  test("task chip is non-interactive text (not a button) when no handler is wired", () => {
    const counts = emptyCounts(); counts.tasks.updated = 4;
    render(<DashboardDeltaStrip lang="en-US" delta={delta({ counts, total: 4 })} greeting={{ greetingKey: "dashboardGreetingMorning", summary: { needsYou: 0, milestonesSoon: 0 } }} />);
    // No onOpenTask → the chip renders as a span, never a dead button.
    expect(screen.queryByRole("button", { name: /4 tasks updated/i })).toBeNull();
    expect(screen.getByText(/4 tasks updated/i)).toBeInTheDocument();
  });

  test("renders a RAG flip label (non-interactive)", () => {
    render(<DashboardDeltaStrip lang="en-US" delta={delta({ ragFlips: [{ scope: "schedule", from: "G", to: "A", worsened: true }], total: 1 })} greeting={{ greetingKey: "dashboardGreetingMorning", summary: { needsYou: 0, milestonesSoon: 0 } }} />);
    expect(screen.getByText(/→/)).toBeInTheDocument();
  });
});
