import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { AI_KEY_CHECK_DEBOUNCE_MS, AI_KEY_CHECK_TIMEOUT_MS, useAiKeyCheck, useAiKeyStatus } from "./use-ai-key-check";
import { AI_DISCLOSURE_VERSION, newConsent, type AiConsent } from "./ai-consent";
import { __resetAiKeyStatusForTests, getAiKeyStatus, reportAiKeyResponse } from "./ai-key-status";
import { ANTHROPIC_MODELS_URL } from "./anthropic-models";
import { clearSessionAiKey, setSessionAiKey } from "./session-ai-key";

const KEY_A = "sk-ant-api03-StartupCheckKeyAAAAAAAA";
const KEY_B = "sk-ant-api03-StartupCheckKeyBBBBBBBB";

/** A current interactive consent (M4: the check needs it). */
const CONSENT = newConsent(new Date("2026-10-01T00:00:00Z"));

type Props = { apiKey: string; enabled: boolean; hydrated: boolean; isPopout: boolean; consent?: AiConsent };
const BASE: Props = { apiKey: KEY_A, enabled: true, hydrated: true, isPopout: false, consent: CONSENT };

function mount(initial: Partial<Props> = {}) {
  return renderHook((p: Props) => useAiKeyCheck({ ai: { enabled: p.enabled, apiKey: p.apiKey, consent: p.consent }, hydrated: p.hydrated, isPopout: p.isPopout }), {
    initialProps: { ...BASE, ...initial },
  });
}

function stubStatus(status: number) {
  const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => ({ data: [] }) });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(AI_KEY_CHECK_DEBOUNCE_MS + 10);
  });
}

beforeEach(() => {
  __resetAiKeyStatusForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useAiKeyCheck — §650 start-up and on-save key check", () => {
  // M4 — no request to Anthropic before the interactive consent: the switch on and a valid key are not enough.
  it("runs no check while the consent is missing or stale, and runs once it is accepted", async () => {
    const fetchMock = stubStatus(200);
    const { rerender } = mount({ consent: undefined });
    await settle();
    rerender({ ...BASE, consent: { acceptedAt: "2026-01-01T00:00:00.000Z", disclosureVersion: AI_DISCLOSURE_VERSION + 1 } });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(BASE);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });


  // §717 — a passphrase key reads "" in settings; once it is unlocked on this page, that key is checked.
  it("checks a key unlocked on this page when the stored key reads blank", async () => {
    const fetchMock = stubStatus(200);
    setSessionAiKey(KEY_A);
    try {
      renderHook(() => useAiKeyCheck({ ai: { enabled: true, apiKey: "", consent: CONSENT }, hydrated: true, isPopout: false }));
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY_A);
    } finally {
      clearSessionAiKey();
    }
  });

  it("runs ONE GET /v1/models on load with AI enabled and a key, with the key only in the header", async () => {
    const fetchMock = stubStatus(200);
    const { rerender } = mount();
    expect(fetchMock).not.toHaveBeenCalled(); // debounced
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ANTHROPIC_MODELS_URL);
    expect(url).not.toContain(KEY_A);
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY_A);
    expect(getAiKeyStatus()).toBe("ok");
    // A re-render with the same key does not check again.
    rerender({ ...BASE });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["AI disabled", { enabled: false }],
    ["an empty key", { apiKey: "" }],
    ["a popout", { isPopout: true }],
    ["settings not yet hydrated", { hydrated: false }],
  ] as const)("does not run with %s", async (_label, override) => {
    const fetchMock = stubStatus(200);
    mount(override);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs again after the key changes — once, on the settled key (keystrokes are debounced)", async () => {
    const fetchMock = stubStatus(200);
    const { rerender } = mount();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Typing: intermediate values inside the debounce window never fire a request.
    rerender({ ...BASE, apiKey: `${KEY_B.slice(0, -2)}` });
    await act(async () => { await vi.advanceTimersByTimeAsync(AI_KEY_CHECK_DEBOUNCE_MS / 2); });
    rerender({ ...BASE, apiKey: KEY_B });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(((fetchMock.mock.calls[1] as [string, RequestInit])[1].headers as Record<string, string>)["x-api-key"]).toBe(KEY_B);
  });

  it("a key change resets the verdict to unknown before the new check answers", async () => {
    stubStatus(401);
    const { rerender } = mount();
    await settle();
    expect(getAiKeyStatus()).toBe("rejected");
    rerender({ ...BASE, apiKey: KEY_B });
    expect(getAiKeyStatus()).toBe("unknown");
  });

  it.each([
    [401, "rejected"],
    [403, "forbidden"],
    [200, "ok"],
  ] as const)("%i → %s", async (status, expected) => {
    stubStatus(status);
    mount();
    await settle();
    expect(getAiKeyStatus()).toBe(expected);
  });

  it("any other status leaves the verdict unchanged", async () => {
    reportAiKeyResponse(KEY_A, 401);
    stubStatus(500);
    mount();
    await settle();
    expect(getAiKeyStatus()).toBe("rejected");
  });

  it("a network error leaves the verdict unchanged", async () => {
    reportAiKeyResponse(KEY_A, 200);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    mount();
    await settle();
    expect(getAiKeyStatus()).toBe("ok");
  });

  it("a timeout aborts the check and leaves the verdict unchanged", async () => {
    reportAiKeyResponse(KEY_A, 401);
    let seenSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      seenSignal = init.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }));
    mount();
    await settle();
    expect(seenSignal?.aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(AI_KEY_CHECK_TIMEOUT_MS + 10); });
    expect(seenSignal?.aborted).toBe(true);
    expect(getAiKeyStatus()).toBe("rejected");
  });
});

describe("useAiKeyCheck — a late answer for an OLD key", () => {
  it("is dropped: start a check for KEY_A, switch to KEY_B, then A answers 401 — the verdict stays unknown", async () => {
    let resolveA!: (r: unknown) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)["x-api-key"];
      // A ignores its abort on purpose: the store, not the abort, must drop the late answer.
      if (key === KEY_A) return new Promise((resolve) => { resolveA = resolve; });
      return new Promise(() => {}); // B never answers
    }));
    const { rerender } = mount();
    await settle(); // A is in flight
    expect(resolveA).toBeTypeOf("function");
    rerender({ ...BASE, apiKey: KEY_B });
    expect(getAiKeyStatus()).toBe("unknown");
    await act(async () => {
      resolveA({ ok: false, status: 401, json: async () => ({}) });
      await Promise.resolve();
    });
    expect(getAiKeyStatus()).toBe("unknown");
  });
});

describe("useAiKeyStatus", () => {
  it("re-renders with the store's verdict", () => {
    const { result } = renderHook(() => useAiKeyStatus());
    expect(result.current).toBe("unknown");
    act(() => reportAiKeyResponse(KEY_A, 403));
    expect(result.current).toBe("forbidden");
  });
});
