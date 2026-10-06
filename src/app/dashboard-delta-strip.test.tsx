import { beforeAll, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardDeltaStrip } from "./dashboard-delta-strip";
import type { DeltaResult } from "./dashboard-delta";
import type { Task } from "./types";
import { loadI18n, t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

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

  test("strip root opts into the shadow-card token (no-op under the no-structural-override fallback)", () => {
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
describe("DashboardDeltaStrip — every chip has its own name (§672)", () => {
  beforeAll(() => loadI18n("de"));

  // Each clickable chip is named by its label, which carries a count. Every chip is given the SAME
  // count here, so only the wording of each label can keep two chips apart; four of the seven open
  // the same view, so nothing else would distinguish them for a screen-reader user.
  const N = 3;
  function allChips(): DeltaResult {
    const counts = emptyCounts();
    counts.tasks.created = N; counts.tasks.updated = N; counts.tasks.completed = N;
    counts.raid.created = N; counts.milestone.created = N; counts.change.created = N;
    return delta({ counts, newOverdue: Array.from({ length: N }, () => ({}) as Task), total: 6 * N });
  }

  // Without the German dictionary the de case would silently re-run en-US, so pin that it loaded.
  test("renders real German for the de case", () => {
    expect(t("de", "dashboardDeltaTasksCreated", "3")).not.toBe(t("en-US", "dashboardDeltaTasksCreated", "3"));
  });

  test.each(["en-US", "de"] as const)("names every chip distinctly in %s", (lang) => {
    render(<DashboardDeltaStrip lang={lang} delta={allChips()} greeting={{ greetingKey: "dashboardGreetingMorning", summary: { needsYou: 0, milestonesSoon: 0 } }} onOpenTask={vi.fn()} onOpenRaid={vi.fn()} onOpenMilestone={vi.fn()} onOpenChange={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(7);
    expectRowUniqueNames({ minControls: 7 });
  });
});
