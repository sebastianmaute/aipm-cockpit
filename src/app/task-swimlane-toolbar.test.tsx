import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskSwimlaneToolbar } from "./task-swimlane-toolbar";
import type { Resource } from "./types";

const res = (id: number, firstName: string, lastName: string): Resource =>
  ({ id, firstName, lastName, roleId: null, utilizationMode: "percent", utilization: {} });

const resources: Resource[] = [res(1, "Anna", "Jordan"), res(2, "Sam", "Rivera")];

describe("TaskSwimlaneToolbar", () => {
  it("offers only resources that are not already lanes, and adds one", async () => {
    const onAddLane = vi.fn();
    render(
      <TaskSwimlaneToolbar lang="en-US" resources={resources} laneResourceIds={[1]} onAddLane={onAddLane} />,
    );
    const select = screen.getByRole("combobox", { name: "Add person lane" });
    expect(screen.queryByRole("option", { name: "Anna Jordan" })).toBeNull();
    await userEvent.selectOptions(select, "2");
    expect(onAddLane).toHaveBeenCalledWith(2);
  });
});
