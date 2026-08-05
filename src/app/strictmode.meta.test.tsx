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
// being: a single mis-taken measurement convinced three separate comments that
// the behaviour was unpinnable, and the three shipped guards went untested for
// two releases. If this file goes red, those guard tests have become vacuous —
// fix this before trusting them.
//
// The logs are MODULE-SCOPE on purpose. A log held in per-instance state or in
// a ref created inside the component is handed back fresh by StrictMode's
// remount, so it reads ["mount"] whether or not the double invoke happened —
// which is the leading theory for how the original measurement went wrong.
import { StrictMode, useEffect } from "react";
import { render, renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import React from "react";

const componentLog: string[] = [];
const hookLog: string[] = [];

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
