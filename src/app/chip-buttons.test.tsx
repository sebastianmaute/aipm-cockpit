// §102 (batch 23, owner decision 2026-10-09): the small bordered chips are the
// shared Button at `xs`. These two components had no test file of their own.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BulkEditBar } from "./bulk-edit-bar";
import { DocumentEntityFilterBanner } from "./document-entity-filter-banner";
import { buttonClassFor } from "../test/button-variant";
import { EmptyState } from "./empty-state";

describe("chip buttons on the shared Button", () => {
  it("draws the bulk-edit bar's Clear selection as secondary xs", () => {
    render(<BulkEditBar lang="en-US" count={2} open={false} onToggleOpen={() => {}} onClear={() => {}} />);
    expect(screen.getByRole("button", { name: "Clear selection" }).className).toBe(
      buttonClassFor({ variant: "secondary", size: "xs" }),
    );
  });

  it("draws the Documents filter banner's Clear as secondary xs, keeping ml-auto", () => {
    render(<DocumentEntityFilterBanner lang="en-US" title="Task 7" isEmpty={false} onClear={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toBe(buttonClassFor({ variant: "secondary", size: "xs", className: "ml-auto" }));
  });
});

describe("EmptyState actions on the shared Button", () => {
  it("draws an action as secondary xs", () => {
    render(<EmptyState title="Nothing yet" actions={[{ label: "Add one", onClick: () => {} }]} />);
    expect(screen.getByRole("button", { name: "Add one" }).className).toBe(
      buttonClassFor({ variant: "secondary", size: "xs" }),
    );
  });
});
