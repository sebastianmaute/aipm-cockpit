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
  // ★ `InfoTooltip`'s trigger is a `<span role="button">`, so the requested
  //   `["button"]` role picks it up alongside the real buttons.
  // ★ Built on `mk()` so the shared title is visibly the ONE thing overridden,
  //   and so the fixture stays type-checked: an `as unknown as SuggestedAction[]`
  //   cast would silently rot if the type gained or renamed a field.
  //   (Typed as the field rather than `as const`: a readonly tuple from `as const`
  //   is not assignable to the mutable `params`, and widening it with a cast would
  //   reintroduce exactly the unchecked fixture this rebuild removes.)
  const SHARED_TITLE: SuggestedAction["title"] = { key: "actionRaidTitle", params: [1, "Shared"] };
  const sharedTitleAndScore = (): SuggestedAction[] =>
    ["s1", "s2", "s3"].map((id) => ({ ...mk(id, "now"), title: { ...SHARED_TITLE } }));

  // ★ Named for what the fixture actually renders. An `onOpen`-only panel builds
  //   no overflow menu, no reasons disclosure, no verb buttons and no popover
  //   triggers, so this covers the score tooltips and the Open buttons — NOT
  //   "every control", which an earlier name claimed.
  it("gives the score tooltips and Open buttons row-unique names when actions share a title and score (§324)", () => {
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

  // §324, the OTHER half: the panel must mint ONE token map spanning the hero and
  // every tier, not one per surface and not one per tier.
  //
  // ★★★ THE FIXTURE ABOVE CANNOT PIN THIS, which is why this test exists rather
  //    than being folded into it. `buildRowTokens` numbers a name only when it
  //    REPEATS inside the map it was handed, so a map with ONE member emits a
  //    BARE token — never "(1)". With three colliding actions, splitting the map
  //    leaves the hero alone (bare) and the two rows together (numbered), so no
  //    two names match and a split survives undetected. Measured, not reasoned.
  // ★★ THIS fixture is built so that both REAL split-the-map mutants collide:
  //    exactly ONE hero and exactly ONE row, sharing a title, in DIFFERENT tiers.
  //    Split hero-vs-rows and each map holds one member; split per-tier and each
  //    map holds one member. Either way both tokens come out bare and the two
  //    Open buttons share a name. Both measured RED here.
  // ★★ THE TOOLTIPS DO NOT BACKSTOP THAT, and an earlier revision of this comment
  //    claimed they did. `mk()` gives the hero 60 and the Soon row 30, and
  //    `actionScoreTooltip` interpolates the score, so the two tooltip names
  //    differ at ANY token value — under either mutant and under correct code
  //    alike. The two Open buttons alone kill both mutants and alone satisfy
  //    `requireCollisionSeed`. Do not read this fixture as covering the tooltips.
  // ★★★ ONE MUTANT SURVIVES THIS AND THAT IS CORRECT, NOT A GAP — do not "fix"
  //    the fixture to chase it. Splitting the hero's map ALONE while the rows
  //    keep the full map is unkillable by ANY duplicate-name assertion, and the
  //    reason is structural: the hero's own entry is what pushes the shared
  //    name's count above 1, so every colliding ROW is still numbered. The hero
  //    comes out bare ("… Shared") and the rows numbered ("… Shared (2)") —
  //    different strings, so nothing collides and there is no 2.4.6 defect to
  //    detect. It is a consistency wart (a "(2)" with no visible "(1)"), which
  //    is a different claim from the one this file makes.
  // ★ Scores differ so the GROUP ORDERING out of `groupNextActions` (score desc,
  //   then key asc) is deterministic, which is what fixes WHICH group becomes the
  //   hero — the tier itself is a fixture literal, not a consequence of the score.
  //   `mk()` already yields 60 for "now" and 30 for "soon": the 60 sorts first and
  //   becomes the hero, the 30 renders as the lone Soon row.
  const heroAndCrossTierRowSharingTitle = (): SuggestedAction[] =>
    [mk("h1", "now"), mk("r1", "soon")].map((a) => ({ ...a, title: { ...SHARED_TITLE } }));

  it("keeps the hero and a cross-tier row in one naming population (§324)", () => {
    render(
      <ActionsPanel
        lang="en-US"
        actions={heroAndCrossTierRowSharingTitle()}
        onOpen={() => {}}
        expertMode
      />,
    );
    // MEASURED for this fixture: 2 score tooltips + 2 Open buttons + the learning
    // pill + Print + reset-size. Exact, so a narrowed `roles` cannot slip back in.
    expectRowUniqueNames({ minControls: 7, roles: ["button"], requireCollisionSeed: true });
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

    // §328 — every AI row's "Open"/"Discuss in chat" button used to qualify
    // itself with the RAW `action.title`, which is model-generated FREE TEXT and
    // can repeat. Two collisions were live at once:
    //   · WITHIN the AI list — two AI actions sharing a title. That the title is
    //     not unique is already conceded by the list key, `${a.title}:${i}`.
    //   · ACROSS lists — `aiAnalysis?.result` and `groups.length` are gated
    //     INDEPENDENTLY and render simultaneously, so an AI action titled like a
    //     group row produced two identical "Open – <title>" names.
    //
    // ★★★ THE FIXTURE IS BUILT TO KILL BOTH HALVES OF THE FIX, and each half is
    //    killed by a DIFFERENT one of the three AI rows — measured, not reasoned:
    //      · Drop the TOKEN (name = verb + section only) and the two "Duplicate"
    //        rows share a name.
    //      · Drop the SECTION segment and the third AI row — whose title equals
    //        the group's, and which is ALONE in the AI token map under that
    //        title, so its token comes out BARE — collides with the hero's Open.
    //    Neither row alone covers both: with only the "Duplicate" pair, dropping
    //    the section leaves them numbered "(1)"/"(2)" and nothing collides.
    // ★ The group's lone action becomes the HERO (`groups[0]`, tier !== monitor),
    //   so the cross-list pair is hero-Open vs AI-Open. `expertMode` is off, so
    //   no score tooltips render and the Open buttons carry the whole assertion.
    it("gives every AI row a name unique within the AI list and against the group list (§328)", () => {
      const groupTitle = t("en-US", "actionRaidTitle", 1, "Shared");
      const result: ActionAnalysis = {
        summary: "",
        actions: [
          { title: "Duplicate AI action", why: "a", severity: "now", entity: { view: "raid", id: "1" } },
          { title: "Duplicate AI action", why: "b", severity: "now", entity: { view: "raid", id: "2" } },
          { title: groupTitle, why: "c", severity: "now", entity: { view: "raid", id: "3" } },
        ],
      };
      render(
        <ActionsPanel
          lang="en-US"
          actions={[{ ...mk("g1", "now"), title: { ...SHARED_TITLE } }]}
          onOpen={() => {}}
          aiAnalysis={baseAi({ result })}
        />,
      );
      // MEASURED for this fixture: 3 AI row buttons + the AI dismiss + the hero's
      // Open + Analyze with AI + Print + reset-size. Exact, so a silently
      // narrowed `roles` list cannot slip back in.
      expectRowUniqueNames({ minControls: 8, roles: ["button"], requireCollisionSeed: true });
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
