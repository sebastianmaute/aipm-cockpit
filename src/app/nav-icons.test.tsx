import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NavIcon } from "./nav-icons";
import { allNavViews } from "./nav-config";

describe("NavIcon", () => {
  it("renders a decorative (aria-hidden, non-focusable) svg with geometry for every sidebar view", () => {
    for (const view of allNavViews()) {
      const { container, unmount } = render(<NavIcon view={view} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
      expect(svg!.getAttribute("focusable")).toBe("false");
      // Not querySelector("path"): 5 of the 69 barrel icons render no <path> —
      // Bars2Icon draws a <line>, the two ellipsis icons draw <circle>s, and
      // Squares2X2Icon/StopIcon draw <rect>s. Squares2X2Icon is the Dashboard
      // nav icon, so a path-specific assertion is wrong for this loop
      // specifically, not merely fragile. Assert the svg drew SOME geometry.
      expect(svg!.children.length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("uses the default size class, or a custom className when provided", () => {
    const { container: a } = render(<NavIcon view="open-points" />);
    expect(a.querySelector("svg")!.getAttribute("class")).toContain("h-5");

    const { container: b } = render(<NavIcon view="open-points" className="custom-size" />);
    const custom = b.querySelector("svg")!.getAttribute("class")!;
    expect(custom).toContain("custom-size");
    // ★ NOT toBe: lucide prepends its own `lucide lucide-<name>` classes to
    //   every icon, so exact equality is no longer possible. What this test is
    //   actually for is that a custom className REPLACES the default size
    //   rather than joining it — so assert the default is absent.
    expect(custom).not.toContain("h-5");
  });
});
