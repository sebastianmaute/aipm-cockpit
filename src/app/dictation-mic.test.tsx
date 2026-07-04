import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDictationMic } from "./dictation-mic";
import { getActiveDictationTarget, setActiveDictationTarget } from "./dictation-target";

vi.mock("./use-push-to-talk", () => ({
  usePushToTalk: () => ({ listening: false, transcribing: false, supported: true, buttonHandlers: {}, toggle: () => {}, press: vi.fn(), release: vi.fn() }),
}));

beforeEach(() => setActiveDictationTarget(null));

describe("useDictationMic", () => {
  it("registers/clears the active target on focus/blur", () => {
    const { result } = renderHook(() => useDictationMic({ lang: "en-US", label: "Notes", onAppendFinal: vi.fn() }));
    result.current.registration.onFocus();
    expect(getActiveDictationTarget()?.label).toBe("Notes");
    result.current.registration.onBlur();
    expect(getActiveDictationTarget()).toBeNull();
  });
  it("exposes a mic element when supported", () => {
    const { result } = renderHook(() => useDictationMic({ lang: "en-US", label: "Notes", onAppendFinal: vi.fn() }));
    expect(result.current.mic).not.toBeNull();
  });

  it("clears the active target on unmount", () => {
    const { result, unmount } = renderHook(() => useDictationMic({ lang: "en-US", label: "Notes", onAppendFinal: vi.fn() }));
    result.current.registration.onFocus();
    expect(getActiveDictationTarget()?.label).toBe("Notes");
    unmount();
    expect(getActiveDictationTarget()).toBeNull();
  });

  it("keeps the active target across re-renders (stable identity)", () => {
    const { result, rerender } = renderHook(
      (props: { label: string }) => useDictationMic({ lang: "en-US", label: props.label, onAppendFinal: vi.fn() }),
      { initialProps: { label: "Notes" } },
    );
    result.current.registration.onFocus();
    expect(getActiveDictationTarget()?.label).toBe("Notes");
    rerender({ label: "Notes" }); // same label → same target → cleanup must NOT null it
    expect(getActiveDictationTarget()?.label).toBe("Notes");
  });
});
