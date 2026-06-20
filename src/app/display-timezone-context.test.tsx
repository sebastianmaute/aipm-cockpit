import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { DisplayTimezoneProvider, useDisplayTimezone } from "./display-timezone-context";

const wrap = (effectiveTz: string) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    <DisplayTimezoneProvider effectiveTz={effectiveTz}>{children}</DisplayTimezoneProvider>;
  return Wrapper;
};

describe("display-timezone-context", () => {
  it("defaults displayTz to effectiveTz, not overridden", () => {
    const { result } = renderHook(() => useDisplayTimezone(), { wrapper: wrap("Europe/Berlin") });
    expect(result.current.displayTz).toBe("Europe/Berlin");
    expect(result.current.isOverridden).toBe(false);
  });
  it("setDisplayOverride switches displayTz + marks overridden; reset clears", () => {
    const { result } = renderHook(() => useDisplayTimezone(), { wrapper: wrap("Europe/Berlin") });
    act(() => result.current.setDisplayOverride("UTC"));
    expect(result.current.displayTz).toBe("UTC");
    expect(result.current.isOverridden).toBe(true);
    act(() => result.current.resetDisplayTz());
    expect(result.current.displayTz).toBe("Europe/Berlin");
    expect(result.current.isOverridden).toBe(false);
  });
});
