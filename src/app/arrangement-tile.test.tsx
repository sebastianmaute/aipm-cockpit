import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ArrangementTile } from "./arrangement-tile";
import { W_CLASS, H_CLASS } from "./arrangement-grid";
import { expectRowUniqueNames } from "../test/row-unique-names";

function twoTiles(readOnly = false, prefix = "block") {
  return render(
    <>
      <ArrangementTile id="alpha" title="Alpha board" w={2} h={2} lang="en-US" readOnly={readOnly}
        testIdPrefix={prefix} dragProps={{}} handleProps={{}} onOpenMenu={() => {}}>
        <p>alpha body</p>
      </ArrangementTile>
      <ArrangementTile id="beta" title="Beta board" w={1} h={3} lang="en-US" readOnly={readOnly}
        testIdPrefix={prefix} dragProps={{}} handleProps={{}} onOpenMenu={() => {}}>
        <p>beta body</p>
      </ArrangementTile>
    </>,
  );
}

describe("ArrangementTile — accessible names", () => {
  it("gives every control across two tiles a tile-unique accessible name", () => {
    // ★★★ THE ONLY POSSIBLE DETECTOR, IN EITHER LAYER. axe has no rule under the
    // four tags `e2e/a11y.spec.ts` requests that flags two controls sharing an
    // accessible name, at any seed size — so a green axe run says nothing here.
    // TWO tiles minimum: a one-tile fixture cannot express the collision at any
    // assertion count.
    //
    // ★★ `requireCollisionSeed` IS DELIBERATELY OFF, and this is the reasoned
    // call rather than an oversight. That guard requires two rendered names to
    // collide once the "(N)" suffix is stripped — i.e. a fixture where two tiles
    // share a TITLE. `ArrangementTile` cannot disambiguate that: it has no
    // sibling visibility, so it composes its names from the one title it is
    // handed, and a shared-title fixture would be asserting a property this
    // component structurally cannot have. Title uniqueness belongs to whoever
    // renders the LIST — `dashboard-panel.tsx` today, `reports.tsx` next — and
    // the collision-seeded test belongs there. This is a distinct-name
    // regression pin, which the helper's own docstring names as the legitimate
    // `requireCollisionSeed: false` case.
    const { container } = twoTiles();
    expectRowUniqueNames({
      // MEASURED, not guessed: two tiles x (one grip + one ⋮) = 4. Kept at the
      // exact value so a silently narrowed query cannot read as a pass.
      minControls: 4,
      scope: container,
    });
  });

  it("qualifies BOTH the grip and the ⋮ with the tile title", () => {
    // ★ The uniqueness assertion above passes if only ONE of the two carries a
    // qualifier, so long as the other pair happens not to collide. This names
    // which control must carry what.
    // ★ The base strings are the EN values of `reorderHandle` and
    // `actionMoreActions`, spelt out rather than re-derived through `t(...)`:
    // calling `t` here would assert the component agrees with itself about the
    // key, which it cannot fail. What must not regress is the ` – ${title}`
    // qualifier, and only a literal expectation pins the whole rendered name.
    // The separator is an EN DASH (U+2013), matching the repo's row-label form.
    twoTiles();
    for (const title of ["Alpha board", "Beta board"]) {
      expect(screen.getByRole("button", { name: `Drag or use arrow keys to reorder – ${title}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `More actions – ${title}` })).toBeInTheDocument();
    }
  });

  it("names the section itself with the title, so the region is identifiable", () => {
    twoTiles();
    expect(screen.getByRole("region", { name: "Alpha board" })).toBeInTheDocument();
  });
});

describe("ArrangementTile — the surface bindings", () => {
  it("builds the test id from the injected prefix and the block id", () => {
    // ★ `testIdPrefix="tile"` is what keeps every existing Dashboard
    // `data-testid="tile-raid"` query resolving through the adapter; a surface
    // supplying its own prefix gets its own namespace.
    twoTiles(false, "report");
    expect(screen.getByTestId("report-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("report-beta")).toBeInTheDocument();
  });

  it("applies the span classes from the shared literal tables", () => {
    twoTiles();
    const alpha = screen.getByTestId("block-alpha");
    expect(alpha.className).toContain(W_CLASS[2]);
    expect(alpha.className).toContain(H_CLASS[2]);
    const beta = screen.getByTestId("block-beta");
    expect(beta.className).toContain(W_CLASS[1]);
    expect(beta.className).toContain(H_CLASS[3]);
  });

  it("hands the ⋮ trigger itself to onOpenMenu, so a popover can anchor on it", () => {
    const onOpenMenu = vi.fn();
    render(
      <ArrangementTile id="alpha" title="Alpha board" w={2} h={2} lang="en-US" readOnly={false}
        testIdPrefix="block" dragProps={{}} handleProps={{}} onOpenMenu={onOpenMenu}>
        <p>body</p>
      </ArrangementTile>,
    );
    const trigger = screen.getByRole("button", { name: "More actions – Alpha board" });
    fireEvent.click(trigger);
    expect(onOpenMenu).toHaveBeenCalledWith(trigger);
  });

  it("registers and then releases the ⋮ trigger through menuButtonRef", () => {
    // ★★ Pins the `null` call on unmount. Without it the caller's id→node map
    // accumulates detached nodes, and focusing one is a silent no-op.
    const seen: (HTMLButtonElement | null)[] = [];
    const { unmount } = render(
      <ArrangementTile id="alpha" title="Alpha board" w={2} h={2} lang="en-US" readOnly={false}
        testIdPrefix="block" dragProps={{}} handleProps={{}} onOpenMenu={() => {}}
        menuButtonRef={(el) => seen.push(el)}>
        <p>body</p>
      </ArrangementTile>,
    );
    expect(seen[0]).toBeInstanceOf(HTMLButtonElement);
    unmount();
    expect(seen.at(-1)).toBeNull();
  });
});

describe("ArrangementTile — readOnly", () => {
  it("renders no grip and no ⋮, and still renders the title and body", () => {
    // ★ A popout is read-only: no arrangement affordances at all, but the
    // content must still be there to read.
    const { container } = twoTiles(true);
    expect(within(container).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("alpha body")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Alpha board" })).toBeInTheDocument();
  });

  it("does not spread the drop handlers onto the section when readOnly", () => {
    // ★★ The drag props are the DROP TARGET half. Leaving them on in a popout
    // would make a read-only board accept drops it cannot persist. There is no
    // rendered attribute for a React handler, so the observable is the event:
    // firing dragOver must not reach the handler.
    const onDragOver = vi.fn();
    render(
      <ArrangementTile id="alpha" title="Alpha board" w={2} h={2} lang="en-US" readOnly
        testIdPrefix="block" dragProps={{ onDragOver }} handleProps={{}} onOpenMenu={() => {}}>
        <p>body</p>
      </ArrangementTile>,
    );
    fireEvent.dragOver(screen.getByTestId("block-alpha"));
    expect(onDragOver).not.toHaveBeenCalled();
  });

  it("DOES spread them when not readOnly — the positive control for the test above", () => {
    const onDragOver = vi.fn();
    render(
      <ArrangementTile id="alpha" title="Alpha board" w={2} h={2} lang="en-US" readOnly={false}
        testIdPrefix="block" dragProps={{ onDragOver }} handleProps={{}} onOpenMenu={() => {}}>
        <p>body</p>
      </ArrangementTile>,
    );
    fireEvent.dragOver(screen.getByTestId("block-alpha"));
    expect(onDragOver).toHaveBeenCalled();
  });
});
