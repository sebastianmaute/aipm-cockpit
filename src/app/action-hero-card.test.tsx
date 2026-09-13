import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionHeroCard } from "./action-hero-card";
import type { ActionGroup } from "./next-actions/group";
import type { SuggestedAction } from "./next-actions/types";

const noOwner: SuggestedAction = {
  id: "raid:12:noowner", source: "raid", moduleId: "raid",
  title: { key: "actionRaidTitle", params: [12, "Vendor API delay"] },
  why: { key: "actionRaidWhyNoOwner", params: ["High"] },
  score: 80, tier: "now", cta: { kind: "open", view: "raid", id: 12 },
} as never;
const group = (primary: SuggestedAction, extra: SuggestedAction[] = []): ActionGroup =>
  ({ key: "raid:12", primary, extra, score: primary.score, tier: primary.tier });

describe("ActionHeroCard", () => {
  it("renders the eyebrow, untruncated title + why, and an Open button", () => {
    render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(noOwner)} onOpen={() => {}} />);
    expect(screen.getByText(/Do this first/i)).toBeInTheDocument();
    expect(screen.getByText(/Vendor API delay/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open – Row" })).toBeInTheDocument();
  });
  it("offers Log as RAID in the hero's overflow for a non-RAID signal (§515)", () => {
    const slip = {
      ...noOwner, id: "milestone:4:atrisk", source: "milestone",
      why: { key: "actionMilestoneWhyAtRisk" }, cta: { kind: "open", view: "milestones", id: 4 },
    } as never as SuggestedAction;
    const onLogAsRaid = vi.fn();
    render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(slip)} onOpen={() => {}} onLogAsRaid={onLogAsRaid} />);
    fireEvent.click(screen.getByRole("button", { name: /^More actions – Row$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Log as RAID" }));
    expect(onLogAsRaid).toHaveBeenCalledWith(slip);
  });
  it("promotes the assign verb when the bundle is wired", () => {
    render(
      <ActionHeroCard rowToken="Row" lang="en-US" group={group(noOwner)} onOpen={() => {}}
        assignOwner={{ resources: [], onCreateResource: () => 1, onAssign: vi.fn() }} />,
    );
    expect(screen.getByRole("button", { name: /assign owner/i })).toBeInTheDocument();
  });
  it("renders extra reasons when present", () => {
    const extra = [{ ...noOwner, id: "raid:12:severity", why: { key: "actionRaidWhySeverity", params: ["High"] } }] as never;
    render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(noOwner, extra)} onOpen={() => {}} />);
    // extra has 1 item -> the singular form ("+1 more reason", not "+1 more reasons").
    const toggle = screen.getByRole("button", { name: /1 more reason\b/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
  it("snoozes the hero with every other id in its group", () => {
    const extra = [
      { ...noOwner, id: "raid:12:severity" },
      { ...noOwner, id: "raid:12:stale" },
    ] as never;
    const onSnooze = vi.fn();
    render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(noOwner, extra)} onOpen={() => {}} onSnooze={onSnooze} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions – Row" }));
    fireEvent.click(screen.getByRole("button", { name: "1 hour" }));
    expect(onSnooze).toHaveBeenCalledTimes(1);
    expect(onSnooze.mock.calls[0][0]).toBe(noOwner);
    expect(onSnooze.mock.calls[0][2]).toEqual(["raid:12:severity", "raid:12:stale"]);
  });
  it("carries the tier RAG stripe (now → red) and a labelled section", () => {
    const { container } = render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(noOwner)} onOpen={() => {}} />);
    expect(container.querySelector(".border-l-\\[var\\(--rag-red\\)\\]")).toBeTruthy();
    expect(screen.getByRole("region", { name: /Do this first/i })).toBeInTheDocument();
  });
  it("renders the hero's popover primary (escalate) as a prominent filled trigger", () => {
    const severity = { ...noOwner, id: "raid:12:severity", why: { key: "actionRaidWhySeverity", params: ["High"] } } as never;
    const escalate = { resources: [], onCreateResource: () => 1,
      raid: [{ id: 12, category: "I", title: "X", status: "Open", severity: "High" }], onEscalate: () => {} } as never;
    render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(severity)} onOpen={() => {}} escalate={escalate} />);
    expect(screen.getByRole("button", { name: /^Escalate – Row$/ }).className).toMatch(/bg-ui-dark-blue/);
  });
  it("renders the hero's assign trigger as a prominent filled button", () => {
    render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(noOwner)} onOpen={() => {}}
      assignOwner={{ resources: [], onCreateResource: () => 1, onAssign: () => {} }} />);
    expect(screen.getByRole("button", { name: /assign owner/i }).className).toMatch(/bg-ui-dark-blue/);
  });
  it("shows the learning surfaced/demoted hint when the action moved", () => {
    const surfaced = { ...noOwner, learning: { bias: 12, moved: "up" as const } };
    const { rerender } = render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(surfaced)} onOpen={() => {}} />);
    expect(screen.getByText(/surfaced/i)).toBeInTheDocument();
    const demoted = { ...noOwner, learning: { bias: -12, moved: "down" as const } };
    rerender(<ActionHeroCard rowToken="Row" lang="en-US" group={group(demoted)} onOpen={() => {}} />);
    expect(screen.getByText(/demoted/i)).toBeInTheDocument();
  });
});
