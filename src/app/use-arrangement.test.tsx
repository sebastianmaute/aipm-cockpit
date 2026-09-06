import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { LAYOUT_PERSIST_MS, useArrangement } from "./use-arrangement";
import {
  defaultLayout, type ArrangementLayout, type BlockSpec,
} from "./arrangement-layout";
import { loadArrangement, saveArrangement } from "./arrangement-store";

type TestId = "a" | "b" | "c";

/** A synthetic catalogue and a synthetic key — the whole point of the
 *  extraction is that this hook never sees `DASHBOARD_TILES` or the Dashboard's
 *  storage key. `labelKey` is a real `TranslationKey` because the spec type
 *  keeps that tightening; this hook never reads it. */
const CAT: readonly BlockSpec<TestId>[] = [
  { id: "a", labelKey: "cancel", w: 2, h: 2, minW: 1, maxW: 4, minH: 1, maxH: 4 },
  { id: "b", labelKey: "cancel", w: 1, h: 1, minW: 1, maxW: 2, minH: 1, maxH: 2 },
  { id: "c", labelKey: "cancel", w: 4, h: 2, minW: 4, maxW: 4, minH: 2, maxH: 4 },
];
const KEY = "aipm-cockpit:test-arrangement";
/** ★ ONE instance, exactly as every real binding must hold one: `reconcile`
 *  returns it by reference for a null blob and `reset()` hands back the same
 *  object, so a per-call `defaultLayout(CAT)` would silently defeat both. */
const FALLBACK = defaultLayout(CAT);

/**
 * ★★★ `commits` RECORDS COMMITTED RENDERS ONLY, AND THAT IS THE WHOLE POINT.
 * A `useEffect` with no dependency array runs once per COMMIT, so a render React
 * throws away — which is what a render-phase `setState` produces — leaves no
 * entry. That is the only observable in jsdom that separates the two shapes this
 * hook's ★★ and ★★★ blocks are about: reading storage in a lazy initialiser /
 * the render body commits ONE frame carrying the stored layout, while reading it
 * in an effect commits the DEFAULT first and then corrects itself. Both end at
 * the same DOM, so a `screen.getBy*` assertion cannot tell them apart — and RTL
 * flushes effects inside `act`, so neither can looking at the DOM "in between".
 */
let commits: string[] = [];

function Harness({
  projectId = "p1",
  isPopout = false,
  seed,
}: {
  projectId?: string;
  isPopout?: boolean;
  seed?: () => ArrangementLayout<TestId> | null;
}) {
  const a = useArrangement<TestId>({
    catalogue: CAT, storageKey: KEY, fallback: FALLBACK, projectId, isPopout, seed,
  });
  useEffect(() => { commits.push(`${projectId}:${a.layout.hidden.join("+")}`); });
  return (
    <div>
      <output data-testid="order">{a.layout.board.map((b) => `${b.id}${b.w}${b.h}`).join(",")}</output>
      <output data-testid="hidden">{a.layout.hidden.join(",")}</output>
      <output data-testid="readonly">{String(a.readOnly)}</output>
      <output data-testid="is-fallback">{String(a.layout === FALLBACK)}</output>
      <button onClick={() => a.hide("b")}>hide-b</button>
      <button onClick={() => a.hide("c")}>hide-c</button>
      <button onClick={() => a.restore("b", 0)}>restore-b</button>
      <button onClick={() => a.move("a", "c")}>move-a-last</button>
      <button onClick={() => a.resize("a", "w", 4)}>widen-a</button>
      <button onClick={() => a.reset()}>reset</button>
    </div>
  );
}

const ids = () => screen.getByTestId("order").textContent!.split(",").map((s) => s.slice(0, 1));

beforeEach(() => { localStorage.clear(); vi.useRealTimers(); commits = []; });

