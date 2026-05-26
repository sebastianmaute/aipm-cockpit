import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFxRates } from "./use-fx-rates";
import type { FxRates } from "./types";

const sample: FxRates = { base: "EUR", date: "2026-05-26", fetchedAt: "x", rates: { EUR: 1, USD: 1.08, GBP: 0.85 } };

describe("useFxRates", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  test("fetches and reports the rate table via onLoaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => sample })) as unknown as typeof fetch);
    const onLoaded = vi.fn();
    const { result } = renderHook(() => useFxRates(onLoaded));
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(sample));
    expect(result.current.error).toBeNull();
  });
  test("surfaces an error string on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: "x" }) })) as unknown as typeof fetch);
    const { result } = renderHook(() => useFxRates(vi.fn()));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBeTruthy();
  });
});
