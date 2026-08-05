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
// double-invokes HERE. open-followups §85 records what happens when it stops
// being: an OBSERVATION that is reproducible — StrictMode single-invokes when
// nested inside a wrapper component — was read as a CONCLUSION that the
// behaviour was unpinnable outright, and each of the three mount re-sets
// landed with no guard pinning it; deleting any one of them kept every gate
// green until this branch closed the gap. If this file goes red, those guard
// tests have become vacuous — fix this before trusting them.
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
// ★★★ THE SHAPE RULE: StrictMode only double-invokes when it is the OUTERMOST
// element under the root. `wrapper: StrictMode` (renderHook's wrapper IS the
// StrictMode component) and `reactStrictMode: true` (RTL wraps the root in
// StrictMode itself and leaves `wrapper` untouched) are the two safe forms.
// Composing `<StrictMode>` INSIDE a wrapper function — `wrapper: ({children})
// => <StrictMode>{children}</StrictMode>`, or with anything else nested
// inside that — puts a non-StrictMode fiber above it and silently turns off
// the double invoke, which makes any guard built on that shape vacuous. The
// implementation plan's own Task 4 sketch used exactly that nested shape; it
// was only caught because Task 4 ran the mutation and watched the guard stay
// green with the guarded line deleted. See the two tests below.
import { StrictMode, useEffect } from "react";
import { render, renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import React from "react";

const componentLog: string[] = [];
const hookLog: string[] = [];
const nestedLog: string[] = [];
const bareNestedLog: string[] = [];
const strictOptionLog: string[] = [];

function Shell({ children }: { children?: React.ReactNode }) {
  return <div>{children}</div>;
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
  // the first placed fiber and double-invokes there only if StrictMode was
  // seen on the path down to it from an ANCESTOR, not only if that fiber
  // itself is StrictMode-typed) — not a guarantee React owes us. If a future
  // React version makes the nested shape double-invoke too, this test goes red,
  // and that is a GOOD failure: it means the shape rule above changed and
  // every guard built on it needs re-checking, not that something broke.
  // Do not delete this test out of confusion if that day comes.
  it("does NOT double-invoke when StrictMode is nested inside a wrapper component", () => {
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
  // itself is enough to move StrictMode off the outermost position and
  // silence the double invoke. This is the more surprising half of the shape
  // rule, and the shape a contributor reaching for "just wrap it in
  // StrictMode" is likeliest to write. Same current-behaviour caveat as
  // above: a future red run here means the shape rule changed, not that
  // something broke.
  it("does NOT double-invoke with a bare nested StrictMode wrapper (no intermediate component)", () => {
    renderHook(() => useBareNestedProbe(), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
    expect(bareNestedLog).toEqual(["mount"]);
  });

  it("double-invokes via renderHook's reactStrictMode option, which keeps StrictMode outermost", () => {
    renderHook(() => useStrictOptionProbe(), {
      wrapper: Shell,
      reactStrictMode: true,
    });
    expect(strictOptionLog).toEqual(["mount", "cleanup", "mount"]);
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