describe("useArrangement — the initial read", () => {
  it("commits the STORED layout on the very first render, not the default", () => {
    // ★ Pins rule 1: the initial read is a LAZY `useState` initialiser. Moving it
    // into an effect adds a leading "p1:" commit carrying the default — and the
    // final DOM is identical either way, so `commits` is the only detector.
    saveArrangement(KEY, "p1", { v: 1, board: [{ id: "a", w: 2, h: 2 }], hidden: ["b"] });
    render(<Harness />);
    expect(commits).toEqual(["p1:b"]);
    expect(screen.getByTestId("hidden").textContent).toBe("b");
  });

  it("commits the fallback once when storage holds nothing for this project", () => {
    // The positive control for the test above: with nothing stored the single
    // commit carries the empty hidden list, so "p1:b" there is not a tautology.
    render(<Harness />);
    expect(commits).toEqual(["p1:"]);
    expect(screen.getByTestId("is-fallback").textContent).toBe("true");
  });

  it("reconciles a stored layout against the catalogue", () => {
    saveArrangement(KEY, "p1", { v: 1, board: [{ id: "c", w: 1, h: 3 }], hidden: [] });
    render(<Harness />);
    // "a" and "b" are re-inserted ahead of "c"; c's width clamps up to its minW.
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(screen.getByTestId("order").textContent).toContain("c43");
  });
});

describe("useArrangement — the project switch", () => {
  it("re-reads in the RENDER BODY, never committing a frame of the old layout", () => {
    // ★ Pins rule 2. An effect-based switch commits `p2` with p1's layout first
    // and only then corrects itself, so the log gains a bare "p2:" entry. The
    // DOM after the rerender is the same in both shapes.
    saveArrangement(KEY, "p2", { v: 1, board: [{ id: "c", w: 4, h: 2 }], hidden: ["a"] });
    const { rerender } = render(<Harness projectId="p1" />);
    expect(commits).toEqual(["p1:"]);

    rerender(<Harness projectId="p2" />);
    expect(commits).toEqual(["p1:", "p2:a"]);
    expect(screen.getByTestId("hidden").textContent).toBe("a");
  });

  it("does not write the OLD project's layout over the new project's stored one", async () => {
    // ★ Pins rule 3: `projectId` and `layout` are ONE state object. Split them
    // and the persist effect re-runs with the NEW id beside the OLD layout and,
    // one debounce later, replaces the new project's stored arrangement.
    vi.useFakeTimers();
    saveArrangement(KEY, "p2", { v: 1, board: [{ id: "c", w: 4, h: 2 }], hidden: ["a"] });
    const { rerender } = render(<Harness projectId="p1" />);
    act(() => { screen.getByText("hide-b").click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(loadArrangement(KEY, "p1")!.hidden).toEqual(["b"]);

    rerender(<Harness projectId="p2" />);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(loadArrangement(KEY, "p2")!.hidden).toEqual(["a"]);
    expect(loadArrangement(KEY, "p1")!.hidden).toEqual(["b"]);
  });
});

describe("useArrangement — persistence", () => {
  it("persists a mutation after the debounce", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => { screen.getByText("hide-b").click(); });
    await act(async () => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS + 1); });
    expect(loadArrangement(KEY, "p1")!.hidden).toEqual(["b"]);
  });

  it("writes nothing for a project the user never touched", async () => {
    // Pins the `dirty` guard: mounting alone must not persist the reconciled
    // default over storage. The test above is its positive observable.
    vi.useFakeTimers();
    render(<Harness />);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(loadArrangement(KEY, "p1")).toBeNull();
  });

  it("writes NOTHING while several mutations land inside one debounce window", () => {
    // ★ Pins rule 4 from the other side: fold the flush into the debounce
    // effect's CLEANUP and it fires on every `layout` change — one write per
    // drag frame, the exact thing the debounce exists to avoid. The
    // unmount test below still passes under that mutant, so this is the
    // assertion that separates them.
    vi.useFakeTimers();
    render(<Harness />);
    act(() => { screen.getByText("hide-b").click(); });
    act(() => { screen.getByText("hide-c").click(); });
    act(() => { screen.getByText("move-a-last").click(); });
    expect(loadArrangement(KEY, "p1")).toBeNull();
  });

  it("flushes a pending write when the surface unmounts inside the debounce window", async () => {
    // ★ Pins rule 4: the flush is its OWN effect. A conditionally-mounted
    // surface navigated away from within LAYOUT_PERSIST_MS used to discard the
    // write silently.
    vi.useFakeTimers();
    const { unmount } = render(<Harness projectId="p-flush" />);
    act(() => { screen.getByText("hide-b").click(); });
    await act(async () => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS - 50); });
    expect(loadArrangement(KEY, "p-flush")).toBeNull();
    unmount();
    expect(loadArrangement(KEY, "p-flush")!.hidden).toEqual(["b"]);
  });

  it("flushes the OLD project's pending write under the OLD id on a switch", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<Harness projectId="pA" />);
    act(() => { screen.getByText("hide-b").click(); });
    await act(async () => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS - 50); });
    rerender(<Harness projectId="pB" />);
    expect(loadArrangement(KEY, "pA")!.hidden).toEqual(["b"]);
    expect(loadArrangement(KEY, "pB")).toBeNull();
  });

  it("flushes nothing on unmount for a project the user never touched", () => {
    const { unmount } = render(<Harness projectId="p-clean" />);
    unmount();
    expect(loadArrangement(KEY, "p-clean")).toBeNull();
  });

  it("neither persists nor flushes in a popout, and reports readOnly", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<Harness projectId="p-popout" isPopout />);
    expect(screen.getByTestId("readonly").textContent).toBe("true");
    act(() => { screen.getByText("hide-b").click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(loadArrangement(KEY, "p-popout")).toBeNull();
    unmount();
    expect(loadArrangement(KEY, "p-popout")).toBeNull();
  });
});

