import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { useEntityCombobox } from "./entity-combobox";

const OPTS = [
  { value: "a", code: "Task", label: "Alpha" },
  { value: "b", code: "Task", label: "Beta" },
];

/** A minimal stand-in for the React synthetic event `onKeyDown` reads. Only
 *  `key` and the two suppressors are touched, so the cast is honest. */
function keyEvent(key: string) {
  const e = {
    key,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return e as unknown as KeyboardEvent<HTMLInputElement> & typeof e;
}

describe("useEntityCombobox", () => {
  it("wraps the highlight at both ends", () => {
    const { result } = renderHook(() =>
      useEntityCombobox({
        query: "a",
        options: OPTS,
        identity: (o) => o.value,
        onCommit: () => {},
      }),
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
          onCommit: () => {},
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
          onCommit: () => {},
        }),
      { initialProps: { query: "a" } },
    );
    act(() => result.current.move(1));
    rerender({ query: "ab" });
    expect(result.current.active).toBe(-1);
  });

  // ★ The contract C3 depends on: `EntityLinkPicker` commits the whole ENTRY,
  // so the hook must hand back the option OBJECT — not its `value`, not its
  // index. Asserting on argument IDENTITY is what pins that; a test comparing
  // fields would pass against a shallow copy or a rebuilt triple.
  it("commits the active option object on Enter, exactly once", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useEntityCombobox({
        query: "a",
        options: OPTS,
        identity: (o) => o.value,
        onCommit,
      }),
    );
    act(() => result.current.move(1));
    expect(result.current.active).toBe(0);

    const enter = keyEvent("Enter");
    act(() => result.current.onKeyDown(enter));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(OPTS[0]);
    // Identity, not shape: `toHaveBeenCalledWith` is a deep compare and would
    // accept a rebuilt `{value:"a",…}`.
    expect(onCommit.mock.calls[0][0]).toBe(OPTS[0]);
    // The pickers sit in <form> modals; a claimed Enter must not also submit.
    expect(enter.preventDefault).toHaveBeenCalledTimes(1);
  });
});
