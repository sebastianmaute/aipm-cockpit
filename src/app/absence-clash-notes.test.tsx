// src/app/absence-clash-notes.test.tsx — §773: the warning line every AI preview renders for a clash.
import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AbsenceClashNotes } from "./absence-clash-notes";
import type { ClashNote } from "./inline-ai-edit/plan";

const CLASH_NOTE: ClashNote = {
  entity: "task", id: 42, title: "Ship the release",
  clash: {
    person: "Maya Patel", resourceId: 1, reason: "date-on-absence", which: "due", date: "2026-11-05",
    ranges: [{ start: "2026-11-03", end: "2026-11-07" }],
  },
};

it("renders each note's title and sentence beside an aria-hidden warning icon", () => {
  render(<ul><AbsenceClashNotes lang="en-US" clashes={[CLASH_NOTE]} /></ul>);
  const item = screen.getByRole("listitem");
  expect(item).toHaveTextContent("Ship the release");
  expect(item).toHaveTextContent(/Maya Patel is absent on the due date/);
  const icon = item.querySelector("svg");
  expect(icon).not.toBeNull();
  expect(icon).toHaveAttribute("aria-hidden", "true");
});

it("renders nothing for no notes", () => {
  render(<ul><AbsenceClashNotes lang="en-US" clashes={[]} /></ul>);
  expect(screen.queryByRole("listitem")).toBeNull();
});
