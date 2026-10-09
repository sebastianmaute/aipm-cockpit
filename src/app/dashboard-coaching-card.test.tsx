import { beforeAll, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardCoachingCard } from "./dashboard-coaching-card";
import { computeCoaching, type CoachingCta } from "./dashboard-coaching";
import { loadI18n, t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { buttonClassFor } from "../test/button-variant";

const CTAS: CoachingCta[] = [
  { key: "task", labelKey: "coachingAddTask", view: "open-points" },
  { key: "ai", labelKey: "coachingConfigureAi", view: "settings", section: "ai" },
];

describe("DashboardCoachingCard", () => {
  test("renders nothing when ctas is empty", () => {
    const { container } = render(<DashboardCoachingCard lang="en-US" ctas={[]} onNavigate={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  test("renders the title and a button per CTA", () => {
    render(<DashboardCoachingCard lang="en-US" ctas={CTAS} onNavigate={() => {}} />);
    expect(screen.getByText("Get started")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add your first task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure AI assistant" })).toBeInTheDocument();
  });

  test("clicking a CTA navigates to its view and section", () => {
    const onNavigate = vi.fn();
    render(<DashboardCoachingCard lang="en-US" ctas={CTAS} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Configure AI assistant" }));
    expect(onNavigate).toHaveBeenCalledWith("settings", "ai");
  });

  test("a section-less CTA navigates with an undefined section", () => {
    const onNavigate = vi.fn();
    render(<DashboardCoachingCard lang="en-US" ctas={CTAS} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Add your first task" }));
    expect(onNavigate).toHaveBeenCalledWith("open-points", undefined);
  });

  test("card root opts into the shadow-card token (no-op under the no-structural-override fallback)", () => {
    const { container } = render(<DashboardCoachingCard lang="en-US" ctas={CTAS} onNavigate={() => {}} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className.includes("shadow-[var(--shadow-card)]")).toBe(true);
  });
});

describe("DashboardCoachingCard — every CTA has its own name (§672)", () => {
  beforeAll(() => loadI18n("de"));

  // Each CTA button is named by its translated label. The fullest set the engine can return is
  // built from `computeCoaching` rather than a fixture, so a new CTA worded like an existing one
  // fails here.
  const ALL = computeCoaching({ taskCount: 0, milestoneCount: 0, budgetCount: 0, showMilestones: true, showBudget: true, aiConfigured: false });

  // Without the German dictionary the de case would silently re-run en-US, so pin that it loaded.
  test("renders real German for the de case", () => {
    expect(t("de", "coachingAddTask")).not.toBe(t("en-US", "coachingAddTask"));
  });

  test.each(["en-US", "de"] as const)("names every CTA distinctly in %s", (lang) => {
    expect(ALL).toHaveLength(4);
    render(<DashboardCoachingCard lang={lang} ctas={ALL} onNavigate={() => {}} />);
    expectRowUniqueNames({ minControls: ALL.length });
  });
});

// §102 (batch 23, owner decision 2026-10-09): the near-size buttons moved to the shared `xs`.
describe("DashboardCoachingCard CTAs on the shared Button", () => {
  test("draws each CTA as secondary xs", () => {
    render(<DashboardCoachingCard lang="en-US" ctas={CTAS} onNavigate={() => {}} />);
    expect(screen.getByRole("button", { name: t("en-US", "coachingAddTask") }).className).toBe(
      buttonClassFor({ variant: "secondary", size: "xs" }),
    );
  });
});
