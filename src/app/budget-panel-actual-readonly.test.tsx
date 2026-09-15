import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HoursTd } from "./budget-panel-totals";

function renderCell(actualReadOnlyReason?: string) {
  const onActual = vi.fn();
  render(
    <table><tbody><tr>
      <HoursTd
        ariaPrefix="1-3-2026-06" budget={10} actual={6} onBudget={vi.fn()} onActual={onActual}
        lang="en-US" periodEnd="2026-06-30" today="2026-07-15" actualReadOnlyReason={actualReadOnlyReason}
      />
    </tr></tbody></table>,
  );
  return { onActual, input: screen.getByLabelText("actual-1-3-2026-06") as HTMLInputElement };
}

describe("HoursTd actual input read-only state", () => {
  it("is read-only, titled and described when a reason is given", async () => {
    const { onActual, input } = renderCell("From TimeLog. Re-apply to change.");
    expect(input.readOnly).toBe(true);
    expect(input).toHaveAttribute("title", "From TimeLog. Re-apply to change.");
    expect(input).toHaveAccessibleDescription("From TimeLog. Re-apply to change.");
    expect(input.value).toBe("6");
    await userEvent.type(input, "9");
    await userEvent.tab();
    expect(onActual).not.toHaveBeenCalled();
  });

  it("stays editable with no title or description when no reason is given", async () => {
    const { onActual, input } = renderCell();
    expect(input.readOnly).toBe(false);
    expect(input).not.toHaveAttribute("title");
    expect(input).not.toHaveAttribute("aria-describedby");
    await userEvent.clear(input);
    await userEvent.type(input, "9");
    await userEvent.tab();
    expect(onActual).toHaveBeenCalledWith(9);
  });
});
