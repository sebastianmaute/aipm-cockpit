import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChangesBadge } from "./task-changes-badge";
import { expectRowUniqueNames } from "../test/row-unique-names";

describe("ChangesBadge", () => {
  // ★★★ WCAG 2.5.3 (label in name): the accessible name must CONTAIN the
  // visible count text. Guarded against a vacuous pass by pinning the visible
  // string first — an empty string is contained in every name.
  it("contains its visible count text inside its accessible name (WCAG 2.5.3)", () => {
    render(<ChangesBadge taskId={7} count={3} lang="en-US" rowToken="Alpha" onJumpToChanges={vi.fn()} />);
    const btn = screen.getByRole("button");
    const visible = btn.textContent!.trim();
    expect(visible).toBe("3 changes");
    expect(btn.getAttribute("aria-label")!.toLowerCase()).toContain(visible.toLowerCase());
  });

  it("names itself by the count and the row token, and describes the jump in its title", () => {
    render(<ChangesBadge taskId={7} count={1} lang="en-US" rowToken="Alpha" onJumpToChanges={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-label", "1 change – Alpha");
    expect(btn).toHaveAttribute("title", "Show the linked changes");
  });

  // ★★ WCAG 2.4.6: the collision axis is the COUNT — two rows with equal counts
  // render byte-identical visible text, so only the row token separates them.
  // The scan runs BEFORE any exact-name pin so a mutant dropping the token is
  // caught by the scan itself, not only by a pin that aborts first.
  it("keeps two equal-count badges distinct via the row token (WCAG 2.4.6)", () => {
    const { container } = render(
      <>
        <ChangesBadge taskId={1} count={2} lang="en-US" rowToken="Alpha" onJumpToChanges={vi.fn()} />
        <ChangesBadge taskId={2} count={2} lang="en-US" rowToken="Beta" onJumpToChanges={vi.fn()} />
      </>,
    );
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["2 changes", "2 changes"]);
    expectRowUniqueNames({ minControls: 2, scope: container, roles: ["button"] });
  });

  it("jumps with its task id and does not let the click reach the row", () => {
    const onJump = vi.fn();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <ChangesBadge taskId={42} count={2} lang="en-US" rowToken="Alpha" onJumpToChanges={onJump} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onJump).toHaveBeenCalledWith(42);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
