// §701 — `AiProviders` tells unattended runs whether the guide library has
// loaded: not ready only while grounding is on and the guides are still loading.
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { AiProviders, useActionGuidesReady } from "./action-guides-context";
import { defaultSettings } from "./settings-types";

function readyWith(groundInGuides: boolean, guidesReady: boolean): boolean {
  const ai = { ...defaultSettings.ai, groundInGuides };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AiProviders lang="en-US" ai={ai} showToast={vi.fn()} guides={[]} guidesReady={guidesReady}>
      {children}
    </AiProviders>
  );
  return renderHook(() => useActionGuidesReady(), { wrapper }).result.current;
}

describe("AiProviders ready flag", () => {
  it("is not ready while grounding is on and the guides are loading", () => {
    expect(readyWith(true, false)).toBe(false);
  });
  it("is ready once they load, or whenever grounding is off", () => {
    expect(readyWith(true, true)).toBe(true);
    expect(readyWith(false, false)).toBe(true);
  });
  it("is ready outside any provider: nothing is loading", () => {
    expect(renderHook(() => useActionGuidesReady()).result.current).toBe(true);
  });
});
