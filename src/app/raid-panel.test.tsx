import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { t } from "./i18n";
import { RaidPanel } from "./raid-panel";
import type { RaidPanelProps } from "./raid-panel";

function makeProps(overrides: Partial<RaidPanelProps> = {}): RaidPanelProps {
  return {
    lang: "en-US",
    tasks: [],
    raid: [],
    today: "2026-05-22",
    filterTaskId: null,
    onClearTaskFilter: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onCreateMitigationTask: vi.fn().mockReturnValue(null),
    onJumpToTask: vi.fn(),
    ...overrides,
  };
}

describe("RaidPanel tooltips", () => {
  it("gives the RAID search box a descriptive tooltip", () => {
    render(<RaidPanel {...makeProps()} />);
    expect(screen.getByPlaceholderText(/search title, owner/i)).toHaveAttribute(
      "title",
      "Filter the register to items whose title, owner, or description match your text.",
    );
  });
});

describe("RaidPanel inline add row", () => {
  it("inline add row is present when RAID list is empty", () => {
    render(<RaidPanel {...makeProps()} />);
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "raidAddItem") });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("inline add row is present when RAID list is non-empty", () => {
    const item = {
      id: 1, category: "R" as const, title: "Test risk",
      severity: "Medium" as const, status: "Open" as const,
      raisedDate: "2026-05-22", linkedTaskIds: [],
      causedByRaidIds: [],
    };
    render(<RaidPanel {...makeProps({ raid: [item] })} />);
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "raidAddItem") });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("clicking inline add row when category filter is 'All' opens modal with category R", () => {
    render(<RaidPanel {...makeProps()} />);
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "raidAddItem") });
    fireEvent.click(addBtns[addBtns.length - 1]);
    // The Category radiogroup is inside the modal. We scope with `within` to
    // avoid the label-wrapping name-computation quirk in JSDOM: the first radio
    // button's accessible name is prefixed with the wrapping <label> text, so
    // querying by name "Risk" fails. Instead we verify the checked radio's
    // text content equals the expected category label.
    const categoryGroup = screen.getByRole("radiogroup", {
      name: t("en-US", "raidCategory"),
    });
    const checkedRadio = within(categoryGroup).getByRole("radio", {
      checked: true,
    });
    expect(checkedRadio).toHaveTextContent(t("en-US", "raidCategoryR"));
  });

  it("clicking inline add row when category filter is 'A' opens modal with category A", () => {
    render(<RaidPanel {...makeProps()} />);
    const categorySelect = screen.getByDisplayValue(t("en-US", "raidCategoryAll"));
    fireEvent.change(categorySelect, { target: { value: "A" } });
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "raidAddItem") });
    fireEvent.click(addBtns[addBtns.length - 1]);
    const categoryGroup = screen.getByRole("radiogroup", {
      name: t("en-US", "raidCategory"),
    });
    const checkedRadio = within(categoryGroup).getByRole("radio", {
      checked: true,
    });
    expect(checkedRadio).toHaveTextContent(t("en-US", "raidCategoryA"));
  });
});
