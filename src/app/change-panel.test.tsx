import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { ChangePanel } from "./change-panel";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";
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
  // jsdom has no layout engine and does not define scrollIntoView, so vi.spyOn
  // can't wrap it. The deep-link flash hook calls it on the matching row — assign a
  // stub before each test and restore the original (undefined) after, so it never
  // crashes the render and never leaks into later tests.
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

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

describe("ChangePanel — Outlook calendar toggle (SP3)", () => {
  const calLabel = `${t("en-US", "calendarSyncEnable")} – ${t("en-US", "calendarSyncEntityChange")}`;

  it("renders the toggle when m365Configured and a handler is given", () => {
    const { getByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={vi.fn()} />,
      { wrapper: Providers },
    );
    expect(getByRole("checkbox", { name: calLabel })).toBeTruthy();
  });

  it("labels the toggle for change decisions", () => {
    const { getByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={vi.fn()} />,
      { wrapper: Providers },
    );
    expect(getByRole("checkbox", { name: /change decisions/i })).toBeTruthy();
  });

  it("does NOT render the toggle without m365Configured", () => {
    const { queryByRole } = render(
      <ChangePanel {...base} m365Configured={false} onToggleCalendar={vi.fn()} />,
      { wrapper: Providers },
    );
    expect(queryByRole("checkbox", { name: calLabel })).toBeNull();
  });

  it("does NOT render the toggle in a popout", () => {
    const { queryByRole } = render(
      <ChangePanel {...base} m365Configured isPopout onToggleCalendar={vi.fn()} />,
      { wrapper: Providers },
    );
    expect(queryByRole("checkbox", { name: calLabel })).toBeNull();
  });

  it("calls onToggleCalendar(true) when the checkbox is ticked", () => {
    const onToggleCalendar = vi.fn();
    const { getByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={onToggleCalendar} />,
      { wrapper: Providers },
    );
    fireEvent.click(getByRole("checkbox", { name: calLabel }));
    expect(onToggleCalendar).toHaveBeenCalledWith(true);
  });

  it("shows the Push button only when calendarEnabled and calls onPushCalendar", () => {
    const onPushCalendar = vi.fn();
    const { queryByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={vi.fn()} calendarEnabled={false} onPushCalendar={onPushCalendar} />,
      { wrapper: Providers },
    );
    expect(queryByRole("button", { name: t("en-US", "calendarPush") })).toBeNull();

    const { getByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={vi.fn()} calendarEnabled onPushCalendar={onPushCalendar} />,
      { wrapper: Providers },
    );
    fireEvent.click(getByRole("button", { name: t("en-US", "calendarPush") }));
    expect(onPushCalendar).toHaveBeenCalledTimes(1);
  });

  it("shows the Pull button only when calendarEnabled and onPullCalendar, and calls it", () => {
    const onPullCalendar = vi.fn();
    // Absent without onPullCalendar even when calendarEnabled.
    const { queryByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={vi.fn()} calendarEnabled />,
      { wrapper: Providers },
    );
    expect(queryByRole("button", { name: t("en-US", "calendarPull") })).toBeNull();

    const { getByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={vi.fn()} calendarEnabled onPullCalendar={onPullCalendar} />,
      { wrapper: Providers },
    );
    fireEvent.click(getByRole("button", { name: t("en-US", "calendarPull") }));
    expect(onPullCalendar).toHaveBeenCalledTimes(1);
  });
});

describe("ChangePanel — inline Ask-Claude (SP2)", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  const aiLabel = (title: string) => `${t("en-US", "inlineAiEdit")} – ${title}`;

  it("renders a row-unique ✨ Ask-Claude button when onAiEdit + aiEditEnabled(true)", () => {
    const onAiEdit = vi.fn();
    const { getByRole } = render(
      <ChangePanel {...base} onAiEdit={onAiEdit} aiEditEnabled={() => true} />,
      { wrapper: Providers },
    );
    const btn = getByRole("button", { name: aiLabel("Alpha scope") });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onAiEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 1, title: "Alpha scope" }));
  });

  it("does NOT render the button when aiEditEnabled returns false", () => {
    const { queryByRole } = render(
      <ChangePanel {...base} onAiEdit={vi.fn()} aiEditEnabled={() => false} />,
      { wrapper: Providers },
    );
    expect(queryByRole("button", { name: aiLabel("Alpha scope") })).toBeNull();
  });

  it("does NOT render the button without an onAiEdit handler", () => {
    const { queryByRole } = render(
      <ChangePanel {...base} aiEditEnabled={() => true} />,
      { wrapper: Providers },
    );
    expect(queryByRole("button", { name: aiLabel("Alpha scope") })).toBeNull();
  });
});

describe("Changes bulk edit", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("applies a bulk status change to the selected row via onSave", () => {
    const onSave = vi.fn();
    const changes = [ci({ id: 1, title: "Alpha scope", status: "Proposed" })];
    const { getByRole, getAllByRole } = render(
      <ChangePanel {...base} changes={changes} onSave={onSave} />,
      { wrapper: Providers },
    );

    // select the row
    fireEvent.click(getByRole("checkbox", { name: t("en-US", "selectItem", "Alpha scope") }));
    // open the bulk panel
    fireEvent.click(getByRole("button", { name: t("en-US", "bulkEdit") }));
    // enable Status + set it to Approved (the bulk select shares its name with the
    // toolbar filter — disambiguate by the bulk control's id)
    fireEvent.click(getByRole("checkbox", { name: t("en-US", "changeFieldStatus") }));
    const bulkStatus = getAllByRole("combobox", { name: t("en-US", "changeFieldStatus") })
      .find((el) => el.id === "bulk-status")!;
    fireEvent.change(bulkStatus, { target: { value: "Approved" } });
    fireEvent.click(getByRole("button", { name: t("en-US", "bulkApplyCount", "1") }));

    expect(onSave).toHaveBeenCalledTimes(1);
    // Bulk apply passes suppressFieldUndo so the looped save skips per-field
    // undo capture (the whole-row bulk.edit entry already covers it).
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, status: "Approved" }),
      undefined,
      { suppressFieldUndo: true },
    );
  });
});
