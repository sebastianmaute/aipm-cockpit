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
const primaryXs = () => buttonClassFor({ variant: "primary", size: "xs" });
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

  it("draws a row's Assign owner as secondary xs", () => {
    render(<ActionRow rowToken="Row" lang="en-US" action={noOwner} onOpen={() => {}}
      assignOwner={{ resources: [], onCreateResource: () => 1, onAssign: () => {} }} />);
    expect(screen.getByRole("button", { name: /^Assign owner – Row$/ }).className).toBe(secondaryXs());
  });
});