describe("useArrangement — the mutators", () => {
  it("moves, hides, restores, resizes and resets", () => {
    render(<Harness />);
    act(() => { screen.getByText("move-a-last").click(); });
    expect(ids()).toEqual(["b", "c", "a"]);
    act(() => { screen.getByText("hide-b").click(); });
    expect(ids()).toEqual(["c", "a"]);
    act(() => { screen.getByText("restore-b").click(); });
    expect(ids()).toEqual(["b", "c", "a"]);
    act(() => { screen.getByText("widen-a").click(); });
    expect(screen.getByTestId("order").textContent).toContain("a42");
    act(() => { screen.getByText("reset").click(); });
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("reset returns the surface's OWN fallback BY REFERENCE", () => {
    // ★ Reference identity is contractual across this subsystem: `reconcile`
    // hands the fallback back by reference for a null blob and `reset()` must
    // hand back that SAME object, or the mutators' no-op contract (also
    // reference equality) stops holding for a freshly reset board.
    render(<Harness />);
    act(() => { screen.getByText("hide-b").click(); });
    expect(screen.getByTestId("is-fallback").textContent).toBe("false");
    act(() => { screen.getByText("reset").click(); });
    expect(screen.getByTestId("is-fallback").textContent).toBe("true");
  });

  it("re-renders nothing new when a mutation is a no-op", () => {
    // `mutate` returns the previous state object unchanged when the engine
    // hands back its input, so a no-op cannot mark the surface dirty.
    render(<Harness />);
    const before = commits.length;
    act(() => { screen.getByText("restore-b").click(); });   // "b" is not hidden
    expect(commits.length).toBe(before);
  });
});

describe("useArrangement — the optional seed", () => {
  const SEEDED: ArrangementLayout<TestId> = {
    v: 1, board: [{ id: "c", w: 4, h: 2 }], hidden: ["a"],
  };

  it("uses the seed when storage holds nothing for this project", () => {
    render(<Harness seed={() => SEEDED} />);
    expect(screen.getByTestId("hidden").textContent).toBe("a");
  });

  it("reconciles the seed rather than trusting it", () => {
    // ★ The seed is a MIGRATION input, so it can be stale: here it names no "b"
    // at all. Reconcile puts "b" back rather than leaving the board short.
    render(<Harness seed={() => SEEDED} />);
    expect(ids()).toEqual(["b", "c"]);
  });

  it("ignores the seed once something IS stored", () => {
    saveArrangement(KEY, "p1", { v: 1, board: [{ id: "a", w: 2, h: 2 }], hidden: ["c"] });
    render(<Harness seed={() => SEEDED} />);
    expect(screen.getByTestId("hidden").textContent).toBe("c");
  });

  it("falls back by reference when the seed itself returns null", () => {
    render(<Harness seed={() => null} />);
    expect(screen.getByTestId("is-fallback").textContent).toBe("true");
  });

  it("runs the seed again for a project switched INTO with nothing stored", () => {
    // The seed is consulted by `readLayout`, which runs on both reads — so a
    // migration reaches every project the user visits, not only the first.
    saveArrangement(KEY, "p1", { v: 1, board: [{ id: "a", w: 2, h: 2 }], hidden: ["c"] });
    const { rerender } = render(<Harness projectId="p1" seed={() => SEEDED} />);
    expect(screen.getByTestId("hidden").textContent).toBe("c");
    rerender(<Harness projectId="p2" seed={() => SEEDED} />);
    expect(screen.getByTestId("hidden").textContent).toBe("a");
  });
});
