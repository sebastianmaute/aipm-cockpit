import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { ChangePanel } from "./change-panel";
import { applyTier } from "./field-visibility";
import type { ChangeItem } from "./types";

function ci(over: Partial<ChangeItem>): ChangeItem {
  return { id: 1, title: "t", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], ...over };
}
const base = {
  lang: "en-US" as const, tasks: [], raid: [],
  changes: [ci({ id: 1, title: "Alpha scope", type: "Scope", status: "Proposed" }), ci({ id: 2, title: "Beta cost", type: "Cost", status: "Approved" })],
  today: "2026-06-10", onSave: vi.fn(), onDelete: vi.fn(),
};

// The embedded ChangeEditModal renders ModalFieldControls, which reads
// field visibility from the Workspace/Filters contexts.
function Providers({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

/** Seeds the workspace field-visibility config once on mount (e.g. Full view). */
function Seed({ tier }: { tier: "full" }) {
  const { setFieldVisibility } = useWorkspace();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    setFieldVisibility(() => ({ change: applyTier("change", tier) }));
  }, [setFieldVisibility, tier]);
  return null;
}

describe("ChangePanel", () => {
  it("renders a row per change", () => {
    const { getByText } = render(<ChangePanel {...base} />, { wrapper: Providers });
    expect(getByText("Alpha scope")).toBeTruthy();
    expect(getByText("Beta cost")).toBeTruthy();
  });
  it("has an add button", () => {
    const { getByRole } = render(<ChangePanel {...base} />, { wrapper: Providers });
    expect(getByRole("button", { name: /add/i })).toBeTruthy();
  });
  it("opens the editor when a row is clicked", () => {
    const { getByText, getByDisplayValue } = render(<ChangePanel {...base} />, { wrapper: Providers });
    fireEvent.click(getByText("Alpha scope"));
    expect(getByDisplayValue("Alpha scope")).toBeTruthy();
  });
  it("tags every change row with its id via data-deeplink-row (deep-link flash wiring)", () => {
    // jsdom has no layout engine; the flash hook calls scrollIntoView on the
    // matching row — stub it so a (hypothetical) flash never crashes the render.
    Element.prototype.scrollIntoView = vi.fn();
    const { container } = render(<ChangePanel {...base} />, { wrapper: Providers });
    const rows = container.querySelectorAll("[data-deeplink-row]");
    expect(rows.length).toBe(base.changes.length);
    const ids = Array.from(rows).map((r) => r.getAttribute("data-deeplink-row"));
    expect(ids).toContain(String(base.changes[0].id));
  });
});

describe("ChangePanel — raidEnabled", () => {
  // The Linked-RAID editor lives in the Full-only `links` group, so seed Full tier.
  it("hides the RAID link control when raidEnabled is false", () => {
    const { getByText, queryByText } = render(
      <>
        <Seed tier="full" />
        <ChangePanel {...base} raidEnabled={false} />
      </>,
      { wrapper: Providers },
    );
    fireEvent.click(getByText("Alpha scope"));
    expect(queryByText("Linked RAID items")).toBeNull();
  });

  it("shows the RAID link control when raidEnabled is true (default)", () => {
    const { getByText } = render(
      <>
        <Seed tier="full" />
        <ChangePanel {...base} />
      </>,
      { wrapper: Providers },
    );
    fireEvent.click(getByText("Alpha scope"));
    expect(getByText("Linked RAID items")).toBeTruthy();
  });
});
