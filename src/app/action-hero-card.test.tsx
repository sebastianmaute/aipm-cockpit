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
    render(<ActionHeroCard lang="en-US" group={group(noOwner)} onOpen={() => {}} />);
    expect(screen.getByText(/Do this first/i)).toBeInTheDocument();
    expect(screen.getByText(/Vendor API delay/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });
  it("promotes the assign verb when the bundle is wired", () => {
    render(
      <ActionHeroCard lang="en-US" group={group(noOwner)} onOpen={() => {}}
        assignOwner={{ resources: [], onCreateResource: () => 1, onAssign: vi.fn() }} />,
    );
    expect(screen.getByRole("button", { name: /assign owner/i })).toBeInTheDocument();
  });
  it("renders extra reasons when present", () => {
    const extra = [{ ...noOwner, id: "raid:12:severity", why: { key: "actionRaidWhySeverity", params: ["High"] } }] as never;
    render(<ActionHeroCard lang="en-US" group={group(noOwner, extra)} onOpen={() => {}} />);
    const toggle = screen.getByRole("button", { name: /1 more reasons/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
  it("carries the tier RAG stripe (now → red) and a labelled section", () => {
    const { container } = render(<ActionHeroCard lang="en-US" group={group(noOwner)} onOpen={() => {}} />);
    expect(container.querySelector(".border-l-\\[var\\(--rag-red\\)\\]")).toBeTruthy();
    expect(screen.getByRole("region", { name: /Do this first/i })).toBeInTheDocument();
  });
});
