// src/app/strictmode.meta.test.tsx
//
// ★★★ A META-TEST: it asserts a property of the TEST HARNESS, not of the app.
//
// React StrictMode mounts → unmounts → remounts in development. Three hooks in
// this repo re-set a `mountedRef` in their mount-effect BODY specifically to
// survive that cycle (use-scheduled-jobs, use-operating-guides,
// use-storage-backend), and each is pinned by a guard test that renders under
// StrictMode.
//
// Those guards are only meaningful while StrictMode actually double-invokes
// HERE. If this file goes red they have become vacuous — fix it before
// trusting them. open-followups §85 has the history: a real observation (a
// child mounted under a wrapper-nested StrictMode IS single-invoked) was read
// as "unpinnable", and all three re-sets shipped with nothing pinning them.
//
// ★★★ THE RULE IS ABOUT THE PLACEMENT FLAG. Everything else here is a
// COROLLARY, and both earlier attempts to state this went wrong by promoting
// one corollary into the rule.
//
//   React's walk descends each branch until it meets a fiber FLAGGED FOR
//   PLACEMENT, double-invokes there if StrictMode is at or above that fiber,
//   and never recurses past it either way.
//
// Two things carry that flag (`placeChild` / `placeSingleChild`): a BRAND-NEW
// fiber (`alternate === null`), and an existing KEYED child that MOVED
// BACKWARDS in a list (`alternate.index < lastPlacedIndex`). **"Placed" does
// not mean "new"** — the sentence both earlier wordings were built on.
//
// COROLLARY 1 — the mount commit. On the commit that FIRST mounts a tree the
// only placed fibers are the root's direct children, so StrictMode
// double-invokes only when nothing (no component, no host element) sits
// between the root and it on its OWN branch; a sibling branch elsewhere does
// not matter. `wrapper: StrictMode` and `reactStrictMode: true` (RTL renders
// `<StrictMode><Wrapper>…</Wrapper></StrictMode>`, outside your wrapper and
// nowhere near `createRoot`) both satisfy it. Composing `<StrictMode>` INSIDE
// a wrapper function does not, so that mount is single-invoked and any guard
// built on the shape is VACUOUS-BUT-GREEN.
//
// COROLLARY 2 — later commits. A nested StrictMode is not inert in general:
// once the wrapper has an alternate it is no longer placed, the walk recurses
// THROUGH it, and a child mounting in that commit IS double-invoked. Unless
// that wrapper is itself a moved keyed child — then it carries the flag and
// the walk stops before reaching StrictMode.
//
// COROLLARY 3 — nothing need mount at all. A `<StrictMode>` that is itself a
// moved keyed child is placed, so a pure REORDER double-invokes its whole
// subtree's effects.
//
// ★ Fragments: the OUTERMOST keyless fragment is unwrapped during
// reconciliation and never becomes a fiber, so it does not break the rule; a
// second one nested inside it does.
//
// ★ ONE EXCEPTION IS STATED BUT NOT PINNED, deliberately marked so: an
// OffscreenComponent (`fiber.tag === 22`, created for a `<Suspense>`
// boundary's children) is special-cased — a PLACED one does not stop the
// walk, a HIDDEN one (`memoizedState !== null`) is skipped entirely. Read
// from source, NOT measured; nothing here renders StrictMode inside Suspense.
// A lead, not a fact.
//
// Everything else above is a test below rather than a remembered measurement
// — prose whose instrument was thrown away is what produced §85. Module-scope
// logs are for convenience only: `doubleInvokeEffectsOnFiber` reuses the same
// fiber, so a `useRef` log would observe the identical cycle.
import { StrictMode, useEffect } from "react";
import { render, renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import React from "react";

const componentLog: string[] = [];
const hookLog: string[] = [];
const nestedLog: string[] = [];
const bareNestedLog: string[] = [];
const strictOptionLog: string[] = [];
const laterCommitLog: string[] = [];
const laterCommitControlLog: string[] = [];
const firstCommitLog: string[] = [];
const movedStrictLog: string[] = [];
const movedWrapperLog: string[] = [];
const staticWrapperLog: string[] = [];
const siblingLog: string[] = [];
const loneFragmentLog: string[] = [];
const nestedFragmentLog: string[] = [];

function Shell({ children }: { children?: React.ReactNode }) {
  return <div>{children}</div>;
}

function LogProbe({ log }: { log: string[] }) {
  useEffect(() => {
    log.push("mount");
    return () => {
      log.push("cleanup");
    };
  }, [log]);
  return null;
}

// A wrapper-nested StrictMode whose child appears only on the SECOND commit.
function LaterCommitHost({ show }: { show: boolean }) {
  return (
    <div>
      <StrictMode>{show ? <LogProbe log={laterCommitLog} /> : null}</StrictMode>
    </div>
  );
}

// Identical, minus StrictMode — proves the double invoke above comes from
// StrictMode and not merely from mounting a child on a rerender.
function LaterCommitControlHost({ show }: { show: boolean }) {
  return <div>{show ? <LogProbe log={laterCommitControlLog} /> : null}</div>;
}

// Same host as LaterCommitHost, rendered with the child present from the
// start — the A/B that isolates the COMMIT as the only difference.
function FirstCommitHost() {
  return (
    <div>
      <StrictMode>
        <LogProbe log={firstCommitLog} />
      </StrictMode>
    </div>
  );
}

// `<StrictMode>` as a KEYED list child. Reordering it backwards makes React
// flag it for placement even though it is not new.
function MovedStrictList({ order }: { order: readonly string[] }) {
  return (
    <div>
      {order.map((k) =>
        k === "sm" ? (
          <StrictMode key="sm">
            <LogProbe log={movedStrictLog} />
          </StrictMode>
        ) : (
          <div key={k}>{k}</div>
        ),
      )}
    </div>
  );
}

// Same reorder, but the moved keyed child is a WRAPPER with StrictMode inside
// — AND a child mounts in that same commit. The new child is what makes the
// pair discriminating: without it both "the walk stopped at the placed
// wrapper" and "nothing was placed at all" predict the same empty result.
function MovedWrapperNewChild({ order, show }: { order: readonly string[]; show: boolean }) {
  return (
    <div>
      {order.map((k) =>
        k === "w" ? (
          <div key="w">
            <StrictMode>{show ? <LogProbe log={movedWrapperLog} /> : null}</StrictMode>
          </div>
        ) : (
          <div key={k}>{k}</div>
        ),
      )}
    </div>
  );
}

// Identical, with the list order held FIXED — so the reorder is the only
// difference between this and the case above.
function StaticWrapperNewChild({ show }: { show: boolean }) {
  return (
    <div>
      {["a", "w", "c"].map((k) =>
        k === "w" ? (
          <div key="w">
            <StrictMode>{show ? <LogProbe log={staticWrapperLog} /> : null}</StrictMode>
          </div>
        ) : (
          <div key={k}>{k}</div>
        ),
      )}
    </div>
  );
}

function useNestedProbe() {
  useEffect(() => {
    nestedLog.push("mount");
    return () => {
      nestedLog.push("cleanup");
    };
  }, []);
}

function useBareNestedProbe() {
  useEffect(() => {
    bareNestedLog.push("mount");
    return () => {
      bareNestedLog.push("cleanup");
    };
  }, []);
}

function useStrictOptionProbe() {
  useEffect(() => {
    strictOptionLog.push("mount");
    return () => {
      strictOptionLog.push("cleanup");
    };
  }, []);
}

function Probe() {
  useEffect(() => {
    componentLog.push("mount");
    return () => {
      componentLog.push("cleanup");
    };
  }, []);
  return <div>probe</div>;
}

function useProbeHook() {
  useEffect(() => {
    hookLog.push("mount");
    return () => {
      hookLog.push("cleanup");
    };
  }, []);
}

describe("StrictMode double-invocation (meta — guards depend on this)", () => {
  it("double-invokes a component's mount effect", () => {
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(componentLog).toEqual(["mount", "cleanup", "mount"]);
  });

  it("double-invokes a hook's mount effect via renderHook's wrapper", () => {
    renderHook(() => useProbeHook(), { wrapper: StrictMode });
    expect(hookLog).toEqual(["mount", "cleanup", "mount"]);
  });

  // Corollary 1 (see the header for the rule and the mechanism — this is the
  // only place the walk is described, deliberately). This pins CURRENT React
  // behaviour, not a guarantee React owes us: if a future version
  // double-invokes this shape on the mount commit too, the test goes red, and
  // that is a GOOD failure — it means the rule changed and every guard built
  // on it needs re-checking, not that something broke.
  // Do not delete this test out of confusion if that day comes.
  // ★ Scope: the MOUNT commit. The same nesting DOES double-invoke a child
  //   that mounts on a later commit — pinned further down.
  it("does NOT double-invoke a child mounted with a wrapper-nested StrictMode", () => {
    renderHook(() => useNestedProbe(), {
      wrapper: ({ children }) => (
        <StrictMode>
          <Shell>{children}</Shell>
        </StrictMode>
      ),
    });
    expect(nestedLog).toEqual(["mount"]);
  });

  // The Shell variant above could be read as "the extra DOM element between
  // StrictMode and the hook is what breaks it" — it isn't. Here there is no
  // element between the wrapper and StrictMode at all: the wrapper FUNCTION
  // itself is enough to put a fiber between the root and StrictMode on its
  // own branch, which silences the double invoke for this mount. This is the
  // more surprising half of the shape rule, and the shape a contributor
  // reaching for "just wrap it in StrictMode" is likeliest to write. Same
  // current-behaviour caveat as above: a future red run here means the shape
  // rule changed, not that something broke.
  it("does NOT double-invoke with a bare nested StrictMode wrapper (no intermediate component)", () => {
    renderHook(() => useBareNestedProbe(), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
    expect(bareNestedLog).toEqual(["mount"]);
  });

  it("double-invokes via renderHook's reactStrictMode option, which leaves nothing between the root and StrictMode", () => {
    renderHook(() => useStrictOptionProbe(), {
      wrapper: Shell,
      reactStrictMode: true,
    });
    expect(strictOptionLog).toEqual(["mount", "cleanup", "mount"]);
  });

  // ★★★ COROLLARY 2, and the half both earlier wordings of this file's
  // header got wrong by omission. The nesting in the two negative tests
  // above is NOT what makes StrictMode inert — which fiber is FLAGGED FOR
  // PLACEMENT is. Here the wrapper `<div>` and the `<StrictMode>` both
  // already exist when the child mounts, so neither is placed; the walk
  // recurses through them, picks StrictMode up on the way down, and
  // double-invokes at the child. Measured 2026-08-05.
  it("DOES double-invoke through a wrapper-nested StrictMode when the child mounts on a later commit", () => {
    const { rerender } = render(<LaterCommitHost show={false} />);
    rerender(<LaterCommitHost show={true} />);
    expect(laterCommitLog).toEqual(["mount", "cleanup", "mount"]);
  });

  // Without this control the test above would also pass if a rerender-mounted
  // child were double-invoked for some reason unrelated to StrictMode.
  it("does NOT double-invoke a later-commit child when there is no StrictMode at all", () => {
    const { rerender } = render(<LaterCommitControlHost show={false} />);
    rerender(<LaterCommitControlHost show={true} />);
    expect(laterCommitControlLog).toEqual(["mount"]);
  });

  // The second control, isolating the COMMIT. The two nested-wrapper
  // negatives further up differ from the positive in three ways at once
  // (commit number, `render` vs `renderHook`, wrapper-function vs component),
  // so on their own they cannot show that the commit is what matters. This
  // renders the SAME host as the positive, with the child present from the
  // start.
  it("does NOT double-invoke that same wrapper-nested StrictMode on the FIRST commit", () => {
    render(<FirstCommitHost />);
    expect(firstCommitLog).toEqual(["mount"]);
  });

  // COROLLARY 3: no new child is needed at all. `<StrictMode>` is a keyed
  // child here; moving it backwards flags it for placement despite having an
  // alternate, so the walk double-invokes AT it and its subtree's effects are
  // disconnected and reconnected by a pure reorder. This is the case that
  // makes "placed means new" false.
  it("double-invokes on a pure REORDER when StrictMode itself is a keyed child that moves", () => {
    const { rerender } = render(<MovedStrictList order={["a", "sm", "c"]} />);
    expect(movedStrictLog).toEqual(["mount"]);
    rerender(<MovedStrictList order={["c", "a", "sm"]} />);
    expect(movedStrictLog).toEqual(["mount", "cleanup", "mount"]);
  });

  // The limit of COROLLARY 2, as a PAIR. "A later commit recurses through the
  // wrapper" holds only while the wrapper is not itself placed. These two
  // differ in exactly one respect — whether the keyed wrapper moved — and
  // they give different answers, which is what makes either of them evidence.
  // ★ Asserting only the first would pin NOTHING: "the walk stopped at the
  //   placed wrapper" and "nothing was placed at all" both predict a single
  //   invoke, so the control is not optional here.
  it("does NOT double-invoke a new child when its keyed wrapper moved in the same commit", () => {
    const { rerender } = render(<MovedWrapperNewChild order={["a", "w", "c"]} show={false} />);
    rerender(<MovedWrapperNewChild order={["c", "a", "w"]} show={true} />);
    expect(movedWrapperLog).toEqual(["mount"]);
  });

  it("DOES double-invoke that same new child when the wrapper did not move", () => {
    const { rerender } = render(<StaticWrapperNewChild show={false} />);
    rerender(<StaticWrapperNewChild show={true} />);
    expect(staticWrapperLog).toEqual(["mount", "cleanup", "mount"]);
  });

  // The rule is per-BRANCH: a sibling occupying the root's first slot does
  // not push StrictMode out of position. Pinned because the header says so,
  // and because "outermost" — the wording this file carried until
  // 2026-08-05 — would predict the opposite.
  it("double-invokes when StrictMode is the root's SECOND child", () => {
    render(
      <>
        <Shell />
        <StrictMode>
          <LogProbe log={siblingLog} />
        </StrictMode>
      </>,
    );
    expect(siblingLog).toEqual(["mount", "cleanup", "mount"]);
  });

  // Fragment edge, both directions: a keyless top-level fragment is unwrapped
  // during reconciliation and never becomes a fiber, so it does not break the
  // rule...
  it("double-invokes through a lone top-level fragment (elided, never a fiber)", () => {
    render(
      <>
        <StrictMode>
          <LogProbe log={loneFragmentLog} />
        </StrictMode>
      </>,
    );
    expect(loneFragmentLog).toEqual(["mount", "cleanup", "mount"]);
  });

  // ...but only the OUTERMOST one is unwrapped. A second fragment is a real
  // fiber and silences the double invoke exactly like a component would —
  // which is why the rule says "no component, no host element" rather than
  // "no JSX".
  it("does NOT double-invoke through a fragment nested one level deeper", () => {
    render(
      <>
        <>
          <StrictMode>
            <LogProbe log={nestedFragmentLog} />
          </StrictMode>
        </>
      </>,
    );
    expect(nestedFragmentLog).toEqual(["mount"]);
  });

  it("resolves the DEVELOPMENT React build", () => {
    // The dev-only missing-`key` warning does not exist in the production
    // build, so its absence is a SIGNAL that React resolved production here —
    // in which case the double invoke above is the next thing to disappear.
    // ★ It is not proof: React may also reword the warning between versions.
    // Diagnose a lone failure of the string match before believing either.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        {[1, 2].map((n) => (
          // eslint-disable-next-line react/jsx-key
          <span>{n}</span>
        ))}
      </div>,
    );
    const messages = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    expect(React.version.startsWith("19.")).toBe(true);
    expect(messages.some((m) => m.includes("key"))).toBe(true);
  });
});
