import { describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDenominationEpoch } from "./use-denomination-epoch";

type Props = { currency: string; length: number };

function setup(onChange: () => void) {
  return renderHook(({ currency, length }: Props) => useDenominationEpoch(currency, length, onChange), {
    initialProps: { currency: "EUR", length: 0 },
  });
}

describe("useDenominationEpoch", () => {
  test("starts at zero and does not call onChange on mount", () => {
    const onChange = vi.fn();
    const { result } = setup(onChange);
    expect(result.current()).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("a currency change increments the count and calls onChange once", () => {
    const onChange = vi.fn();
    const { result, rerender } = setup(onChange);
    rerender({ currency: "GBP", length: 1 });
    expect(result.current()).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("a history-length change alone (a coalesced round trip) also counts", () => {
    const onChange = vi.fn();
    const { result, rerender } = setup(onChange);
    rerender({ currency: "EUR", length: 2 });
    expect(result.current()).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("a re-render with an unchanged key changes nothing", () => {
    const onChange = vi.fn();
    const { result, rerender } = setup(onChange);
    rerender({ currency: "GBP", length: 1 });
    rerender({ currency: "GBP", length: 1 });
    rerender({ currency: "GBP", length: 1 });
    expect(result.current()).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("the reader keeps one identity across changes", () => {
    const { result, rerender } = setup(vi.fn());
    const first = result.current;
    rerender({ currency: "USD", length: 1 });
    expect(result.current).toBe(first);
    expect(first()).toBe(1);
  });
});
