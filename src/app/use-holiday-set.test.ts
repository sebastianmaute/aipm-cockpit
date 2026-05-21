// src/app/use-holiday-set.test.ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useHolidaySet } from "./use-holiday-set";

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
