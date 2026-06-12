import { describe, expect, test, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { server } from "../test/msw-server";
import { useFxRates } from "./use-fx-rates";
import type { FxRates } from "./types";

const sample: FxRates = { base: "EUR", date: "2026-05-26", fetchedAt: "x", rates: { EUR: 1, USD: 1.08, GBP: 0.85 } };

describe("useFxRates", () => {
  test("fetches and reports the rate table via onLoaded", async () => {
    server.use(http.get("*/api/ecb", () => HttpResponse.json(sample)));
    const onLoaded = vi.fn();
    const { result } = renderHook(() => useFxRates(onLoaded));
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(sample));
    expect(result.current.error).toBeNull();
  });

  test("surfaces an error string on failure", async () => {
    server.use(http.get("*/api/ecb", () => HttpResponse.json({ error: "x" }, { status: 502 })));
    const { result } = renderHook(() => useFxRates(vi.fn()));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBeTruthy();
  });
});
