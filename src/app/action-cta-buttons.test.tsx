// §102 (batch 23, owner decision 2026-10-09): every action CTA is the shared Button.
// The hero's filled verbs are `primary` at `md`; a row's filled verbs are `primary`
// at `xs`; every bordered chip (the second Open, Assign on a row, the popover
// triggers, ⋮ More actions) is `secondary` at `xs`. Each assertion pins the whole
// class string against the primitive's own render.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActionRow } from "./action-row";
import { ActionHeroCard } from "./action-hero-card";
import type { ActionGroup } from "./next-actions/group";
import type { SuggestedAction } from "./next-actions/types";
import { buttonClassFor } from "../test/button-variant";

const openAction: SuggestedAction = {
  id: "raid:12:severity", source: "raid", moduleId: "raid",
  title: { key: "actionRaidTitle", params: [12, "Server down"] },
  why: { key: "actionRaidWhySeverity", params: ["High"] },
  score: 30, tier: "now", cta: { kind: "open", view: "raid", id: 12 },
};
const noOwner: SuggestedAction = {
  ...openAction,
  id: "raid:12:noOwner",
  why: { key: "actionRaidWhyNoOwner", params: [] },
};
const group = (primary: SuggestedAction): ActionGroup =>
  ({ key: "raid:12", primary, extra: [], score: primary.score, tier: primary.tier, extraReasons: [] }) as unknown as ActionGroup;
const escalate = {
  resources: [], onCreateResource: () => 1,
  raid: [{ id: 12, category: "I", title: "X", status: "Open", severity: "High" }], onEscalate: () => {},
} as never;

const primaryMd = () => buttonClassFor({ variant: "primary", size: "md" });
// A row's filled verb keeps a same-colour border so it is as tall as the bordered
// secondary chips beside it (the primary variant draws none).
const primaryXs = () => buttonClassFor({ variant: "primary", size: "xs", className: "border border-ui-dark-blue" });
const secondaryXs = () => buttonClassFor({ variant: "secondary", size: "xs" });

describe("hero card CTAs", () => {
  it("draws the hero's direct verb (Open as the primary) as primary md", () => {
    render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(openAction)} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "Open – Row" }).className).toBe(primaryMd());
  });

  it("draws the hero's popover trigger (Escalate) as primary md and the second Open as secondary xs", () => {
    render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(openAction)} onOpen={() => {}} escalate={escalate} />);
    expect(screen.getByRole("button", { name: "Escalate – Row" }).className).toBe(primaryMd());
    expect(screen.getByRole("button", { name: "Open – Row" }).className).toBe(secondaryXs());
  });

  it("draws the hero's Assign owner as primary md", () => {
    render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(noOwner)} onOpen={() => {}}
      assignOwner={{ resources: [], onCreateResource: () => 1, onAssign: () => {} }} />);
    expect(screen.getByRole("button", { name: /^Assign owner – Row$/ }).className).toBe(primaryMd());
  });
});

describe("row CTAs", () => {
  it("draws a row's direct verb (Open as the primary) as primary xs and ⋮ as secondary xs", () => {
    render(<ActionRow rowToken="Row" lang="en-US" action={openAction} onOpen={() => {}} onSnooze={() => {}} />);
    expect(screen.getByRole("button", { name: "Open – Row" }).className).toBe(primaryXs());
    expect(screen.getByRole("button", { name: "More actions – Row" }).className).toBe(secondaryXs());
  });

  it("draws a row's popover trigger (Escalate) and its second Open as secondary xs", () => {
    render(<ActionRow rowToken="Row" lang="en-US" action={openAction} onOpen={() => {}} escalate={escalate} />);
    expect(screen.getByRole("button", { name: "Escalate – Row" }).className).toBe(secondaryXs());
    expect(screen.getByRole("button", { name: "Open – Row" }).className).toBe(secondaryXs());
  });

  // Mark done and Clear blocker only offer on an Open Points task signal.
  const taskSignal = (whyKey: string): SuggestedAction => ({
    id: "task-attention:5:x", source: "task-attention",
    title: { key: "actionTaskTitle", params: ["T"] },
    why: { key: whyKey, params: [] },
    score: 30, tier: "soon", cta: { kind: "open", view: "open-points", id: 5 },
  } as unknown as SuggestedAction);

  it("draws a row's Mark done as primary xs, as tall as the bordered chips", () => {
    render(<ActionRow rowToken="Row" lang="en-US" action={taskSignal("actionTaskWhyStale")} onOpen={() => {}} onMarkDone={() => {}} />);
    expect(screen.getByRole("button", { name: "Mark done – Row" }).className).toBe(primaryXs());
  });

  it("draws a row's Clear blocker as primary xs", () => {
    render(<ActionRow rowToken="Row" lang="en-US" action={taskSignal("actionTaskWhyBlocked")} onOpen={() => {}} onClearBlocker={() => {}} />);
    expect(screen.getByRole("button", { name: "Clear blocker – Row" }).className).toBe(primaryXs());
  });

  it("draws a row's Draft as primary xs, as tall as the bordered chips", () => {
    const due = {
      id: "task-due:6:overdue", source: "task-due",
      title: { key: "actionTaskTitle", params: ["T"] },
      why: { key: "actionTaskWhyOverdue", params: [2] },
      score: 30, tier: "soon", cta: { kind: "open", view: "open-points", id: 6 },
    } as unknown as SuggestedAction;
    render(<ActionRow rowToken="Row" lang="en-US" action={due} onOpen={() => {}} onDraftMessage={() => {}} />);
    expect(screen.getByRole("button", { name: "Draft message – Row" }).className).toBe(primaryXs());
  });

  it("draws a row's Assign owner as secondary xs", () => {
    render(<ActionRow rowToken="Row" lang="en-US" action={noOwner} onOpen={() => {}}
      assignOwner={{ resources: [], onCreateResource: () => 1, onAssign: () => {} }} />);
    expect(screen.getByRole("button", { name: /^Assign owner – Row$/ }).className).toBe(secondaryXs());
  });
});
