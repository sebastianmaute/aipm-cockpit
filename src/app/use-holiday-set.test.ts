// src/app/use-holiday-set.test.ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { holidaysForCountries } from "./holidays";
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

  // ★★★ READINESS. An empty `holidaySet` is ambiguous by construction — it is
  // what a mid-load, a rejected fetch and a no-countries user all look like —
  // so `timelogNonWorkingDay` floors on THIS flag, never on the set's size.
  // See the floor in `timelog-policy.ts`.
  describe("holidaysReady", () => {
    it("is false before the load resolves and true after", async () => {
      const { result } = renderHook(() =>
        useHolidaySet({ holidayCountries: ["DE"] }),
      );
      expect(result.current.holidaysReady).toBe(false);
      await waitFor(() => {
        expect(result.current.holidaysReady).toBe(true);
      });
      expect(result.current.holidaySet.size).toBeGreaterThan(0);
    });

    // ★★ THE ANTI-VACUITY CONTROL for the whole flag. If readiness merely
    // tracked "the set has members", this case would report NOT ready forever
    // and the rule would be permanently dark for a user who configured no
    // countries — whose empty set is a real answer, not a missing one.
    it("reaches ready with an EMPTY set when no countries are configured", async () => {
      const { result } = renderHook(() =>
        useHolidaySet({ holidayCountries: [] }),
      );
      await waitFor(() => {
        expect(result.current.holidaysReady).toBe(true);
      });
      expect(result.current.holidaySet.size).toBe(0);
    });

    it("stays not-ready on a rejected fetch, with the rejection handled", async () => {
      // ★★★ `process`, NOT `window.addEventListener("unhandledrejection")`.
      // Measured, not reasoned: the window form NEVER FIRES under jsdom, so
      // the obvious spelling of this assertion passes whether or not the
      // hook's `.catch` exists — proved by deleting the `.catch`, which left
      // all 7 tests GREEN and failed only the RUN. An assertion that agrees
      // with your prior is the one you stop checking. Node's process-level
      // event is the one that actually fires.
      const rejections: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        rejections.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);
      vi.mocked(holidaysForCountries).mockRejectedValueOnce(new Error("offline"));
      try {
        const { result } = renderHook(() =>
          useHolidaySet({ holidayCountries: ["DE"] }),
        );
        // Two macrotask turns: one for the rejection to settle through the
        // hook's own .catch, one for an UNHANDLED rejection to have surfaced.
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
        expect(result.current.holidaysReady).toBe(false);
        expect(result.current.holidaySet.size).toBe(0);
        expect(rejections).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });

    // ★★ A change of countries must invalidate BOTH halves together. Reporting
    // ready against the PREVIOUS countries' holidays is the same false-answer
    // defect as reporting ready mid-load, one refetch later.
    it("resets to not-ready when holidayCountries changes", async () => {
      const { result, rerender } = renderHook(
        ({ countries }: { countries: string[] }) =>
          useHolidaySet({ holidayCountries: countries }),
        { initialProps: { countries: ["DE"] } },
      );
      await waitFor(() => {
        expect(result.current.holidaysReady).toBe(true);
      });

      vi.mocked(holidaysForCountries).mockImplementationOnce(
        async (codes: string[]) => new Set(codes.map((c) => `2026-07-04-${c}`)),
      );
      rerender({ countries: ["US"] });
      // ★★ SYNCHRONOUS, before any await: `rerender` commits the reset render
      // but does not settle the refetch, so this is the reset itself and not a
      // later state. Drop the render-time reconcile and this line goes red —
      // the hook would still be reporting ready against Germany's holidays.
      expect(result.current.holidaysReady).toBe(false);
      expect(result.current.holidaySet.size).toBe(0);

      await waitFor(() => {
        expect(result.current.holidaysReady).toBe(true);
      });
      expect(result.current.holidaySet.has("2026-07-04-US")).toBe(true);
    });
  });
});
