import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CalendarOptOutCheckbox } from "./calendar-opt-out-checkbox";
import { loadI18n } from "./i18n";

describe("CalendarOptOutCheckbox (§486)", () => {
  it("is a labelled checkbox named with the item title, and reports the new sync state", async () => {
    const onChange = vi.fn();
    render(<CalendarOptOutCheckbox lang="en-US" checked itemTitle="Kickoff" onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Sync to Outlook – Kickoff" });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("reports true when an opted-out item is ticked again", async () => {
    const onChange = vi.fn();
    render(<CalendarOptOutCheckbox lang="en-US" checked={false} itemTitle="Kickoff" onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Sync to Outlook – Kickoff" });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("toggles from the visible caption too, and describes itself with the hint", async () => {
    const onChange = vi.fn();
    render(<CalendarOptOutCheckbox lang="en-US" checked itemTitle="Kickoff" onChange={onChange} />);
    await userEvent.click(screen.getByText("Sync to Outlook"));
    expect(onChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole("checkbox")).toHaveAccessibleDescription(
      "Unticked items are never created or updated in Outlook. An existing event is left as it is.",
    );
  });

  it("names an untitled item by the caption alone, without a trailing dash", () => {
    render(<CalendarOptOutCheckbox lang="en-US" checked itemTitle="  " onChange={vi.fn()} />);
    expect(screen.getByRole("checkbox")).toHaveAccessibleName("Sync to Outlook");
  });

  it("renders the German strings", async () => {
    await loadI18n("de");
    render(<CalendarOptOutCheckbox lang="de" checked itemTitle="Start" onChange={vi.fn()} />);
    expect(screen.getByRole("checkbox")).toHaveAccessibleName("Mit Outlook synchronisieren – Start");
  });
});
