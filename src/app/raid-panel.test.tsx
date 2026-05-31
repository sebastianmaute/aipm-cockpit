import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, test } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { t } from "./i18n";
import { RaidPanel } from "./raid-panel";
import type { RaidPanelProps } from "./raid-panel";
import type { RaidItem } from "./types";

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

// --- helpers ---------------------------------------------------------------

function makeRaidItem(overrides: Partial<RaidItem> & Pick<RaidItem, "id" | "title" | "severity">): RaidItem {
  return {
    category: "R",
    status: "Open",
    raisedDate: "2026-05-22",
    linkedTaskIds: [],
    causedByRaidIds: [],
    ...overrides,
  };
}

/** Returns the text of every #id cell in document order. */
function rowIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("td.font-mono.text-muted-foreground"))
    .map((td) => td.textContent?.trim() ?? "")
    .filter((text) => text.startsWith("#"));
}

// --- sort tests -----------------------------------------------------------

describe("RaidPanel sortable column headers", () => {
  const raidItems: RaidItem[] = [
    makeRaidItem({ id: 1, title: "Alpha", severity: "Low" }),
    makeRaidItem({ id: 2, title: "Beta",  severity: "High" }),
    makeRaidItem({ id: 3, title: "Gamma", severity: "Critical" }),
  ];

  it("clicking Severity header once → ascending order (Low first, Critical last)", () => {
    const { container } = render(<RaidPanel {...makeProps({ raid: raidItems })} />);
    fireEvent.click(screen.getByRole("button", { name: /severity/i }));
    const ids = rowIds(container);
    expect(ids).toEqual(["#1", "#2", "#3"]); // Low(1) → High(2) → Critical(3)
  });

  it("clicking Severity header twice → descending order (Critical first, Low last)", () => {
    const { container } = render(<RaidPanel {...makeProps({ raid: raidItems })} />);
    const btn = screen.getByRole("button", { name: /severity/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    const ids = rowIds(container);
    expect(ids).toEqual(["#3", "#2", "#1"]); // Critical(3) → High(2) → Low(1)
  });

  it("clicking Severity header three times → back to default order (severity-rank, open-first)", () => {
    const { container } = render(<RaidPanel {...makeProps({ raid: raidItems })} />);
    const btn = screen.getByRole("button", { name: /severity/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    // Default sort: open items first by severityRank (Critical=0, High=1, Medium=2, Low=3)
    const ids = rowIds(container);
    expect(ids).toEqual(["#3", "#2", "#1"]);
  });

  it("non-sortable headers (Linked Tasks, Caused By) have no sort button", () => {
    render(<RaidPanel {...makeProps({ raid: raidItems })} />);
    expect(
      screen.queryByRole("button", { name: /linked tasks/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /caused by/i }),
    ).toBeNull();
  });
});

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

test("raid toolbar: add-item precedes search; no open-report button", () => {
  const src = readFileSync(join(__dirname, "raid-panel.tsx"), "utf8");
  const addIdx = src.indexOf("openNew()");
  const searchIdx = src.indexOf('type="search"');
  expect(addIdx).toBeGreaterThan(-1);
  expect(addIdx).toBeLessThan(searchIdx);
  expect(src).not.toMatch(/raidReportOpenReport\b/);
});
test("raid pane uses VIEW_PANE_RESIZABLE_CLASS", () => {
  expect(readFileSync(join(__dirname, "raid-panel.tsx"), "utf8")).toMatch(/VIEW_PANE_RESIZABLE_CLASS/);
});
