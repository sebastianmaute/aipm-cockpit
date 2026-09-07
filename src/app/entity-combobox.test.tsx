import { renderHook, act, render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StrictMode, useLayoutEffect, type KeyboardEvent } from "react";
import { entityOptionId, useEntityCombobox } from "./entity-combobox";

const OPTS = [
  { value: "a", code: "Task", label: "Alpha" },
  { value: "b", code: "Task", label: "Beta" },
];

/** A real DOM for the scroll test: the hook reaches the highlighted row through
 *  `listRef.current?.querySelector(...)`, so a `renderHook` with no list can
 *  never get past the optional chain — the argument is not even evaluated. Row
 *  ids come from `entityOptionId`, the same helper the hook's own query uses. */
function ScrollHarness() {
  // ★ Destructured, exactly as both pickers do it. Reading the ref off the
  // returned object in JSX (`ref={combo.listRef}`) trips `react-hooks/refs`,
  // which is fatal lint here.
  const { listId, listRef, open, active, onKeyDown } = useEntityCombobox({
    query: "a",
    options: OPTS,
    identity: (o) => o.value,
    onCommit: () => {},
  });
  return (
    <div>
      <input
        role="combobox"
        aria-label="Search"
        aria-expanded={open}
        aria-controls={listId}
        onKeyDown={onKeyDown}
      />
      <ul ref={listRef} id={listId} role="listbox">
        {OPTS.map((o, i) => (
          <li key={o.value} id={entityOptionId(listId, i)} role="option" aria-selected={i === active}>
            {o.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Let exactly one animation frame elapse. Queued FIFO, so the hook's callback
 *  has already run by the time this resolver does. */
function flushFrame() {
  return act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

/** A minimal stand-in for the React synthetic event `onKeyDown` reads. Only
 *  `key` and the two suppressors are touched, so the cast is honest. */
function keyEvent(key: string) {
  const e = {
    key,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return e as unknown as KeyboardEvent<HTMLInputElement> & typeof e;
}

describe("useEntityCombobox", () => {
  it("wraps the highlight at both ends", () => {
    const { result } = renderHook(() =>
      useEntityCombobox({
        query: "a",
        options: OPTS,
        identity: (o) => o.value,
        onCommit: () => {},
      }),
    );
    act(() => result.current.move(1));
    expect(result.current.active).toBe(0);
    act(() => result.current.move(-1));
    expect(result.current.active).toBe(1);
  });

  it("disarms a highlight whose option changed identity under a standing query", () => {
    const { result, rerender } = renderHook(
      ({ options }) =>
        useEntityCombobox({
          query: "a",
          options,
          identity: (o: { value: string }) => o.value,
          onCommit: () => {},
        }),
      { initialProps: { options: OPTS } },
    );
    act(() => result.current.move(1));
    expect(result.current.active).toBe(0);
    // Same index, DIFFERENT option — the range clamp cannot see this.
    rerender({
      options: [{ value: "z", code: "Task", label: "Zeta" }, ...OPTS],
    });
    expect(result.current.active).toBe(-1);
  });

  it("resets on a query change", () => {
    const { result, rerender } = renderHook(
      ({ query }) =>
        useEntityCombobox({
          query,
          options: OPTS,
          identity: (o) => o.value,
          onCommit: () => {},
        }),
      { initialProps: { query: "a" } },
    );
    act(() => result.current.move(1));
    rerender({ query: "ab" });
    expect(result.current.active).toBe(-1);
  });

  // ★ The contract C3 depends on: `EntityLinkPicker` commits the whole ENTRY,
  // so the hook must hand back the option OBJECT — not its `value`, not its
  // index. Asserting on argument IDENTITY is what pins that; a test comparing
  // fields would pass against a shallow copy or a rebuilt triple.
  it("commits the active option object on Enter, exactly once", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useEntityCombobox({
        query: "a",
        options: OPTS,
        identity: (o) => o.value,
        onCommit,
      }),
    );
    act(() => result.current.move(1));
    expect(result.current.active).toBe(0);

    const enter = keyEvent("Enter");
    act(() => result.current.onKeyDown(enter));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(OPTS[0]);
    // Identity, not shape: `toHaveBeenCalledWith` is a deep compare and would
    // accept a rebuilt `{value:"a",…}`.
    expect(onCommit.mock.calls[0][0]).toBe(OPTS[0]);
    // The pickers sit in <form> modals; a claimed Enter must not also submit.
    expect(enter.preventDefault).toHaveBeenCalledTimes(1);
  });

  // ★★★ "resets on a query change" ABOVE DOES NOT PIN THE MECHANISM, and
  // reading it as if it did is the trap this test exists for. `act()` flushes
  // passive effects, so "stale render, then repaired by an effect" has no
  // observable middle once act returns: that test passes byte-identically
  // against a `useEffect` implementation of the reconcile. Measured, not
  // reasoned — the effect mutant leaves it green.
  //
  // What discriminates is the COMMIT COUNT. A render-phase setState makes React
  // throw the render away and re-run the component before committing anything,
  // so the reset is in the SAME commit as the new query; an effect commits the
  // stale highlight first and repairs it in a second commit. Recording `active`
  // once per commit shows that directly.
  //
  // ★ Why it matters beyond tidiness: the extra commit is a real frame in which
  // `aria-activedescendant` and `aria-selected` name a row belonging to the
  // PREVIOUS query. `react-hooks/set-state-in-effect` is fatal lint here, so
  // the effect shape would not merge — but lint is not a test, and this file is
  // where the claim in the hook's comment is enforced.
  it("reconciles a query change during render, with no stale commit in between", () => {
    const commits: number[] = [];
    const { result, rerender } = renderHook(
      ({ query }) => {
        const combo = useEntityCombobox({
          query,
          options: OPTS,
          identity: (o: { value: string }) => o.value,
          onCommit: () => {},
        });
        // No dependency array: one push per COMMIT, which is the whole claim.
        useLayoutEffect(() => {
          commits.push(combo.active);
        });
        return combo;
      },
      { initialProps: { query: "a" } },
    );
    act(() => result.current.move(1));
    expect(commits).toEqual([-1, 0]);

    rerender({ query: "ab" });
    // ONE further commit, already carrying the reset. An effect-based reconcile
    // appends a stale `0` before the `-1`.
    expect(commits).toEqual([-1, 0, -1]);
  });

  // ★★ `next` is computed OUTSIDE the `setHighlight` updater and the frame is
  // scheduled beside it. A setState updater must be PURE, and StrictMode
  // double-invokes it — scheduling the scroll from inside one would queue two
  // frames for every arrow press.
  //
  // ★★★ THE SHAPE IS LOAD-BEARING. `strictmode.meta.test.tsx` states the rule:
  // React's double-invoke needs StrictMode at or above the topmost fiber
  // flagged for placement, which `wrapper: StrictMode` satisfies and
  // `({children}) => <StrictMode>{children}</StrictMode>` does NOT — that shape
  // passes with the mechanism deleted. The `renders` assertion is the vacuity
  // control: it fails if this harness ever stops double-invoking, rather than
  // letting the test go quietly green for the wrong reason.
  it("schedules exactly one frame per move, even under StrictMode", () => {
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useEntityCombobox({
          query: "a",
          options: OPTS,
          identity: (o) => o.value,
          onCommit: () => {},
        });
      },
      { wrapper: StrictMode },
    );
    // Control: this harness really does double-invoke. Measured 2026-09-07 —
    // two render passes for one mount, and a state updater called twice.
    expect(renders).toBeGreaterThan(1);

    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(0);
    try {
      act(() => result.current.move(1));
      expect(raf).toHaveBeenCalledTimes(1);
    } finally {
      raf.mockRestore();
    }
  });

  // ★★★ TWO HALVES, AND THE OBVIOUS ASSERTION KILLS ONLY ONE. Deleting the
  // `requestAnimationFrame` WRAPPER and keeping its body still calls
  // `scrollIntoView({block:"nearest"})` on the right row — just synchronously —
  // so an after-the-frame assertion alone survives that mutant. The "nothing
  // yet" line is what pins the deferral, and it has to come first: the row
  // carrying the new index has not rendered when `move` returns.
  //
  // ★ `vitest.setup.ts` already installs a no-op `scrollIntoView` (jsdom ships
  // none), so this replaces it with a RECORDING stub and puts the original
  // back — leaking the recorder would make every later test in the run push
  // into a dead array.
  //
  // ★ The SECOND arrow is anti-vacuity: an implementation that always scrolled
  // row 0 satisfies the first assertion.
  it("scrolls the newly highlighted row into view, one frame later", async () => {
    const scrolled: { id: string; opts?: boolean | ScrollIntoViewOptions }[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (
      this: Element,
      opts?: boolean | ScrollIntoViewOptions,
    ) {
      scrolled.push({ id: this.id, opts });
    };
    try {
      render(<ScrollHarness />);
      const box = screen.getByRole("combobox");
      const rows = () => screen.getAllByRole("option");
      expect(rows()[0].id).not.toBe(rows()[1].id);

      fireEvent.keyDown(box, { key: "ArrowDown" });
      // HALF ONE — deferred. Nothing else in this file catches an unwrapped body.
      expect(scrolled).toEqual([]);

      await flushFrame();
      // HALF TWO — the row the highlight actually landed on, found through the
      // id `entityOptionId` builds, with the `block` the comment names.
      expect(scrolled).toEqual([{ id: rows()[0].id, opts: { block: "nearest" } }]);

      fireEvent.keyDown(box, { key: "ArrowDown" });
      await flushFrame();
      expect(scrolled.map((s) => s.id)).toEqual([rows()[0].id, rows()[1].id]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
