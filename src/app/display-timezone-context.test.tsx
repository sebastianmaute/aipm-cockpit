import { describe, expect, it } from "vitest";
import { renderHook, render, act } from "@testing-library/react";
import { useState } from "react";
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
  it("clears a stranded override when the switcher is hidden (showSwitcher false)", () => {
    let setShow: (b: boolean) => void = () => {};
    let ctx: ReturnType<typeof useDisplayTimezone> | undefined;
    function Probe() {
      ctx = useDisplayTimezone();
      return null;
    }
    function Harness() {
      const [show, setShowState] = useState(true);
      setShow = setShowState;
      return (
        <DisplayTimezoneProvider effectiveTz="Europe/Berlin" showSwitcher={show}>
          <Probe />
        </DisplayTimezoneProvider>
      );
    }
    render(<Harness />);
    act(() => ctx!.setDisplayOverride("UTC"));
    expect(ctx!.isOverridden).toBe(true);
    // Hiding the switcher must drop the now-uncontrollable override.
    act(() => setShow(false));
    expect(ctx!.isOverridden).toBe(false);
    expect(ctx!.displayTz).toBe("Europe/Berlin");
  });
});
