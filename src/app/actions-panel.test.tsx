import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "./i18n";
import { ActionsPanel } from "./actions-panel";
import type { SuggestedAction } from "./next-actions/types";
import type { ActionAnalysis } from "./action-ai";
import { expectRowUniqueNames } from "../test/row-unique-names";

const mk = (id: string, tier: SuggestedAction["tier"]): SuggestedAction => ({
  id, source: "raid", moduleId: "raid",
  title: { key: "actionRaidTitle", params: [1, id] },
  why: { key: "actionRaidWhySeverity", params: ["High"] },
  score: tier === "now" ? 60 : tier === "soon" ? 30 : 10, tier,
  cta: { kind: "open", view: "raid", id },
});

describe("ActionsPanel", () => {
  it("promotes the top group to a hero and renders remaining tiers", () => {
    // a(now,60) becomes the hero; b(soon,30) renders in Soon. Now has no remainder.
    const { getByRole, getByText, queryByText } = render(
      <ActionsPanel lang="en-US" actions={[mk("a", "now"), mk("b", "soon")]} onOpen={() => {}} />,
    );
    expect(getByRole("region", { name: /Do this first/i })).toBeTruthy(); // hero present
    expect(getByText(/^Soon/)).toBeTruthy();
    expect(queryByText(/^Monitor/)).toBeNull();
  });
  it("shows the empty state when there are no actions", () => {
    const { getByText } = render(<ActionsPanel lang="en-US" actions={[]} onOpen={() => {}} />);
    expect(getByText(/all caught up/i)).toBeTruthy();
  });

  it("collapses multiple signals on one entity into a single row", () => {
    const base = {
      source: "raid", moduleId: "raid", score: 70, tier: "now",
      cta: { kind: "open", view: "raid", id: 1 },
    };
    const actions = [
      { ...base, id: "r1", title: { key: "actionRaidTitle", params: [1, "r1"] }, why: { key: "actionRaidWhySeverity", params: ["High"] } },
      { ...base, id: "r2", score: 40, title: { key: "actionRaidTitle", params: [1, "r2"] }, why: { key: "actionRaidWhyNoOwner" } },
    ] as never;
    render(<ActionsPanel lang="en-US" actions={actions} onOpen={() => {}} />);
    expect(screen.getAllByText("Open")).toHaveLength(1); // one row
    // The reasons container is always mounted (just `hidden`); expansion flips aria-expanded.
    const toggle = screen.getByRole("button", { name: /1 more reasons/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = document.getElementById("action-reasons-r1"); // group keyed off primary r1
    expect(list?.hidden).toBe(false);
    expect(list?.textContent ?? "").toMatch(/owner/i); // r2 used actionRaidWhyNoOwner
  });

  it("caps the now tier under the hero and reveals the rest via show-more", async () => {
    const user = userEvent.setup();
    const actions = Array.from({ length: 7 }, (_, i) => ({
      id: `n${i}`, source: "raid", moduleId: "raid",
      title: { key: "actionRaidTitle", params: [1, `n${i}`] },
      why: { key: "actionRaidWhySeverity", params: ["High"] },
      score: 70 - i, tier: "now",
      cta: { kind: "open", view: "raid", id: i },
    })) as never;
    render(<ActionsPanel lang="en-US" actions={actions} onOpen={() => {}} />);
    // n0 → hero (1 Open). Remaining 6 in Now, capped at 5 → 5 Opens. Total 6.
    expect(screen.getAllByText("Open")).toHaveLength(6);
    const more = screen.getByRole("button", { name: /show 1 more/i });
    await user.click(more);
    expect(screen.getAllByText("Open")).toHaveLength(7); // hero + all 6
    expect(screen.getByRole("button", { name: /show less/i })).toBeTruthy();
  });

  it("sorts soon-tier rows by score descending", () => {
    const soon = (id: string, score: number): SuggestedAction => ({
      id, source: "raid", moduleId: "raid",
      title: { key: "actionRaidTitle", params: [1, id] },
      why: { key: "actionRaidWhySeverity", params: ["High"] },
      score, tier: "soon",
      cta: { kind: "open", view: "raid", id },
    });
    // Supplied in non-descending score order.
    const actions = [soon("low", 10), soon("mid", 30), soon("high", 50)];
    render(<ActionsPanel lang="en-US" actions={actions} onOpen={() => {}} />);
    const order = screen
      .getAllByText(/^RAID 1:/)
      .map((el) => el.textContent ?? "");
    const idxHigh = order.findIndex((t) => t.includes("high"));
    const idxMid = order.findIndex((t) => t.includes("mid"));
    const idxLow = order.findIndex((t) => t.includes("low"));
    expect(idxHigh).toBeLessThan(idxMid);
    expect(idxMid).toBeLessThan(idxLow);
  });

  it("collapses the monitor group by default and toggles it", () => {
    const actions = [
      { id: "m1", source: "budget", title: { key: "actionBudgetTitle", params: ["P"] },
        why: { key: "actionBudgetWhyCpi", params: ["0.8"] }, score: 10, tier: "monitor",
        cta: { kind: "open", view: "budget", id: 0 } },
    ] as never;
    render(<ActionsPanel lang="en-US" actions={actions} onOpen={() => {}} />);
    const toggle = screen.getByRole("button", { name: /monitored/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("action-monitor-list")).toHaveAttribute("hidden"); // row hidden while collapsed
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("action-monitor-list")).not.toHaveAttribute("hidden");
  });

  it("does not promote a monitor-only top group to a hero", () => {
    const actions = [
      { id: "m1", source: "budget", title: { key: "actionBudgetTitle", params: ["P"] },
        why: { key: "actionBudgetWhyCpi", params: ["0.8"] }, score: 10, tier: "monitor",
        cta: { kind: "open", view: "budget", id: 0 } },
    ] as never;
    render(<ActionsPanel lang="en-US" actions={actions} onOpen={() => {}} />);
    expect(screen.queryByRole("region", { name: /Do this first/i })).toBeNull();
    expect(screen.getByRole("button", { name: /monitored/i })).toBeTruthy();
  });

  // §324. THREE "now" actions with the SAME title and the SAME score: one becomes
  // the hero, the other two render as Now rows. Every control across them (the
  // score tooltip, Open, the ⋮ overflow) used to compute its name from a value
  // all three share. The cta ids differ so `groupNextActions` keeps them as three
  // groups instead of collapsing them onto one entity.
  //
  // ★★ THREE, NOT TWO, AND THAT IS LOAD-BEARING — measured, not reasoned. With a
  //    hero plus ONE row, removing `action-row.tsx`'s label alone leaves that row
  //    announcing the bare "Score: 60" while the hero stays qualified: the two
  //    names DIFFER, no name is shared, and the duplicate-name assertion below
  //    passes against the mutant. A second row gives the row-level mutant a
  //    row-vs-row collision to produce, so it goes red.
  // ★★★ THE HERO IS A SINGLETON, so NO duplicate-name assertion can ever kill a
  //    hero-only mutant — a bare hero name collides with nothing. That half is
  //    pinned by the second assertion instead, which is why both are here and why
  //    neither is redundant. Deleting either leaves a real mutant alive.
  // ★ Whole-document scope on purpose: the panel's own chrome (Print, reset-size,
  //   the learning pill) must not collide with the rows either, and there is no
  //   confirmed chrome collision to dodge by narrowing.
  // ★ `InfoTooltip`'s trigger is a `<span role="button">`, so the default
  //   `["button"]` roles list picks it up alongside the real buttons.
  const sharedTitleAndScore = () =>
    (["s1", "s2", "s3"] as const).map((id) => ({
      id, source: "raid", moduleId: "raid",
      title: { key: "actionRaidTitle", params: [1, "Shared"] },
      why: { key: "actionRaidWhySeverity", params: ["High"] },
      score: 60, tier: "now",
      cta: { kind: "open", view: "raid", id },
    })) as unknown as SuggestedAction[];

  it("gives every control a row-unique name when actions share a title and score (§324)", () => {
    render(
      <ActionsPanel lang="en-US" actions={sharedTitleAndScore()} onOpen={() => {}} expertMode />,
    );
    // minControls is the MEASURED count for this fixture: 3 score tooltips +
    // 3 Open buttons + the learning pill + Print + reset-size. Keeping it exact
    // is the only automatic guard against a silently narrowed `roles` list.
    expectRowUniqueNames({ minControls: 9, roles: ["button"], requireCollisionSeed: true });
    // ★ The needle is DERIVED from i18n, not spelled out: hardcoding "Score: 60"
    //   would keep passing if the key's value changed underneath it.
    const bareScoreName = t("en-US", "actionScoreTooltip", 60);
    expect(screen.queryAllByRole("button", { name: bareScoreName })).toHaveLength(0);
  });

  describe("AI analysis section", () => {
    const mkAi = () => ({
      enabled: true,
      busy: false,
      error: null as string | null,
      result: null as ActionAnalysis | null,
      onAnalyze: vi.fn(),
      onCancel: vi.fn(),
      onClear: vi.fn(),
      onActAi: vi.fn(),
    });
    const baseAi = (over: Partial<ReturnType<typeof mkAi>> = {}) => ({ ...mkAi(), ...over });

    it("hides the Analyze button when aiAnalysis is absent or disabled", () => {
      const { rerender } = render(<ActionsPanel lang="en-US" actions={[]} onOpen={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /Analyze with AI/i })).toBeNull();
      rerender(
        <ActionsPanel lang="en-US" actions={[]} onOpen={vi.fn()} aiAnalysis={baseAi({ enabled: false })} />,
      );
      expect(screen.queryByRole("button", { name: /Analyze with AI/i })).toBeNull();
    });

    it("shows the button when enabled and calls onAnalyze on click", async () => {
      const ai = baseAi();
      render(<ActionsPanel lang="en-US" actions={[]} onOpen={vi.fn()} aiAnalysis={ai} />);
      await userEvent.click(screen.getByRole("button", { name: /Analyze with AI/i }));
      expect(ai.onAnalyze).toHaveBeenCalled();
    });

    it("shows a blocking loading modal while busy and Cancel aborts the call", async () => {
      const ai = baseAi({ busy: true });
      render(<ActionsPanel lang="en-US" actions={[]} onOpen={vi.fn()} aiAnalysis={ai} />);
      expect(screen.getByRole("status")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /Cancel/i }));
      expect(ai.onCancel).toHaveBeenCalled();
    });

    it("renders the AI section with summary + rows and a dismiss control", async () => {
      const result: ActionAnalysis = {
        summary: "Focus on M2.",
        actions: [
          { title: "Unblock M2", why: "blocked", severity: "now", entity: { view: "milestones", id: "2" } },
        ],
      };
      const ai = baseAi({ result });
      render(<ActionsPanel lang="en-US" actions={[]} onOpen={vi.fn()} aiAnalysis={ai} />);
      expect(screen.getByText("Focus on M2.")).toBeInTheDocument();
      expect(screen.getByText("Unblock M2")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /Dismiss AI suggestions/i }));
      expect(ai.onClear).toHaveBeenCalled();
    });

    it("shows a status-only error when present", () => {
      render(
        <ActionsPanel lang="en-US" actions={[]} onOpen={vi.fn()} aiAnalysis={baseAi({ error: "429" })} />,
      );
      expect(screen.getByText(/429/)).toBeInTheDocument();
    });

    it("shows the network message for a network error", () => {
      render(
        <ActionsPanel lang="en-US" actions={[]} onOpen={vi.fn()} aiAnalysis={baseAi({ error: "network" })} />,
      );
      expect(screen.getByText(/network/i)).toBeInTheDocument();
    });

    it("shows the generic message for a non-status, non-network error", () => {
      render(
        <ActionsPanel lang="en-US" actions={[]} onOpen={vi.fn()} aiAnalysis={baseAi({ error: "parse" })} />,
      );
      expect(screen.getByText(/Couldn't analyze/i)).toBeInTheDocument();
    });
  });

  describe("learning status pill (expert-only)", () => {
    it("renders 'Learning is ON' with an ON pill when expert and enabled", () => {
      render(
        <ActionsPanel lang="en-US" actions={[]} onOpen={() => {}} expertMode learningEnabled />,
      );
      const pill = screen.getByRole("button", { name: /open next-actions settings/i });
      expect(pill.textContent).toMatch(/Learning is/);
      expect(pill.textContent).toMatch(/ON$/);
    });

    it("renders 'Learning is OFF' when expert and disabled", () => {
      render(
        <ActionsPanel
          lang="en-US"
          actions={[]}
          onOpen={() => {}}
          expertMode
          learningEnabled={false}
        />,
      );
      const pill = screen.getByRole("button", { name: /open next-actions settings/i });
      expect(pill.textContent).toMatch(/Learning is/);
      expect(pill.textContent).toMatch(/OFF$/);
    });

    it("does not render the pill when not in expert mode", () => {
      render(
        <ActionsPanel
          lang="en-US"
          actions={[]}
          onOpen={() => {}}
          expertMode={false}
          learningEnabled
        />,
      );
      expect(
        screen.queryByRole("button", { name: /open next-actions settings/i }),
      ).toBeNull();
    });

    it("calls onOpenLearningSettings when the pill is clicked", () => {
      let opened = 0;
      render(
        <ActionsPanel
          lang="en-US"
          actions={[]}
          onOpen={() => {}}
          expertMode
          learningEnabled
          onOpenLearningSettings={() => {
            opened += 1;
          }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /open next-actions settings/i }));
      expect(opened).toBe(1);
    });
  });
});
