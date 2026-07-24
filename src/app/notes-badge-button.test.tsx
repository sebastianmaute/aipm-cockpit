import { describe, test, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { NotesBadgeButton } from "./notes-badge-button";

describe("NotesBadgeButton", () => {
  test("renders the entry count", () => {
    const { getByRole } = render(
      <NotesBadgeButton count={3} entityName="Ship v2" lang="en-US" onClick={() => {}} />,
    );
    expect(getByRole("button").textContent).toContain("3");
  });

  test("has a row-unique accessible name incorporating the entity name", () => {
    const { getByRole } = render(
      <NotesBadgeButton count={0} entityName="Ship v2" lang="en-US" onClick={() => {}} />,
    );
    // "Notes log" is the EN value of noteLogTitle.
    expect(getByRole("button", { name: "Notes log – Ship v2" })).toBeTruthy();
  });

  test("click calls onClick", () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <NotesBadgeButton count={1} entityName="Risk A" lang="en-US" onClick={onClick} />,
    );
    fireEvent.click(getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
