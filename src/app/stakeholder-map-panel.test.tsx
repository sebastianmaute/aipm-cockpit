import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, createEvent } from "@testing-library/react";
import { StakeholderMapPanel } from "./stakeholder-map-panel";
import { t } from "./i18n";
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
  it("lays the quadrants out as a true 2×2 (equal rows)", () => {
    const { container } = render(<StakeholderMapPanel lang="en-US" stakeholders={items} />);
    const grid = container.querySelector("div.grid")!;
    expect(grid.className).toContain("grid-cols-2");
    // ★★ `grid-rows-2` is load-bearing. Without it the implicit rows are `auto` and
    // size to their CONTENT, so the row holding the fewer/shorter chips collapses
    // and its two quadrants become smaller drop targets than the other two —
    // measured in Chromium as 95px/71px rows before, 83px/83px after. jsdom has no
    // layout, so this class is the ONLY detector a unit test can have.
    expect(grid.className).toContain("grid-rows-2");
  });
});

describe("StakeholderMapPanel help callout", () => {
  beforeEach(() => localStorage.clear());

  it("renders the callout when hints are on and onLearnMore is wired", () => {
    render(
      <StakeholderMapPanel
        lang="en-US"
        stakeholders={items}
        showHints
        isPopout={false}
        onLearnMore={vi.fn()}
      />,
    );
    expect(screen.getByText(t("en-US", "viewHintStakeholderMap"))).toBeInTheDocument();
  });

  it("hides the callout when hints are off", () => {
    render(
      <StakeholderMapPanel
        lang="en-US"
        stakeholders={items}
        showHints={false}
        isPopout={false}
        onLearnMore={vi.fn()}
      />,
    );
    expect(screen.queryByText(t("en-US", "viewHintStakeholderMap"))).toBeNull();
  });

  it("renders no callout without an onLearnMore handler (read-only mirror)", () => {
    render(<StakeholderMapPanel lang="en-US" stakeholders={items} showHints />);
    expect(screen.queryByText(t("en-US", "viewHintStakeholderMap"))).toBeNull();
  });

  it("deep-links the stakeholder concept on Learn more", () => {
    const onLearnMore = vi.fn();
    render(
      <StakeholderMapPanel
        lang="en-US"
        stakeholders={items}
        showHints
        isPopout={false}
        onLearnMore={onLearnMore}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /learn more/i }));
    expect(onLearnMore).toHaveBeenCalledWith("concept-stakeholder");
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

// ★★ `dragleave` mirrors `mouseout`, NOT `mouseleave`: moving the pointer from a
// cell's own padding onto one of its CHILDREN fires `dragleave` ON THE CELL with
// `target === currentTarget` — byte-identical, by target alone, to leaving the
// cell for good. A guard reading only those two therefore drops the highlight
// over every chip and over the quadrant label, so the region that LOOKS
// droppable is the cell MINUS its content. Measured in Chromium against the
// seeded sample workspace: the highlight survived on 37% of the keep-satisfied
// cell's area against 48/49/60% for its three siblings — which is the reported
// "the drop area is much smaller here". `relatedTarget` is the only thing that
// separates the two cases (same fix as `gantt-rows.tsx`'s row drop indicator).
describe("StakeholderMapPanel drop highlight", () => {
  const alice: Stakeholder = {
    id: 1,
    name: "Alice",
    category: "Internal",
    influence: "Low",
    interest: "Low",
    raci: {},
  };

  // ★★ jsdom implements no `DragEvent`, so RTL falls back to plain `Event` and an
  // init's `relatedTarget` is DROPPED — `fireEvent.dragLeave(el, { relatedTarget })`
  // silently delivers `undefined` and every case below collapses into the same one.
  // Attach it to the constructed event instead.
  function dragLeaveTo(cell: HTMLElement, related: Node | null) {
    const ev = createEvent.dragLeave(cell);
    Object.defineProperty(ev, "relatedTarget", { value: related });
    fireEvent(cell, ev);
  }

  function renderEditable() {
    render(
      <StakeholderMapPanel
        lang="en-US"
        stakeholders={[alice]}
        onOpenStakeholder={vi.fn()}
        onSaveStakeholder={vi.fn()}
      />,
    );
  }

  it("survives the pointer crossing a chip inside the cell", () => {
    renderEditable();
    // Alice is Low/Low, so the monitor cell is the one holding a chip.
    const cell = screen.getByTestId("quadrant-monitor");
    const chip = screen.getByText("Alice").closest("[draggable]") as HTMLElement;
    fireEvent.dragEnter(cell);
    expect(cell).toHaveClass("ring-2");
    // Real browser order: dragenter on the new element, THEN dragleave on the old.
    fireEvent.dragEnter(chip);
    dragLeaveTo(cell, chip);
    expect(cell).toHaveClass("ring-2");
  });

  it("survives the pointer crossing the quadrant label", () => {
    renderEditable();
    const cell = screen.getByTestId("quadrant-manage-closely");
    const label = cell.querySelector("p") as HTMLElement;
    fireEvent.dragEnter(cell);
    expect(cell).toHaveClass("ring-2");
    fireEvent.dragEnter(label);
    dragLeaveTo(cell, label);
    expect(cell).toHaveClass("ring-2");
  });

  it("clears when the pointer leaves the cell entirely", () => {
    renderEditable();
    const cell = screen.getByTestId("quadrant-manage-closely");
    fireEvent.dragEnter(cell);
    expect(cell).toHaveClass("ring-2");
    dragLeaveTo(cell, document.body);
    expect(cell).not.toHaveClass("ring-2");
  });

  it("clears when the drag leaves the window (null relatedTarget)", () => {
    renderEditable();
    const cell = screen.getByTestId("quadrant-manage-closely");
    fireEvent.dragEnter(cell);
    dragLeaveTo(cell, null);
    expect(cell).not.toHaveClass("ring-2");
  });
});
