import { describe, expect, it, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { StakeholderMapPanel } from "./stakeholder-map-panel";
import type { Stakeholder } from "./types";

const items: Stakeholder[] = [
  { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: {} },
  { id: 2, name: "Lee", category: "Internal", influence: "Low", interest: "Low", raci: {} },
];

describe("StakeholderMapPanel", () => {
  it("plots each stakeholder in its quadrant", () => {
    render(<StakeholderMapPanel lang="en-US" stakeholders={items} />);
    const manage = screen.getByTestId("quadrant-manage-closely");
    expect(within(manage).getByText("Sam")).toBeInTheDocument();
    const monitor = screen.getByTestId("quadrant-monitor");
    expect(within(monitor).getByText("Lee")).toBeInTheDocument();
  });
  it("plots non-interactive text chips when no open handler is given", () => {
    render(<StakeholderMapPanel lang="en-US" stakeholders={items} />);
    expect(screen.queryByRole("button", { name: /Sam/ })).toBeNull();
  });
  it("makes chips clickable buttons that open the stakeholder editor when wired", () => {
    const onOpenStakeholder = vi.fn();
    render(
      <StakeholderMapPanel lang="en-US" stakeholders={items} onOpenStakeholder={onOpenStakeholder} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Sam/ }));
    expect(onOpenStakeholder).toHaveBeenCalledWith(1);
  });
  it("shows an empty state when there are no stakeholders", () => {
    render(<StakeholderMapPanel lang="en-US" stakeholders={[]} />);
    expect(screen.getByText(/no stakeholders to plot/i)).toBeInTheDocument();
  });
  it("renders the map in the centered half-size pane (chat sizing)", () => {
    const { container } = render(<StakeholderMapPanel lang="en-US" stakeholders={[]} />);
    const pane = container.querySelector("[data-testid='stakeholder-map-pane']")!;
    expect(pane.className).toContain("mx-auto"); // centered
    expect(pane.className).toContain("w-[50%]");
  });
});

// jsdom's fireEvent.drop does NOT populate a dataTransfer — stub one.
function dt(id: string) {
  const store: Record<string, string> = { "text/plain": id };
  return {
    getData: (k: string) => store[k] ?? "",
    setData: vi.fn(),
    dropEffect: "",
    effectAllowed: "",
  };
}

describe("StakeholderMapPanel drag-to-move", () => {
  const alice: Stakeholder = {
    id: 1,
    name: "Alice",
    category: "Internal",
    influence: "Low",
    interest: "Low",
    raci: {},
  };

  it("chips are draggable when editable (onSaveStakeholder present)", () => {
    render(
      <StakeholderMapPanel
        lang="en-US"
        stakeholders={[alice]}
        onOpenStakeholder={vi.fn()}
        onSaveStakeholder={vi.fn()}
      />,
    );
    expect(screen.getByText("Alice").closest("[draggable]")).toHaveAttribute("draggable", "true");
  });

  it("chips are NOT draggable without onSaveStakeholder (read-only)", () => {
    render(
      <StakeholderMapPanel lang="en-US" stakeholders={[alice]} onOpenStakeholder={vi.fn()} />,
    );
    expect(screen.getByText("Alice").closest("[draggable]")).toBeNull();
  });

  it("dropping on a quadrant calls onSaveStakeholder with the moved stakeholder", () => {
    const onSave = vi.fn();
    render(
      <StakeholderMapPanel
        lang="en-US"
        stakeholders={[alice]}
        onOpenStakeholder={vi.fn()}
        onSaveStakeholder={onSave}
      />,
    );
    fireEvent.drop(screen.getByTestId("quadrant-manage-closely"), { dataTransfer: dt("1") });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 1, influence: "High", interest: "High" });
  });

  it("a no-op drop (same quadrant) does not call onSaveStakeholder", () => {
    const onSave = vi.fn();
    render(
      <StakeholderMapPanel
        lang="en-US"
        stakeholders={[alice]}
        onOpenStakeholder={vi.fn()}
        onSaveStakeholder={onSave}
      />,
    );
    fireEvent.drop(screen.getByTestId("quadrant-monitor"), { dataTransfer: dt("1") });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("a garbage (non-numeric / unknown-id) payload is a safe no-op", () => {
    const onSave = vi.fn();
    render(
      <StakeholderMapPanel
        lang="en-US"
        stakeholders={[alice]}
        onOpenStakeholder={vi.fn()}
        onSaveStakeholder={onSave}
      />,
    );
    expect(() =>
      fireEvent.drop(screen.getByTestId("quadrant-manage-closely"), { dataTransfer: dt("not-a-number") }),
    ).not.toThrow();
    expect(onSave).not.toHaveBeenCalled();
  });
});
