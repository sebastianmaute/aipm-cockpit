import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEntityCombobox } from "./entity-combobox";

const OPTS = [
  { value: "a", code: "Task", label: "Alpha" },
  { value: "b", code: "Task", label: "Beta" },
];

describe("useEntityCombobox", () => {
  it("wraps the highlight at both ends", () => {
    const { result } = renderHook(() =>
      useEntityCombobox({ query: "a", options: OPTS, identity: (o) => o.value }),
    );
    act(() => result.current.move(1));
    expect(result.current.active).toBe(0);
    act(() => result.current.move(-1));
    expect(result.current.active).toBe(1);
  });

  it("disarms a highlight whose option changed identity under a standing query", () => {
    const { result, rerender } = renderHook(
      ({ options }) =>
        useEntityCombobox({
          query: "a",
          options,
          identity: (o: { value: string }) => o.value,
        }),
      { initialProps: { options: OPTS } },
    );
    act(() => result.current.move(1));
    expect(result.current.active).toBe(0);
    // Same index, DIFFERENT option — the range clamp cannot see this.
    rerender({
      options: [{ value: "z", code: "Task", label: "Zeta" }, ...OPTS],
    });
    expect(result.current.active).toBe(-1);
  });

  it("resets on a query change", () => {
    const { result, rerender } = renderHook(
      ({ query }) =>
        useEntityCombobox({
          query,
          options: OPTS,
          identity: (o) => o.value,
        }),
      { initialProps: { query: "a" } },
    );
    act(() => result.current.move(1));
    rerender({ query: "ab" });
    expect(result.current.active).toBe(-1);
  });
});
