import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ChangeReportPanel } from "./change-report-panel";
import type { ChangeItem } from "./types";

function ci(over: Partial<ChangeItem>): ChangeItem {
  return { id: 1, title: "t", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], ...over };
}
const items = [ci({ id: 1, status: "Proposed", type: "Scope" }), ci({ id: 2, status: "Approved", type: "Cost" }), ci({ id: 3, status: "Implemented", type: "Scope" })];

describe("ChangeReportPanel", () => {
  it("renders summary tiles incl. a Total and a Pending count", () => {
    const { getByText, getAllByText } = render(<ChangeReportPanel lang="en-US" items={items} today="2026-06-10" />);
    expect(getByText(/total/i)).toBeTruthy();
    expect(getAllByText(/pending/i).length).toBeGreaterThan(0);
  });
  it("renders a By Type breakdown", () => {
    const { getByText } = render(<ChangeReportPanel lang="en-US" items={items} today="2026-06-10" />);
    expect(getByText(/by type/i)).toBeTruthy();
  });
});
