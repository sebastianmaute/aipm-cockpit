import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarChip } from "./calendar-chip";

describe("CalendarChip", () => {
  it("uses ariaLabel as the accessible name, not the visible time/title text", () => {
    render(<CalendarChip ariaLabel="Standup – row 2" time="09:00" title="Standup" />);
    expect(screen.getByRole("button", { name: "Standup – row 2" })).toBeInTheDocument();
    // The visible text is NOT the computed name — a query for the raw
    // "09:00 Standup" string as a button name must fail.
    expect(screen.queryByRole("button", { name: "09:00 Standup" })).not.toBeInTheDocument();
  });

  it("wins over a stray raw aria-label reaching it through pass-through props", () => {
    // ButtonHTMLAttributes (which CalendarChipProps extends) admits a literal
    // "aria-label" key distinct from the ariaLabel business prop. The
    // accessible name must still come from ariaLabel — pass-through props are
    // for drag/data/click wiring, not a back door around the row-unique name
    // the caller is required to guarantee.
    render(
      <CalendarChip
        ariaLabel="Correct name"
        time="09:00"
        title="Standup"
        aria-label="Wrong name from a stray pass-through prop"
      />,
    );
    expect(screen.getByRole("button", { name: "Correct name" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wrong name from a stray pass-through prop" })).not.toBeInTheDocument();
  });

  it("keeps the moved marker glyph aria-hidden so it can't bleed into the accessible name", () => {
    const { container } = render(
      <CalendarChip ariaLabel="Standup – row 2" time="09:00" title="Standup" moved />,
    );
    const marker = container.querySelector("[data-moved-marker]");
    expect(marker).toBeTruthy();
    expect(marker).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Standup – row 2" })).toBeInTheDocument();
  });

  it("renders a non-colour marker for a moved occurrence, and omits it when not moved", () => {
    const { container: movedContainer } = render(
      <CalendarChip ariaLabel="Standup – row 2" time="09:00" title="Standup" moved />,
    );
    expect(movedContainer.querySelector("[data-moved-marker]")).toBeTruthy();
    // The distinguishing cue is a border-STYLE change (dashed), not merely a
    // colour swap — asserting the marker's presence alone wouldn't catch a
    // colour-only regression, so this also checks the non-colour treatment.
    const movedButton = screen.getByRole("button", { name: "Standup – row 2" });
    expect(movedButton.className).toContain("border-l-dashed");

    const { container: plainContainer } = render(
      <CalendarChip ariaLabel="Retro – row 3" time="14:00" title="Retro" />,
    );
    expect(plainContainer.querySelector("[data-moved-marker]")).toBeNull();
    const plainButton = screen.getByRole("button", { name: "Retro – row 3" });
    expect(plainButton.className).not.toContain("border-l-dashed");
  });

  it("truncates a long title rather than wrapping it", () => {
    const longTitle = "Quarterly all-hands planning and retrospective synchronisation meeting";
    const { container } = render(
      <CalendarChip ariaLabel="Long meeting – row 1" time="10:00" title={longTitle} />,
    );
    const titleEl = Array.from(container.querySelectorAll("span")).find((el) => el.textContent === longTitle);
    expect(titleEl).toBeTruthy();
    // jsdom has no layout engine, so we assert the truncation MECHANISM
    // (the class that clips + ellipsizes single-line overflow), not pixels.
    expect(titleEl!.className).toContain("truncate");
  });

  it("passes through draggable, data-* and onClick to the underlying button", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <CalendarChip
        ariaLabel="Standup – row 2"
        time="09:00"
        title="Standup"
        draggable
        data-occurrence-id="42"
        onClick={onClick}
      />,
    );
    const button = screen.getByRole("button", { name: "Standup – row 2" });
    expect(button).toHaveAttribute("draggable", "true");
    expect(button).toHaveAttribute("data-occurrence-id", "42");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies a caller className additively, keeping the chip's own base classes", () => {
    render(
      <CalendarChip
        ariaLabel="Standup – row 2"
        time="09:00"
        title="Standup"
        className="ring-2 ring-ui-green"
      />,
    );
    const button = screen.getByRole("button", { name: "Standup – row 2" });
    expect(button.className).toContain("ring-2 ring-ui-green");
    // The chip's own base layout class must survive alongside the caller's.
    expect(button.className).toContain("border-l-2");
  });
});
