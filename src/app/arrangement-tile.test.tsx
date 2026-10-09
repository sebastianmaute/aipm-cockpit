import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ArrangementTile } from "./arrangement-tile";
import { W_CLASS, H_CLASS } from "./arrangement-grid";
import { expectRowUniqueNames } from "../test/row-unique-names";

function twoTiles(readOnly = false, prefix = "block") {
  return render(
    <>
      <ArrangementTile id="alpha" title="Alpha board" w={2} h={2} lang="en-US" readOnly={readOnly} keyboardReorder
        testIdPrefix={prefix} dragProps={{}} handleProps={{}} onOpenMenu={() => {}}>
        <p>alpha body</p>
      </ArrangementTile>
      <ArrangementTile id="beta" title="Beta board" w={1} h={3} lang="en-US" readOnly={readOnly} keyboardReorder
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
    // TWO blocks minimum: a one-block fixture cannot express a NAME CLASH
    // BETWEEN TWO BLOCKS at any assertion count.
    //
    // ★★ `requireCollisionSeed` IS DELIBERATELY OFF, and the decisive reason is
    // the helper's OWN docstring: it names distinct-name regression pins as the
    // legitimate `false` case and warns that the guard would THROW at fixtures
    // seeding exactly what they mean to seed. This is such a pin — two blocks
    // with DIFFERENT titles, asserting the qualifier keeps their control names
    // apart.
    // ★ A second reason, true but secondary: the guard wants two rendered names
    // that collide once the "(N)" suffix is stripped, i.e. two blocks sharing a
    // TITLE — and `ArrangementTile` cannot disambiguate that, having no sibling
    // visibility to compose an occurrence index from. Title uniqueness belongs
    // to whoever renders the LIST (`dashboard-panel.tsx` today, `reports.tsx`
    // next), and the collision-seeded test belongs there.
    // ★★ So do NOT read the wording above as a collision claim and switch the
    // guard on: it would throw against correct code.
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

  // ★★★ §425 — THE OTHER BRANCH, AND THE PRIMITIVE HAD NO TEST FOR IT. The
  // grip's name is the ONLY thing telling a keyboard user the arrow keys exist,
  // so on a surface that passes `keyboard: false` to `useListReorderDnd` — where
  // `handleProps.onKeyDown` is undefined — the arrow-key wording is a promise
  // nothing keeps (WCAG 4.1.2). NOTHING ELSE CAN CATCH THAT: axe has no rule
  // comparing an accessible name against the handlers actually bound, and jsdom
  // dispatches a keydown onto a listener-less grip without complaint, so the
  // missing reorder is unobservable from a test. Only the NAME is observable.
  // ★★ LITERALS PIN THE VALUE AS WELL AS THE KEY, WHICH IS THE WHOLE REASON —
  // and NOT the reason a first cut of this comment gave. It claimed a `t(...)`
  // expectation "would assert the component agrees with itself, which cannot
  // fail". That is false: the key here would be FIXED
  // (`t(EN, "reorderHandleDragOnly")`), so flipping the ternary at
  // `arrangement-tile.tsx`'s `moveKey` would render the other string and the
  // expectation WOULD go red. Both forms pin which key is picked. Only a
  // literal also pins what that key SAYS — so an i18n edit that reintroduced an
  // arrow-key promise into `reorderHandleDragOnly`'s value would sail past a
  // `t(...)` form, which follows the value wherever it goes. That is the exact
  // regression this test exists to prevent, so the literal is load-bearing.
  // ★★ THE NEGATIVE HALF LEANS ON A CONTROL IT DOES NOT NAME. Its expected-
  // absent string is asserted PRESENT by "qualifies BOTH the grip and the ⋮
  // with the tile title" above, for this same "Alpha board" fixture — so a typo
  // in the literal below cannot make it pass for the wrong reason while that
  // test is green. Delete or retitle that test and this guarantee evaporates
  // silently. (The `getByRole` on the line above is the other half: it THROWS
  // before the negative runs, so an empty render cannot satisfy this either.)
  it("names the grip for the drag alone when the surface has no keyboard reorder", () => {
    render(
      <ArrangementTile id="alpha" title="Alpha board" w={2} h={2} lang="en-US" readOnly={false}
        keyboardReorder={false}
        testIdPrefix="block" dragProps={{}} handleProps={{}} onOpenMenu={() => {}}>
        <p>body</p>
      </ArrangementTile>,
    );
    expect(screen.getByRole("button", { name: "Drag to reorder – Alpha board" })).toBeInTheDocument();
    // The arrow-key wording must be GONE, not merely supplemented — a grip
    // carrying both names would still mislead.
    expect(
      screen.queryByRole("button", { name: "Drag or use arrow keys to reorder – Alpha board" }),
    ).toBeNull();
  });

  it("names the section itself with the title, so the region is identifiable", () => {
    twoTiles();
    expect(screen.getByRole("region", { name: "Alpha board" })).toBeInTheDocument();
  });

  // ★ An optional `hint` puts an info tooltip in the header beside the title.
  //   It sits in the HEADER, never in the body, because a body is often one big
  //   button (ActivateBody) and a tooltip trigger nested in a button is an axe
  //   nested-interactive failure.
  it("renders a hint as an info tooltip in the header, after the title", () => {
    render(
      <ArrangementTile id="alpha" title="Alpha board" w={2} h={2} lang="en-US" readOnly={false}
        keyboardReorder hint="What Alpha shows"
        testIdPrefix="block" dragProps={{}} handleProps={{}} onOpenMenu={() => {}}>
        <button type="button">body</button>
      </ArrangementTile>,
    );
    const trigger = screen.getByRole("button", { name: "What Alpha shows" });
    const heading = screen.getByRole("heading", { name: "Alpha board" });
    expect(trigger.closest("[data-arrangement-body]")).toBeNull();   // not in the body
    expect(heading.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders no tooltip without a hint", () => {
    twoTiles();
    expect(screen.queryByRole("button", { name: /What/ })).toBeNull();
    expect(screen.getAllByRole("heading")).toHaveLength(2);   // positive control: the headers rendered
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
      <ArrangementTile id="alpha" title="Alpha board" w={2} h={2} lang="en-US" readOnly={false} keyboardReorder
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
      <ArrangementTile id="alpha" title="Alpha board" w={2} h={2} lang="en-US" readOnly={false} keyboardReorder
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
      <ArrangementTile id="alpha" title="Alpha board" w={2} h={2} lang="en-US" readOnly keyboardReorder
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
      <ArrangementTile id="alpha" title="Alpha board" w={2} h={2} lang="en-US" readOnly={false} keyboardReorder
        testIdPrefix="block" dragProps={{ onDragOver }} handleProps={{}} onOpenMenu={() => {}}>
        <p>body</p>
      </ArrangementTile>,
    );
    fireEvent.dragOver(screen.getByTestId("block-alpha"));
    expect(onDragOver).toHaveBeenCalled();
  });
});
