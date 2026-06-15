import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommTemplateDiffView } from "./comm-template-diff-view";
import type { DiffLine } from "./text-diff";

const lines: DiffLine[] = [
  { type: "same", text: "Hello" },
  { type: "removed", text: "old line" },
  { type: "added", text: "new line" },
];

describe("CommTemplateDiffView", () => {
  it("renders added/removed/same rows with accessible markers", () => {
    render(
      <CommTemplateDiffView lines={lines} addedLabel="added" removedLabel="removed" summary="1 added, 1 removed" />,
    );
    expect(screen.getByLabelText("1 added, 1 removed")).toBeTruthy();
    expect(screen.getByLabelText("added: new line")).toBeTruthy();
    expect(screen.getByLabelText("removed: old line")).toBeTruthy();
    expect(screen.getByText("Hello")).toBeTruthy();
  });
  it("renders an empty (no-change) diff without crashing", () => {
    render(<CommTemplateDiffView lines={[]} addedLabel="added" removedLabel="removed" summary="no changes" />);
    expect(screen.getByLabelText("no changes")).toBeTruthy();
  });
});
