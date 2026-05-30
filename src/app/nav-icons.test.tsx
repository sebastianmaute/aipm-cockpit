import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NavIcon } from "./nav-icons";
import { allNavViews } from "./nav-config";

describe("NavIcon", () => {
  it("renders a decorative (aria-hidden, non-focusable) svg with a path for every sidebar view", () => {
    for (const view of allNavViews()) {
      const { container, unmount } = render(<NavIcon view={view} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
      expect(svg!.getAttribute("focusable")).toBe("false");
      expect(svg!.querySelector("path")).not.toBeNull();
      unmount();
    }
  });

  it("uses the default size class, or a custom className when provided", () => {
    const { container: a } = render(<NavIcon view="open-points" />);
    expect(a.querySelector("svg")!.getAttribute("class")).toContain("h-5");

    const { container: b } = render(<NavIcon view="open-points" className="custom-size" />);
    expect(b.querySelector("svg")!.getAttribute("class")).toBe("custom-size");
  });
});
