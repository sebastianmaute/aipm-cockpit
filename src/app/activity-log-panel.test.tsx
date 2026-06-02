import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityLogPanel } from "./activity-log-panel";
import type { ActivityEntry } from "./activity-log";

function entry(p: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: 1,
    timestamp: "2026-05-28T10:00:00.000Z",
    kind: "task.created",
    args: ["Task A"],
    ...p,
  } as ActivityEntry;
}

const entries: ActivityEntry[] = [
  entry({ id: 1, kind: "task.created", args: ["Task A"] }),
  entry({ id: 2, kind: "task.updated", args: ["Task B"] }),
];

describe("ActivityLogPanel", () => {
  it("marks the pane as a print-root for scoped printing", () => {
    const { container } = render(
      <ActivityLogPanel lang="en-US" entries={entries} onClear={() => {}} />,
    );
    expect((container.firstElementChild as HTMLElement).className).toContain("print-root");
    // Activity Log prints portrait — it must NOT opt into the reports' landscape page.
    expect((container.firstElementChild as HTMLElement).className).not.toContain("print-landscape");
  });

  it("renders a print button in the header", () => {
    render(<ActivityLogPanel lang="en-US" entries={entries} onClear={() => {}} />);
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });
});
