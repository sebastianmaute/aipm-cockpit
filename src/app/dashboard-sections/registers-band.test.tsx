import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RaidRegisterCard, UpcomingCard } from "./registers-band";
import type { RaidItem, Task } from "../types";

const baseRaid = {
  id: 1,
  category: "R",
  title: "A key risk",
  status: "Open",
  linkedTaskIds: [],
  raisedDate: "2026-01-01",
  causedByRaidIds: [],
} as never as RaidItem;

const baseTask = {
  id: 10,
  taskName: "Fix the bug",
  dueDate: "2026-06-30",
  status: "To Do",
} as never as Task;

describe("RaidRegisterCard", () => {
  it("renders RAID heading and seeded row text", () => {
    render(
      <RaidRegisterCard
        lang="en-US"
        topRaid={[baseRaid]}
        onOpenRaid={() => {}}
      />,
    );
    expect(screen.getByText("Top open RAID")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /A key risk/ })).toBeInTheDocument();
  });

  it("row buttons have row-unique accessible names via category + title", () => {
    render(
      <RaidRegisterCard
        lang="en-US"
        topRaid={[
          { ...baseRaid, id: 2, category: "A", title: "first assumption" } as RaidItem,
          { ...baseRaid, id: 3, category: "I", title: "first issue" } as RaidItem,
        ]}
        onOpenRaid={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /first assumption/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /first issue/ })).toBeInTheDocument();
  });

  it("returns null when showRaid is false", () => {
    const { container } = render(
      <RaidRegisterCard lang="en-US" topRaid={[baseRaid]} showRaid={false} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("UpcomingCard", () => {
  it("renders Upcoming heading and an overdue task button", () => {
    render(
      <UpcomingCard
        lang="en-US"
        overdue={[baseTask]}
        dueSoon={[]}
        onOpenTask={() => {}}
      />,
    );
    expect(screen.getByText("Upcoming & overdue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fix the bug/ })).toBeInTheDocument();
  });

  it("renders a due-soon task button", () => {
    const dueSoonTask = { ...baseTask, id: 11, taskName: "Upcoming task", dueDate: "2026-07-01" } as Task;
    render(
      <UpcomingCard
        lang="en-US"
        overdue={[]}
        dueSoon={[dueSoonTask]}
        onOpenTask={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Upcoming task/ })).toBeInTheDocument();
  });
});
