import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResourcesPanel } from "./resources-panel";
import type { Resource } from "./types";

const resources: Resource[] = [
  { id: 1, name: "Alex Example", roleId: null, utilizationMode: "percent", utilization: {} },
];

test("renders the resource name in the list view", () => {
  render(
    <ResourcesPanel
      lang="en-US" tasks={[]} absences={[]} shifts={[]} resources={resources}
      today="2026-05-23" holidaySet={new Set()}
      onAddAbsence={() => {}} onEditAbsence={() => {}} onEditShift={() => {}}
    />,
  );
  expect(screen.getByText("Alex Example")).toBeInTheDocument();
});
