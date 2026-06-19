import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { ServiceWorkerRegistrar } from "./service-worker-registrar";

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

describe("ServiceWorkerRegistrar", () => {
  it("registers /sw.js when serviceWorker is supported", () => {
    const register = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });
    render(<ServiceWorkerRegistrar />);
    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("renders nothing", () => {
    const { container } = render(<ServiceWorkerRegistrar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("no-ops (no throw) when serviceWorker is unsupported", () => {
    expect(() => render(<ServiceWorkerRegistrar />)).not.toThrow();
  });
});
