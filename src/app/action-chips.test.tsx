import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ActionChips, chipsForView } from "./action-chips";
import type { SuggestedAction } from "./next-actions/types";

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
});
