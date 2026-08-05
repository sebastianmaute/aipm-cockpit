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
// Every one of those guards is only meaningful while StrictMode actually
// double-invokes HERE. open-followups §85 records what a wrong answer to
// that question cost: an OBSERVATION that is reproducible — a child mounted
// under a wrapper-nested StrictMode is single-invoked — was read as a
// CONCLUSION that the behaviour was unpinnable outright, and each of the
// three mount re-sets landed with no guard pinning it. For
// use-storage-backend that was measured (deleting the re-set left its own
// file green); for the other two it follows from there being no StrictMode
// test at all, and was not separately run. If this file goes red, those
// guard tests have become vacuous — fix this before trusting them.
//
// The logs are MODULE-SCOPE for convenience — a plain array is simple to
// assert against and survives unmount — NOT because per-instance state would
// miss the cycle. It would not: `doubleInvokeEffectsOnFiber` (read in the
// react-dom development build) disconnects and reconnects effects on the SAME
// fiber rather than replacing it, so a `useRef`/`useState` log held on that
// fiber observes the full ["mount","cleanup","mount"] cycle exactly like a
// module-scope one. The SHAPE RULE below is the measured, and likely,
// explanation for how the earlier "untestable" comments got written — but
// which wrapper shape that 2026-08-04 run actually used was never recovered,
// so this is the likely cause, not a confirmed one.
//
// ★★★ THE SHAPE RULE — AND IT IS A RULE ABOUT THE MOUNT COMMIT, NOT ABOUT
// THE TREE. React's walk stops at the topmost fiber on each branch carrying
// the placement flag and double-invokes there only if StrictMode is at or
// above that fiber. A fiber is placed only while it is BRAND NEW
// (`placeSingleChild` sets the flag on `null === newFiber.alternate`), so on
// the commit that FIRST mounts a tree the placed fibers are the root's
// direct children — and StrictMode therefore double-invokes only when
// nothing (no component, no host element) sits between the root and it on
// its OWN branch. A sibling branch elsewhere in the tree does not matter:
// StrictMode can be the root's second child and still double-invoke.
// `wrapper: StrictMode` (renderHook's wrapper IS the StrictMode component)
// and `reactStrictMode: true` (RTL renders
// `<StrictMode><Wrapper>…</Wrapper></StrictMode>` — an ordinary element
// placed outside the wrapper, not something that reaches `createRoot`) both
// satisfy that. Composing `<StrictMode>` INSIDE a wrapper function —
// `wrapper: ({children}) => <StrictMode>{children}</StrictMode>`, or with
// anything else nested inside that — puts a non-StrictMode fiber on the SAME
// branch above it and silently turns off the double invoke FOR THAT MOUNT,
// which makes any guard built on that shape vacuous. The implementation
// plan's own Task 4 sketch used exactly that nested shape; it was only
// caught because Task 4 ran the mutation and watched the guard stay green
// with the guarded line deleted.
//
// ★★★ BUT "a nested StrictMode is inert" is FALSE IN GENERAL, and every
// revision of this paragraph before 2026-08-05 said it flatly. On a LATER
// commit the wrapper fiber is no longer new, so it is not placed; the walk
// recurses THROUGH it, picks up StrictMode on the way down, and DOES
// double-invoke a child that mounts in that commit. It is inert only for
// children that mount in the SAME commit as the wrapper above it. Every
// guard in this repo mounts once and never re-mounts a child, so the
// initial-mount form is the one that governs them — but do not carry the
// unqualified sentence into a test that rerenders.
//
// ★ "No component, no host element" is literal, and JSX fragments split the
// difference: the OUTERMOST keyless fragment is unwrapped during
// reconciliation and never becomes a fiber, so it does not break the rule,
// while a second one nested inside it does. Both directions are pinned.
//
// Each edge above is a test below rather than a remembered measurement:
// prose whose instrument was thrown away is exactly what produced §85, and
// three successive revisions of this header were over-general because a
// result measured at ONE shape was written as if it held at all of them.
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

  // This pins CURRENT React behaviour (traced to
  // recursivelyTraverseAndDoubleInvokeEffectsInDEV, which stops its walk at
  // the first placed fiber ON EACH BRANCH and double-invokes there only if
  // StrictMode is AT OR ABOVE that fiber — the fiber's own type counts,
  // which is what makes `wrapper: StrictMode` work — and it never recurses
  // PAST that fiber either way, so a StrictMode nested BELOW it is never
  // reached at all) — not a guarantee React owes us. If a future React
  // version makes the nested shape double-invoke on the mount commit too,
  // this test goes red, and that is a GOOD failure: it means the shape rule
  // above changed and every guard built on it needs re-checking, not that
  // something broke.
  // Do not delete this test out of confusion if that day comes.
  // ★ Scope: "on the MOUNT commit". The same nesting DOES double-invoke a
  //   child that mounts on a later commit — pinned two tests below.
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

  // ★★★ THE OTHER HALF OF THE SHAPE RULE, and the half three revisions of
  // this file's header got wrong by omission. The nesting in the two
  // negative tests above is NOT what makes StrictMode inert — the mount
  // COMMIT is. Here the wrapper `<div>` and the `<StrictMode>` both already
  // exist when the child mounts, so neither is newly placed; the walk
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
