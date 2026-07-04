import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFxRates } from "./use-fx-rates";

describe("useFxRates", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("resolves to null and reports no error on success", async () => {
    const onLoaded = vi.fn();
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ base: "EUR", date: "2026-07-01", fetchedAt: "2026-07-01T00:00:00.000Z", rates: {} }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useFxRates(onLoaded));

    let resolved: string | null = "unset";
    await act(async () => {
      resolved = await result.current.refresh();
    });

    expect(resolved).toBeNull();
    expect(result.current.error).toBeNull();
    expect(onLoaded).toHaveBeenCalled();
  });

  it("resolves to the error message on a rejected fetch", async () => {
    const onLoaded = vi.fn();
    global.fetch = vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch;

    const { result } = renderHook(() => useFxRates(onLoaded));

    let resolved: string | null = "unset";
    await act(async () => {
      resolved = await result.current.refresh();
    });

    expect(resolved).toBe("network down");
    expect(result.current.error).toBe("network down");
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("resolves to the error message on a non-ok response", async () => {
    const onLoaded = vi.fn();
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "upstream failed" }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useFxRates(onLoaded));

    let resolved: string | null = "unset";
    await act(async () => {
      resolved = await result.current.refresh();
    });

    expect(resolved).toBe("upstream failed");
    expect(result.current.error).toBe("upstream failed");
    expect(onLoaded).not.toHaveBeenCalled();
  });
});
