// src/app/use-ai-usage.test.ts
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAiUsage } from "./use-ai-usage";

const AI_USAGE_KEY = "lop-app:ai-usage";

beforeEach(() => {
  localStorage.clear();
});

describe("useAiUsage", () => {
  describe("initial state", () => {
    it("sessionTotal starts at 0", async () => {
      const { result } = renderHook(() => useAiUsage());
      await act(async () => {});
      expect(result.current.sessionTotal).toBe(0);
    });

    it("weekTotal starts at 0 with empty storage", async () => {
      const { result } = renderHook(() => useAiUsage());
      await act(async () => {});
      expect(result.current.weekTotal).toBe(0);
    });

    it("nextReset is a Date", async () => {
      const { result } = renderHook(() => useAiUsage());
      await act(async () => {});
      expect(result.current.nextReset).toBeInstanceOf(Date);
    });
  });

  describe("record", () => {
    it("record increments sessionTotal by input + output", async () => {
      const { result } = renderHook(() => useAiUsage());
      await act(async () => {});

      act(() => {
        result.current.record({ input: 100, output: 50 });
      });

      expect(result.current.sessionTotal).toBe(150);
    });

    it("record accumulates multiple calls", async () => {
      const { result } = renderHook(() => useAiUsage());
      await act(async () => {});

      act(() => {
        result.current.record({ input: 100, output: 50 });
        result.current.record({ input: 200, output: 75 });
      });

      expect(result.current.sessionTotal).toBe(425);
    });

    it("record persists buckets to localStorage", async () => {
      const { result } = renderHook(() => useAiUsage());
      await act(async () => {});

      act(() => {
        result.current.record({ input: 300, output: 100 });
      });

      const raw = localStorage.getItem(AI_USAGE_KEY);
      expect(raw).not.toBeNull();
      const buckets = JSON.parse(raw!) as Record<string, { input: number; output: number }>;
      const values = Object.values(buckets);
      expect(values).toHaveLength(1);
      expect(values[0].input).toBe(300);
      expect(values[0].output).toBe(100);
    });

    it("record updates weekTotal", async () => {
      const { result } = renderHook(() => useAiUsage());
      await act(async () => {});

      act(() => {
        result.current.record({ input: 400, output: 200 });
      });

      expect(result.current.weekTotal).toBe(600);
    });
  });

  describe("persistence — load from localStorage", () => {
    it("loads existing buckets and reflects them in weekTotal", async () => {
      // Seed a bucket for today so it falls within the current week.
      const today = new Date();
      const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const seed = { [key]: { input: 1000, output: 500 } };
      localStorage.setItem(AI_USAGE_KEY, JSON.stringify(seed));

      const { result } = renderHook(() => useAiUsage());
      await act(async () => {});

      expect(result.current.weekTotal).toBe(1500);
    });

    it("malformed stored JSON starts with empty buckets (weekTotal = 0)", async () => {
      localStorage.setItem(AI_USAGE_KEY, "not-json{{");
      const { result } = renderHook(() => useAiUsage());
      await act(async () => {});
      expect(result.current.weekTotal).toBe(0);
      expect(result.current.sessionTotal).toBe(0);
    });

    it("stored array (wrong shape) starts with empty buckets", async () => {
      localStorage.setItem(AI_USAGE_KEY, JSON.stringify([1, 2, 3]));
      const { result } = renderHook(() => useAiUsage());
      await act(async () => {});
      expect(result.current.weekTotal).toBe(0);
    });

    it("record appends to pre-existing buckets rather than overwriting them", async () => {
      const today = new Date();
      const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const seed = { [key]: { input: 1000, output: 500 } };
      localStorage.setItem(AI_USAGE_KEY, JSON.stringify(seed));

      const { result } = renderHook(() => useAiUsage());
      await act(async () => {});

      act(() => {
        result.current.record({ input: 100, output: 50 });
      });

      const raw = localStorage.getItem(AI_USAGE_KEY)!;
      const buckets = JSON.parse(raw) as Record<string, { input: number; output: number }>;
      expect(buckets[key].input).toBe(1100);
      expect(buckets[key].output).toBe(550);
    });
  });
});
