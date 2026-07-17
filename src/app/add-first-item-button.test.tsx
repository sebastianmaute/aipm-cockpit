import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddFirstItemButton } from "./add-first-item-button";

describe("AddFirstItemButton", () => {
  it("renders description + CTA and fires onAdd on click", () => {
    const onAdd = vi.fn();
    render(<AddFirstItemButton onAdd={onAdd} text="No milestones yet" addLabel="+ New milestone…" />);
    expect(screen.getByText("No milestones yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /new milestone/i }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("renders a single CTA line when text is omitted (budget variant)", () => {
    render(<AddFirstItemButton onAdd={() => {}} addLabel="+ Add bucket…" />);
    const btn = screen.getByRole("button", { name: /add bucket/i });
    // No description span → the button has exactly the CTA text.
    expect(btn.textContent).toBe("+ Add bucket…");
    expect(btn.className).not.toContain("flex-col");
  });

  it("applies the requested radius and padding", () => {
    render(<AddFirstItemButton onAdd={() => {}} text="Empty" addLabel="+ Add" rounded="xl" padding={6} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("rounded-xl");
    expect(btn.className).toContain("p-6");
  });

  it("defaults to rounded-lg / p-10", () => {
    render(<AddFirstItemButton onAdd={() => {}} text="Empty" addLabel="+ Add" />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("rounded-lg");
    expect(btn.className).toContain("p-10");
  });

  it("uses ariaLabel as the accessible name when provided", () => {
    render(<AddFirstItemButton onAdd={() => {}} addLabel="+ Add" ariaLabel="Add first RAID item" />);
    expect(screen.getByRole("button", { name: "Add first RAID item" })).toBeInTheDocument();
  });
});
