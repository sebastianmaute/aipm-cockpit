// §491 — pins use-storage-banner-reshow.ts on its own: each of the three
// saving-paused banners' dismissals is cleared when ITS cause changes, and only
// then. The harness owns the three `*BannerDismissed` flags exactly as
// task-manager does (seeded `true` so a clear is observable) and hands their
// setters to the hook. Through-TaskManager coverage of the same re-show lives in
// task-manager.truncation-banner.test.tsx.
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { useStorageBannerReshow, type StorageBannerReshowDeps } from "./use-storage-banner-reshow";

type Causes = Pick<
  StorageBannerReshowDeps,
  "truncation" | "decodeFailureNonce" | "malformedQuotesNonce" | "destructiveRefusal" | "loadPause"
>;

const CLEAN: Causes = {
  truncation: null,
  decodeFailureNonce: 0,
  malformedQuotesNonce: 0,
  destructiveRefusal: null,
  loadPause: null,
} as Causes;

const TRUNC = { entries: 5, blocks: 0 } as unknown as Causes["truncation"];
const REFUSAL = {
  prevCollections: 4, prevRecords: 900, curCollections: 1, curRecords: 53, fullWipe: false,
} as unknown as Causes["destructiveRefusal"];

function useHarness(causes: Causes) {
  const [truncationDismissed, setTruncationBannerDismissed] = useState(true);
  const [destructiveDismissed, setDestructiveBannerDismissed] = useState(true);
  const [loadPauseDismissed, setLoadPauseBannerDismissed] = useState(true);
  useStorageBannerReshow({
    ...causes,
    setTruncationBannerDismissed, setDestructiveBannerDismissed, setLoadPauseBannerDismissed,
  });
  return {
    truncationDismissed, destructiveDismissed, loadPauseDismissed,
    dismissAll: () => {
      setTruncationBannerDismissed(true);
      setDestructiveBannerDismissed(true);
      setLoadPauseBannerDismissed(true);
    },
  };
}

function mount(initial: Causes) {
  return renderHook((c: Causes) => useHarness(c), { initialProps: initial });
}

function flags(h: ReturnType<typeof mount>) {
  const { truncationDismissed, destructiveDismissed, loadPauseDismissed } = h.result.current;
  return [truncationDismissed, destructiveDismissed, loadPauseDismissed];
}

/** Mounts on `from`, re-dismisses everything, then moves to `to`. */
function transition(from: Causes, to: Causes) {
  const h = mount(from);
  act(() => h.result.current.dismissAll());
  expect(flags(h)).toEqual([true, true, true]);
  h.rerender(to);
  return h;
}

describe("useStorageBannerReshow — seeds", () => {
  it("leaves every dismissal alone on a clean first render (seeds are null / 0)", () => {
    expect(flags(mount(CLEAN))).toEqual([true, true, true]);
  });

  it("clears each dismissal when its cause is ALREADY present on the first render", () => {
    // The remount-swallow guard: seeded from the live value, a fresh mount would
    // see `value === seed` and keep a pending banner hidden.
    expect(flags(mount({ ...CLEAN, truncation: TRUNC }))).toEqual([false, true, true]);
    expect(flags(mount({ ...CLEAN, decodeFailureNonce: 3 }))).toEqual([false, true, true]);
    expect(flags(mount({ ...CLEAN, malformedQuotesNonce: 2 }))).toEqual([false, true, true]);
    expect(flags(mount({ ...CLEAN, destructiveRefusal: REFUSAL }))).toEqual([true, false, true]);
    expect(flags(mount({ ...CLEAN, loadPause: "load-failed" }))).toEqual([true, true, false]);
  });
});

describe("useStorageBannerReshow — the incomplete-load banner", () => {
  const STANDING: Causes = { ...CLEAN, truncation: TRUNC, decodeFailureNonce: 1, malformedQuotesNonce: 1 };

  it("keeps a dismissal while nothing changes", () => {
    const h = transition(STANDING, STANDING);
    expect(flags(h)).toEqual([true, true, true]);
  });

  it("re-shows on a NEW truncation object, even with equal counts", () => {
    const h = transition(STANDING, { ...STANDING, truncation: { ...(TRUNC as object) } as Causes["truncation"] });
    expect(flags(h)).toEqual([false, true, true]);
  });

  it("re-shows on the decode nonce ALONE", () => {
    const h = transition(STANDING, { ...STANDING, decodeFailureNonce: 2 });
    expect(flags(h)).toEqual([false, true, true]);
  });

  it("re-shows on the malformed-quotes nonce ALONE", () => {
    const h = transition(STANDING, { ...STANDING, malformedQuotesNonce: 2 });
    expect(flags(h)).toEqual([false, true, true]);
  });

  it("records what it saw: the render after a re-show leaves a fresh dismissal alone", () => {
    const h = transition(STANDING, { ...STANDING, decodeFailureNonce: 2 });
    act(() => h.result.current.dismissAll());
    h.rerender({ ...STANDING, decodeFailureNonce: 2 });
    expect(flags(h)).toEqual([true, true, true]);
  });
});

describe("useStorageBannerReshow — the destructive-refusal banner", () => {
  it("re-shows on a different refusal object", () => {
    const h = transition({ ...CLEAN, destructiveRefusal: REFUSAL }, { ...CLEAN, destructiveRefusal: { ...(REFUSAL as object) } as Causes["destructiveRefusal"] });
    expect(flags(h)).toEqual([true, false, true]);
  });

  it("re-shows when the refusal resolves to null, so the NEXT one is not pre-dismissed", () => {
    const h = transition({ ...CLEAN, destructiveRefusal: REFUSAL }, CLEAN);
    expect(flags(h)).toEqual([true, false, true]);
  });

  it("keeps a dismissal at the same refusal identity", () => {
    const h = transition({ ...CLEAN, destructiveRefusal: REFUSAL }, { ...CLEAN, destructiveRefusal: REFUSAL });
    expect(flags(h)).toEqual([true, true, true]);
  });
});

describe("useStorageBannerReshow — the load-pause banner", () => {
  it("re-shows on a new pause reason", () => {
    const h = transition({ ...CLEAN, loadPause: "load-failed" }, { ...CLEAN, loadPause: "empty-refused" });
    expect(flags(h)).toEqual([true, true, false]);
  });

  it("re-shows when the pause lifts", () => {
    const h = transition({ ...CLEAN, loadPause: "load-failed" }, CLEAN);
    expect(flags(h)).toEqual([true, true, false]);
  });

  it("keeps a dismissal while the same pause holds", () => {
    const h = transition({ ...CLEAN, loadPause: "load-failed" }, { ...CLEAN, loadPause: "load-failed" });
    expect(flags(h)).toEqual([true, true, true]);
  });
});
