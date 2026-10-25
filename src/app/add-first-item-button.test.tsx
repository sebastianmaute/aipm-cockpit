import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddFirstItemButton } from "./add-first-item-button";
import { expectLabelInName, visibleText } from "../test/label-in-name";

describe("AddFirstItemButton", () => {
  it("renders description + CTA and fires onAdd on click", () => {
    const onAdd = vi.fn();
    render(<AddFirstItemButton onAdd={onAdd} text="No milestones yet" addLabel="+ New milestone…" />);
    expect(screen.getByText("No milestones yet")).toBeInTheDocument();
    // Two-line variant: the BOX is the centred flex column; the button is the CTA line inside it.
    const btn = screen.getByRole("button", { name: /new milestone/i });
    expect(btn.closest("[data-add-first-box]")!.className).toContain("flex-col");
    fireEvent.click(btn);
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
    const { container } = render(<AddFirstItemButton onAdd={() => {}} text="Empty" addLabel="+ Add" rounded="xl" padding={6} />);
    const box = container.querySelector("[data-add-first-box]")!;
    expect(box.className).toContain("rounded-xl");
    expect(box.className).toContain("p-6");
    // The click overlay follows the box's corners.
    expect(screen.getByRole("button").className).toContain("after:rounded-xl");
  });

  it("defaults to rounded-lg / p-10", () => {
    const { container } = render(<AddFirstItemButton onAdd={() => {}} text="Empty" addLabel="+ Add" />);
    const box = container.querySelector("[data-add-first-box]")!;
    expect(box.className).toContain("rounded-lg");
    expect(box.className).toContain("p-10");
  });

  it("uses ariaLabel as the accessible name when provided", () => {
    render(<AddFirstItemButton onAdd={() => {}} addLabel="+ Add" ariaLabel="Add first RAID item" />);
    expect(screen.getByRole("button", { name: "Add first RAID item" })).toBeInTheDocument();
  });

  // One tab stop, as before the 2.5.3 reshape: the description is plain text and
  // the box is not focusable, so Tab lands on the CTA button and nothing else.
  it("keeps exactly one tab stop, with the focus ring drawn by the box", async () => {
    render(
      <>
        <AddFirstItemButton onAdd={() => {}} text="No documents yet" addLabel="+ Create your first document…" ariaLabel="Create your first document" />
        <button type="button">after</button>
      </>,
    );
    const user = userEvent.setup();
    await user.tab();
    const cta = screen.getByRole("button", { name: "Create your first document" });
    expect(cta).toHaveFocus();
    expect(cta.closest("[data-add-first-box]")!.className).toContain("has-[button:focus]:ring-2");
    await user.tab();
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
  });

  // ★★ WCAG 2.5.3 — the button used to wrap the description AND the CTA, so its
  // visible text was "No documents yet + Create your first document…" while its
  // name was "Create your first document": a mismatch axe 4.14's
  // label-content-name-mismatch flags in any scanned empty state. The button now
  // wraps the CTA alone. (A real caller, both languages: documents-list.test.tsx.)
  // Mutation: move `<span>{text}</span>` back inside the button → red.
  it("keeps the description out of the button so its name contains its visible text", () => {
    render(<AddFirstItemButton onAdd={() => {}} text="No documents yet" addLabel="+ Create your first document…" ariaLabel="Create your first document" />);
    const cta = screen.getByRole("button", { name: "Create your first document" });
    expect(visibleText(cta)).toBe("+ Create your first document…");
    expectLabelInName(cta);
  });
});
