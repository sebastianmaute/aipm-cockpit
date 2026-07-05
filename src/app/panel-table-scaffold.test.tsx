import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PanelTableScaffold } from "./panel-table-scaffold";
import type { BulkField } from "./bulk-edit-panel";

function bulkProps(over: Partial<Parameters<typeof PanelTableScaffold>[0]["bulk"]> = {}) {
  return {
    count: 0,
    open: false,
    onToggleOpen: vi.fn(),
    onClear: vi.fn(),
    fields: [] as readonly BulkField[],
    onApply: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
}

function baseProps() {
  return {
    paneRef: { current: null },
    containerRef: { current: null },
    view: "changes" as const,
    lang: "en-US" as const,
    toolbar: <div data-testid="tb">toolbar</div>,
    bulk: bulkProps(),
    count: 0,
    empty: { text: "No changes", addLabel: "+ Add change…", onAdd: vi.fn() },
  };
}

describe("PanelTableScaffold", () => {
  it("renders the dashed empty-state button when count is 0 and fires onAdd", () => {
    const onAdd = vi.fn();
    render(
      <PanelTableScaffold {...baseProps()} count={0} empty={{ text: "No changes", addLabel: "+ Add change…", onAdd }}>
        <table><tbody><tr><td>row</td></tr></tbody></table>
      </PanelTableScaffold>,
    );
    const btn = screen.getByRole("button", { name: /add change/i });
    expect(btn.className).toContain("border-dashed");
    fireEvent.click(btn);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("row")).toBeNull();
  });

  it("renders children (not the empty button) when count > 0", () => {
    render(
      <PanelTableScaffold {...baseProps()} count={3}>
        <table><tbody><tr><td>row</td></tr></tbody></table>
      </PanelTableScaffold>,
    );
    expect(screen.getByText("row")).toBeInTheDocument();
    expect(screen.queryByText(/add change/i)).toBeNull();
  });

  it("applies aria-label to the empty button only when provided", () => {
    const { rerender } = render(
      <PanelTableScaffold {...baseProps()} count={0} empty={{ text: "e", addLabel: "+ add…", onAdd: vi.fn(), ariaLabel: "Add RAID item" }}>
        <div />
      </PanelTableScaffold>,
    );
    expect(screen.getByRole("button", { name: "Add RAID item" })).toBeInTheDocument();
    rerender(
      <PanelTableScaffold {...baseProps()} count={0} empty={{ text: "e", addLabel: "+ add…", onAdd: vi.fn() }}>
        <div />
      </PanelTableScaffold>,
    );
    // no explicit aria-label → accessible name falls back to text content
    expect(screen.getByRole("button", { name: /add…/ })).toBeInTheDocument();
  });

  it("wraps the bulk block in print:hidden by default and unwrapped when bulkPrintHidden=false", () => {
    const { container, rerender } = render(
      <PanelTableScaffold {...baseProps()}><div /></PanelTableScaffold>,
    );
    expect(container.querySelector(".print\\:hidden")).not.toBeNull();
    rerender(
      <PanelTableScaffold {...baseProps()} bulkPrintHidden={false}><div /></PanelTableScaffold>,
    );
    expect(container.querySelector(".print\\:hidden")).toBeNull();
  });

  it("omits the ViewCallout when onLearnMore is undefined", () => {
    const { container } = render(
      <PanelTableScaffold {...baseProps()}><div /></PanelTableScaffold>,
    );
    expect(container.textContent).toContain("toolbar");
  });
});
