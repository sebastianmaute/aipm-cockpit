import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardCoachingCard } from "./dashboard-coaching-card";
import type { CoachingCta } from "./dashboard-coaching";

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

  test("card root opts into the shadow-card token (no-op under AIPM)", () => {
    const { container } = render(<DashboardCoachingCard lang="en-US" ctas={CTAS} onNavigate={() => {}} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className.includes("shadow-[var(--shadow-card)]")).toBe(true);
  });
});
