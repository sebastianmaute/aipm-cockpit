import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStableHandlers } from "./use-stable-handlers";

type Bag = { onA: (n: number) => number; onB?: () => void };

describe("useStableHandlers", () => {
  it("keeps each handler's identity across renders with fresh handlers", () => {
    const { result, rerender } = renderHook((bag: Bag) => useStableHandlers(bag), {
      initialProps: { onA: (n: number) => n, onB: () => {} },
    });
    const first = result.current;
    rerender({ onA: (n: number) => n + 1, onB: () => {} });
    expect(result.current).toBe(first);
    expect(result.current.onA).toBe(first.onA);
  });

  it("calls the handler from the LATEST render and returns its value", () => {
    const old = vi.fn((n: number) => n);
    const next = vi.fn((n: number) => n * 10);
    const { result, rerender } = renderHook((bag: Bag) => useStableHandlers(bag), {
      initialProps: { onA: old },
    });
    const held = result.current.onA;
    rerender({ onA: next });
    expect(held(4)).toBe(40);
    expect(next).toHaveBeenCalledWith(4);
    expect(old).not.toHaveBeenCalled();
  });

  it("keeps an absent handler undefined, and mints a new bag when one appears", () => {
    const { result, rerender } = renderHook((bag: Bag) => useStableHandlers(bag), {
      initialProps: { onA: (n: number) => n, onB: undefined } as Bag,
    });
    expect(result.current.onB).toBeUndefined();
    const first = result.current;
    const onB = vi.fn();
    rerender({ onA: (n: number) => n, onB });
    expect(result.current).not.toBe(first);
    result.current.onB!();
    expect(onB).toHaveBeenCalledTimes(1);
  });
});
