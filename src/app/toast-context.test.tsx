import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ToastProvider, useToastContext } from "./toast-context";

function Caller({ onReady }: { onReady: (fn: (k: "info" | "error", t: string) => void) => void }) {
  const showToast = useToastContext();
  onReady(showToast);
  return null;
}

describe("toast-context", () => {
  it("returns a no-op when no provider is mounted (does not throw)", () => {
    let fn: ((k: "info" | "error", t: string) => void) | null = null;
    render(<Caller onReady={(f) => (fn = f)} />);
    expect(() => fn!("info", "x")).not.toThrow();
  });

  it("delivers showToast from the provider", () => {
    const spy = vi.fn();
    let fn: ((k: "info" | "error", t: string) => void) | null = null;
    render(
      <ToastProvider value={{ showToast: spy, showToastAction: spy }}>
        <Caller onReady={(f) => (fn = f)} />
      </ToastProvider>,
    );
    fn!("info", "hello");
    expect(spy).toHaveBeenCalledWith("info", "hello");
  });
});
