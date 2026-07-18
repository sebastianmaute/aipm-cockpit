import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaneHeader } from "./pane-header";

describe("PaneHeader", () => {
  test("renders the title as an h2", () => {
    render(<PaneHeader title="Budget" />);
    const h = screen.getByRole("heading", { level: 2, name: "Budget" });
    expect(h.className).toContain("text-lg");
    expect(h.className).toContain("font-medium");
  });

  test("renders a count suffix passed inside title", () => {
    render(
      <PaneHeader title={<>Budget <span>(3)</span></>} />,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Budget (3)");
  });

  test("renders the actions cluster as a print-hidden group", () => {
    render(<PaneHeader title="X" actions={<button type="button">Print</button>} />);
    const btn = screen.getByRole("button", { name: "Print" });
    expect(btn.parentElement?.className).toContain("print:hidden");
  });

  test("omits the actions cluster when no actions given", () => {
    const { container } = render(<PaneHeader title="X" />);
    expect(container.querySelector(".print\\:hidden")).toBeNull();
  });

  test("defaults to mb-2 and honours a className override", () => {
    const { container, rerender } = render(<PaneHeader title="X" />);
    expect(container.firstChild).toHaveClass("mb-2");
    rerender(<PaneHeader title="X" className="mb-3" />);
    expect(container.firstChild).toHaveClass("mb-3");
    expect(container.firstChild).not.toHaveClass("mb-2");
  });
});
