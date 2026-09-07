import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ArrangementShelf } from "./arrangement-shelf";
import { expectRowUniqueNames } from "../test/row-unique-names";

const TRAY = "test-shelf-tray";

function shelf(
  opts: {
    hidden?: { id: string; title: string }[];
    isDragging?: boolean;
    onRestore?: (id: string) => void;
    trayId?: string;
  } = {},
) {
  return render(
    <ArrangementShelf
      lang="en-US"
      hidden={opts.hidden ?? [{ id: "a", title: "Alpha board" }, { id: "b", title: "Beta board" }]}
      onRestore={opts.onRestore ?? (() => {})}
      dropProps={{}}
      isDragging={opts.isDragging ?? false}
      trayId={opts.trayId ?? TRAY}
    />,
  );
}

const toggle = () => screen.getByRole("button", { name: /hidden/i });

describe("ArrangementShelf — the disclosure", () => {
  it("summarises the hidden count on a collapsed disclosure", () => {
    shelf();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).toHaveTextContent("2");
  });

  it("opens the tray on click", () => {
    shelf();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the tray when a drag enters the collapsed button", () => {
    // ★ Without this the user must open the tray BEFORE picking a block up — a
    // sequence that cannot be discovered mid-drag.
    shelf({ isDragging: true });
    fireEvent.dragEnter(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves the tray shut when a pointer wanders in with nothing being dragged", () => {
    // ★★ Pins the `isDragging` guard. The happy-path test above passes either
    // way, so it is vacuous on its own.
    shelf({ isDragging: false });
    fireEvent.dragEnter(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the aria-controls target mounted while collapsed", () => {
    // ★★ `hidden`-toggled, never conditionally rendered: an aria-controls that
    // points at nothing is a dangling reference.
    shelf();
    const target = document.getElementById(toggle().getAttribute("aria-controls")!);
    expect(target).not.toBeNull();
    expect(target).toHaveAttribute("hidden");
  });

  it("still offers the disclosure when nothing is hidden, so a drag has a target", () => {
    shelf({ hidden: [] });
    expect(toggle()).toHaveTextContent("0");
    fireEvent.click(toggle());
    expect(screen.getByText("Nothing hidden")).toBeInTheDocument();
  });
});

describe("ArrangementShelf — the injected tray id", () => {
  it("points aria-controls at the id the surface supplied", () => {
    // ★★ A hardcoded id in a component two surfaces mount is a latent
    // duplicate-id defect, and `duplicate-id-aria` IS a `wcag2a` rule the axe
    // gate requests — one of the few a11y traps here that axe could see.
    shelf({ trayId: "reports-shelf-tray" });
    expect(toggle()).toHaveAttribute("aria-controls", "reports-shelf-tray");
    expect(document.getElementById("reports-shelf-tray")).not.toBeNull();
  });
});

describe("ArrangementShelf — restore", () => {
  it("restores a block through a keyboard-reachable button", () => {
    // ★★ The button IS the keyboard path. Dragging a chip back is the mouse
    // shortcut; without this a keyboard user who hid a block could never get
    // it back.
    const onRestore = vi.fn();
    shelf({ onRestore });
    fireEvent.click(toggle());
    fireEvent.click(screen.getAllByRole("button", { name: /restore/i })[0]);
    expect(onRestore).toHaveBeenCalledWith("a");
  });

  it("gives every Restore button a block-unique accessible name", () => {
    // A distinct-name regression pin: two chips, different titles, and the
    // qualifier must keep their control names apart. `requireCollisionSeed` is
    // OFF here for the reason the helper's docstring gives — this fixture
    // deliberately seeds NO clash, and the guard would throw at it.
    const { container } = shelf();
    fireEvent.click(toggle());
    expectRowUniqueNames({ minControls: 3, scope: container });   // toggle + 2 chips
  });

  it("NUMBERS two chips that share a title, rather than emitting one name twice", () => {
    // ★★★ THE COLLISION-SEEDED TEST, and the shelf is the surface that can carry
    // one: it renders the LIST, so it sees its own siblings and can number a
    // genuine clash. `arrangement-tile.tsx` cannot — a per-item component has no
    // sibling visibility — which is why its own test is a distinct-name pin.
    // `requireCollisionSeed: true` is meaningful here precisely because
    // `buildRowTokens` disambiguates with the ` (N)` occurrence suffix the guard
    // strips; prefix-only qualification would make the guard throw instead.
    const { container } = shelf({
      hidden: [{ id: "a", title: "Shared name" }, { id: "b", title: "Shared name" }],
    });
    fireEvent.click(toggle());
    expectRowUniqueNames({ minControls: 3, scope: container, requireCollisionSeed: true });
    expect(screen.getByRole("button", { name: "Restore – Shared name (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore – Shared name (2)" })).toBeInTheDocument();
  });

  it("leaves a unique title BARE, so the common case gains no noise", () => {
    // ★ The positive control for the numbering above: if every chip were
    // numbered, the test above would pass for the wrong reason and every
    // single-chip surface would read "(1)" aloud for no reason.
    shelf();
    fireEvent.click(toggle());
    expect(screen.getByRole("button", { name: "Restore – Alpha board" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Alpha board \(1\)/ })).toBeNull();
  });
});
