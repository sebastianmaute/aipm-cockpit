// src/app/use-holiday-set.test.ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHolidaySet } from "./use-holiday-set";

// The real `holidaysForCountries` lazy-imports `date-holidays` (+ moment),
// whose wall-clock load time under the parallel full suite could exceed
// waitFor's 1s default and flake this test. Mock it so the hook's
// async-resolve and cancel-on-unmount behavior is verified deterministically,
// without the heavy dynamic import. (Module mocks are scoped to this file —
// other suites still use the real holidays module.)
vi.mock("./holidays", () => ({
  holidaysForCountries: vi.fn(async (codes: string[]) =>
    codes.length ? new Set(["2026-01-01", "2026-12-25"]) : new Set<string>(),
  ),
}));

describe("useHolidaySet", () => {
  it("returns empty set initially", () => {
    const { result } = renderHook(() =>
      useHolidaySet({ holidayCountries: ["DE"] }),
    );
    expect(result.current.holidaySet.size).toBe(0);
  });

  it("resolves holidays after async load", async () => {
    const { result } = renderHook(() =>
      useHolidaySet({ holidayCountries: ["DE"] }),
    );
    await waitFor(() => {
      expect(result.current.holidaySet.size).toBeGreaterThan(0);
    });
  });

  it("cancels in-flight load on unmount — no state update after unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useHolidaySet({ holidayCountries: ["DE"] }),
    );
    unmount();
    // No "Can't perform a React state update on an unmounted component" warning
    await act(async () => {});
    expect(result.current.holidaySet.size).toBe(0);
  });
});
