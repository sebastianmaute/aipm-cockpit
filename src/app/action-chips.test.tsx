import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ActionChips, chipsActionableOnView, chipsForView } from "./action-chips";
import type { SuggestedAction } from "./next-actions/types";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { buttonClassFor } from "../test/button-variant";

function mk(id: string, tier: SuggestedAction["tier"]): SuggestedAction {
  return {
    id, source: "raid", moduleId: "raid",
    title: { key: "actionRaidTitle", params: [1, `Item ${id}`] },
    why: { key: "actionRaidWhySeverity", params: ["Critical"] },
    score: 50, tier, cta: { kind: "open", view: "raid", id: 1 },
  };
}

describe("chipsForView", () => {
  it("keeps only open-CTA actions whose cta.view matches", () => {
    const a: SuggestedAction = { ...mk("a", "now"), cta: { kind: "open", view: "raid", id: 1 } };
    const b: SuggestedAction = { ...mk("b", "now"), cta: { kind: "open", view: "budget", id: 0 } };
    expect(chipsForView([a, b], "raid")).toEqual([a]);
  });

  it("surfaces an open-tasks-for action on the Open Points strip only", () => {
    const tasksFor: SuggestedAction = {
      id: "workload:7:overload", source: "workload",
      title: { key: "actionWorkloadTitle", params: ["Bo"] },
      why: { key: "actionWorkloadWhyOverload", params: [4] },
      score: 10, tier: "now",
      cta: { kind: "open-tasks-for", resourceId: 7, resourceName: "Bo" },
    };
    expect(chipsForView([tasksFor], "open-points")).toEqual([tasksFor]);
    expect(chipsForView([tasksFor], "workload")).toEqual([]);
  });

  it("keeps an item-less open for a report card, which navigates to another view", () => {
    const summary: SuggestedAction = { ...mk("s", "now"), cta: { kind: "open", view: "budget", id: 0 } };
    expect(chipsForView([summary], "budget")).toEqual([summary]);
  });
});

describe("chipsActionableOnView", () => {
  it("drops an open that names no item, since it would only re-open the current view", () => {
    const item: SuggestedAction = { ...mk("i", "now"), cta: { kind: "open", view: "changes", id: 4 } };
    const summary: SuggestedAction = { ...mk("s", "now"), cta: { kind: "open", view: "changes", id: 0 } };
    const project: SuggestedAction = { ...mk("p", "now"), cta: { kind: "open", view: "projects", id: "p1" } };
    expect(chipsActionableOnView([item, summary], "changes")).toEqual([item]);
    expect(chipsActionableOnView([project], "projects")).toEqual([]);
  });

  it("keeps open-tasks-for, which filters Open Points rather than re-opening it", () => {
    const tasksFor: SuggestedAction = {
      id: "workload:7:overload", source: "workload",
      title: { key: "actionWorkloadTitle", params: ["Bo"] },
      why: { key: "actionWorkloadWhyOverload", params: [4] },
      score: 10, tier: "now",
      cta: { kind: "open-tasks-for", resourceId: 7, resourceName: "Bo" },
    };
    expect(chipsActionableOnView([tasksFor], "open-points")).toEqual([tasksFor]);
  });
});

describe("ActionChips", () => {
  it("renders nothing when there are no now/soon actions", () => {
    const { container } = render(<ActionChips lang="en-US" actions={[mk("a", "monitor")]} onOpen={() => {}} onShowMore={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
  it("caps at 3 chips and shows +N more for the remaining now/soon (monitor excluded)", () => {
    const actions = [mk("1","now"),mk("2","now"),mk("3","soon"),mk("4","soon"),mk("5","soon"),mk("6","monitor")];
    const onShowMore = vi.fn();
    const { getAllByRole, getByText } = render(<ActionChips lang="en-US" actions={actions} onOpen={() => {}} onShowMore={onShowMore} />);
    expect(getAllByRole("button")).toHaveLength(4); // 3 chips + the "more" button
    fireEvent.click(getByText("+2 more"));          // 5 now/soon − 3 shown = 2
    expect(onShowMore).toHaveBeenCalled();
  });
  it("clicking a chip fires onOpen with that action", () => {
    const a = mk("x", "now");
    const onOpen = vi.fn();
    const { getByText } = render(<ActionChips lang="en-US" actions={[a]} onOpen={onOpen} onShowMore={() => {}} />);
    fireEvent.click(getByText(/Item x/));
    expect(onOpen).toHaveBeenCalledWith(a);
  });
  it("each chip has a why-tooltip (title) from action.why", () => {
    const a = mk("1", "now"); // why: { key: "actionRaidWhySeverity", params: ["Critical"] }
    const { getByText } = render(<ActionChips lang="en-US" actions={[a]} onOpen={() => {}} onShowMore={() => {}} />);
    const chip = getByText(/Item 1/).closest("button");
    expect(chip?.getAttribute("title")).toMatch(/Critical/);
  });
  it("tier dots use the canonical --rag-* tokens (now=red, soon=amber), not raw brand classes", () => {
    const { container } = render(
      <ActionChips lang="en-US" actions={[mk("1", "now"), mk("2", "soon")]} onOpen={() => {}} onShowMore={() => {}} />,
    );
    const dots = Array.from(container.querySelectorAll("span[aria-hidden]"));
    expect(dots[0].className).toContain("bg-[var(--rag-red)]");
    expect(dots[1].className).toContain("bg-[var(--rag-amber)]");
    expect(dots.some((d) => d.className.includes("bg-ui-purple"))).toBe(false);
  });
  // §669 — two actions about entities with one name render one title twice.
  it("names two chips with the same title apart by a row token", () => {
    const same = (id: string): SuggestedAction => ({ ...mk(id, "now"), title: { key: "actionRaidTitle", params: [1, "Vendor"] } });
    render(<ActionChips lang="en-US" actions={[same("a"), same("b")]} onOpen={() => {}} onShowMore={() => {}} />);
    expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true });
  });
});

// §102 (batch 23): the chips and their "+N more" are the shared Button, secondary at xs.
describe("ActionChips on the shared Button", () => {
  it("draws each chip and the +N more as secondary xs", () => {
    const actions = [mk("1","now"),mk("2","now"),mk("3","soon"),mk("4","soon")];
    const { getAllByRole, getByText } = render(<ActionChips lang="en-US" actions={actions} onOpen={() => {}} onShowMore={() => {}} />);
    expect(getAllByRole("button")[0].className).toBe(
      buttonClassFor({ variant: "secondary", size: "xs", className: "inline-flex items-center gap-1.5" }),
    );
    expect(getByText("+1 more").className).toBe(buttonClassFor({ variant: "secondary", size: "xs" }));
  });
});
