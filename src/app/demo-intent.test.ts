// src/app/demo-intent.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { t } from "./i18n";
import {
  DEMO_CREATED_LOCALLY_KEY,
  DEMO_INTENT_KEY,
  clearDemoCreatedLocally,
  clearDemoIntent,
  readDemoCreatedLocally,
  readDemoIntent,
  setDemoCreatedLocally,
  setDemoIntent,
  useDemoIntentOnBoot,
  type DemoBootDeps,
} from "./demo-intent";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("the demo intent slot", () => {
  it("lives in the aipm-cockpit namespace, so a factory reset wipes it", () => {
    expect(DEMO_INTENT_KEY).toBe("aipm-cockpit:demo-intent");
    expect(DEMO_CREATED_LOCALLY_KEY.startsWith("aipm-cockpit:")).toBe(true);
  });

  it("reads what set stored, and nothing after clear", () => {
    setDemoIntent();
    expect(readDemoIntent()).toBe("turso-setup");
    clearDemoIntent();
    expect(readDemoIntent()).toBeNull();
  });

  it("reads null for any other stored value", () => {
    window.localStorage.setItem(DEMO_INTENT_KEY, "x");
    expect(readDemoIntent()).toBeNull();
  });

  it("reads null, and neither set nor clear throws, when localStorage throws", () => {
    const boom = () => { throw new Error("denied"); };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    expect(readDemoIntent()).toBeNull();
    expect(() => setDemoIntent()).not.toThrow();
    expect(() => clearDemoIntent()).not.toThrow();
    expect(readDemoCreatedLocally()).toBe(false);
    expect(() => setDemoCreatedLocally()).not.toThrow();
    expect(() => clearDemoCreatedLocally()).not.toThrow();
  });

  it("keeps the created-locally notice in a slot of its own", () => {
    setDemoCreatedLocally();
    expect(readDemoCreatedLocally()).toBe(true);
    expect(readDemoIntent()).toBeNull();
    clearDemoCreatedLocally();
    expect(readDemoCreatedLocally()).toBe(false);
  });
});

describe("useDemoIntentOnBoot", () => {
  beforeEach(() => window.localStorage.clear());

  function deps(over: Partial<DemoBootDeps> = {}): DemoBootDeps {
    return {
      lang: "en-US", weeks: 27, showEmptyState: false, settled: false, tursoUsable: true,
      showToast: vi.fn(), showToastAction: vi.fn(), loadDemo: vi.fn(async () => {}),
      ...over,
    };
  }

  it("with the intent stored and the empty state showing, shows the note and clears the intent", () => {
    setDemoIntent();
    const d = deps({ showEmptyState: true });
    const { result } = renderHook(() => useDemoIntentOnBoot(d));
    expect(result.current.connectedNote).toBe(true);
    expect(readDemoIntent()).toBeNull();
    expect(d.showToastAction).not.toHaveBeenCalled();
  });

  it("shows no note without the intent", () => {
    const { result } = renderHook(() => useDemoIntentOnBoot(deps({ showEmptyState: true })));
    expect(result.current.connectedNote).toBe(false);
  });

  it("shows no note when Turso is not usable, and still clears the intent", () => {
    setDemoIntent();
    const d = deps({ showEmptyState: true, tursoUsable: false });
    const { result } = renderHook(() => useDemoIntentOnBoot(d));
    expect(result.current.connectedNote).toBe(false);
    expect(readDemoIntent()).toBeNull();
  });

  it("with projects present, offers the demo in a toast once and clears the intent", () => {
    setDemoIntent();
    const d = deps({ settled: true });
    const { result, rerender } = renderHook(() => useDemoIntentOnBoot(d));
    rerender();
    expect(result.current.connectedNote).toBe(false);
    expect(d.showToastAction).toHaveBeenCalledTimes(1);
    const [kind, text, action] = vi.mocked(d.showToastAction).mock.calls[0];
    expect(kind).toBe("info");
    expect(text).toBe(t("en-US", "demoTursoConnectedNote", 27));
    expect(action.labelKey).toBe("tourLoadDemo");
    action.run();
    expect(d.loadDemo).toHaveBeenCalledTimes(1);
    expect(readDemoIntent()).toBeNull();
  });

  it("waits until the boot settles before deciding, and keeps the intent meanwhile", () => {
    setDemoIntent();
    let d = deps();
    const { rerender } = renderHook(() => useDemoIntentOnBoot(d));
    expect(d.showToastAction).not.toHaveBeenCalled();
    expect(readDemoIntent()).toBe("turso-setup");
    d = { ...d, settled: true };
    rerender();
    expect(d.showToastAction).toHaveBeenCalledTimes(1);
    expect(readDemoIntent()).toBeNull();
  });

  it("offers no toast when Turso is not usable", () => {
    setDemoIntent();
    const d = deps({ settled: true, tursoUsable: false });
    renderHook(() => useDemoIntentOnBoot(d));
    expect(d.showToastAction).not.toHaveBeenCalled();
    expect(readDemoIntent()).toBeNull();
  });

  // Review Focus 3: StrictMode double-invokes the initializer and the effect. A read-and-clear in
  // the initializer would hand the second call an empty slot and the note would never show.
  it("under StrictMode still shows the note", () => {
    setDemoIntent();
    const { result } = renderHook(() => useDemoIntentOnBoot(deps({ showEmptyState: true })), { reactStrictMode: true });
    expect(result.current.connectedNote).toBe(true);
    expect(readDemoIntent()).toBeNull();
  });

  it("under StrictMode offers the toast once", () => {
    setDemoIntent();
    const d = deps({ settled: true });
    renderHook(() => useDemoIntentOnBoot(d), { reactStrictMode: true });
    expect(d.showToastAction).toHaveBeenCalledTimes(1);
  });

  describe("the created-locally notice", () => {
    it("after the reload, toasts once the boot settles, then clears", () => {
      setDemoCreatedLocally();
      let d = deps();
      const { rerender } = renderHook(() => useDemoIntentOnBoot(d));
      expect(d.showToast).not.toHaveBeenCalled();
      expect(readDemoCreatedLocally()).toBe(true);
      d = { ...d, settled: true };
      rerender();
      rerender();
      expect(d.showToast).toHaveBeenCalledTimes(1);
      expect(d.showToast).toHaveBeenCalledWith("info", t("en-US", "demoCreatedLocallyToast"));
      expect(readDemoCreatedLocally()).toBe(false);
    });

    it("under StrictMode toasts once", () => {
      setDemoCreatedLocally();
      const d = deps({ settled: true });
      renderHook(() => useDemoIntentOnBoot(d), { reactStrictMode: true });
      expect(d.showToast).toHaveBeenCalledTimes(1);
    });

    it("does not toast on a boot without the notice", () => {
      const d = deps({ settled: true });
      renderHook(() => useDemoIntentOnBoot(d));
      expect(d.showToast).not.toHaveBeenCalled();
    });
  });
});
