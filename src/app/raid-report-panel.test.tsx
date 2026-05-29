import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RaidReportPanel } from "./raid-report-panel";
import type { RaidItem } from "./types";

const TODAY = "2026-05-28";

function item(p: Partial<RaidItem>): RaidItem {
  return {
    id: 1,
    category: "R",
    title: "t",
    status: "Open",
    raisedDate: TODAY,
    linkedTaskIds: [],
    causedByRaidIds: [],
    ...p,
  } as RaidItem;
}

const items: RaidItem[] = [
  item({ id: 1, category: "R", title: "Server capacity risk", status: "Open", severity: "Critical", owner: "Alice", raisedDate: "2026-01-01" }),
  item({ id: 2, category: "A", title: "Budget assumption", status: "Pending", severity: "Medium", owner: "Bob", raisedDate: "2026-03-01" }),
  item({ id: 3, category: "I", title: "Login bug", status: "Open", severity: "High", owner: "Alice", raisedDate: "2026-04-01" }),
  // No severity → exercises the "Unrated" severity row.
  item({ id: 4, category: "D", title: "Vendor delivery", status: "In Progress", owner: "Carol", raisedDate: "2026-02-01" }),
];

describe("RaidReportPanel", () => {
  it("shows the empty state and renders no tables when there are no items", () => {
    render(<RaidReportPanel lang="en-US" items={[]} today={TODAY} />);
    expect(
      screen.getByText("No RAID items yet. Add some in the RAID panel."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("table")).toHaveLength(0);
  });

  it("summary view renders the six section tables, tiles, and a print button", () => {
    render(<RaidReportPanel lang="en-US" items={items} today={TODAY} />);

    expect(screen.getByRole("heading", { name: "RAID Report" })).toBeInTheDocument();
    for (const section of [
      "By Severity",
      "By Status",
      "By Owner",
      "Top 10 Open",
      "By Category",
      "By Aging",
    ]) {
      expect(screen.getByRole("heading", { name: section })).toBeInTheDocument();
    }

    // One <table> per summary section.
    expect(screen.getAllByRole("table")).toHaveLength(6);

    expect(screen.getByText("Open Risks")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();

    // Owner + title rows are rendered from the report data.
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getByText("Server capacity risk")).toBeInTheDocument();
  });

  it("switching to Full Detail shows a single table listing every item", () => {
    render(<RaidReportPanel lang="en-US" items={items} today={TODAY} />);

    fireEvent.click(screen.getByRole("radio", { name: "Full Detail" }));

    // The six summary tables collapse into the single detail table.
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByText("Server capacity risk")).toBeInTheDocument();
    expect(screen.getByText("Vendor delivery")).toBeInTheDocument();
  });

  it("Full Detail headers are sortable buttons", () => {
    render(<RaidReportPanel lang="en-US" items={items} today={TODAY} />);
    fireEvent.click(screen.getByRole("radio", { name: "Full Detail" }));

    // Clicking a column header toggles its sort without throwing.
    const titleHeader = screen.getByRole("button", { name: /title/i });
    fireEvent.click(titleHeader);
    expect(screen.getByText("Server capacity risk")).toBeInTheDocument();
  });
});
