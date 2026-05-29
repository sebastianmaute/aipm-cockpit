import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OutlookCalendarImportModal } from "./outlook-calendar-import-modal";
import { dedupeKey, type OutlookEvent } from "./outlook-calendar";

const events: OutlookEvent[] = [
  { sourceId: "1", subject: "Vacation", startDate: "2026-06-01", endDate: "2026-06-03", isAllDay: true, showAs: "oof" },
  { sourceId: "2", subject: "", startDate: "2026-07-10", endDate: "2026-07-10", isAllDay: true, showAs: "oof" },
];

function base(overrides = {}) {
  return {
    lang: "en-US" as const,
    open: true,
    loading: false,
    error: null as string | null,
    events,
    targetAssignee: "",
    existingKeys: new Set<string>(),
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("OutlookCalendarImportModal", () => {
  it("pre-checks events and shows a per-row type select defaulting to vacation", () => {
    render(<OutlookCalendarImportModal {...base()} />);
    const rowChecks = screen.getAllByRole("checkbox");
    expect(rowChecks.length).toBe(3); // 2 rows + select-all
    rowChecks.forEach((c) => expect(c).toBeChecked());
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    expect((selects[0] as HTMLSelectElement).value).toBe("vacation");
    expect(screen.getByText(/\(no subject\)/i)).toBeInTheDocument();
  });

  it("confirm passes checked rows with their chosen types", () => {
    const onConfirm = vi.fn();
    render(<OutlookCalendarImportModal {...base({ onConfirm })} />);
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "training" } });
    fireEvent.click(screen.getByRole("button", { name: /Import \(2\)/i }));
    const rows = onConfirm.mock.calls[0][0] as { event: OutlookEvent; type: string }[];
    expect(rows).toHaveLength(2);
    const vac = rows.find((r) => r.event.sourceId === "1")!;
    expect(vac.type).toBe("training");
  });

  it("badges + unchecks events already in the calendar", () => {
    const existingKeys = new Set([dedupeKey("Alex", "2026-06-01", "2026-06-03")]);
    render(<OutlookCalendarImportModal {...base({ existingKeys, targetAssignee: "Alex" })} />);
    expect(screen.getByText(/already in calendar/i)).toBeInTheDocument();
  });

  it("renders loading, empty, error states", () => {
    const { rerender } = render(<OutlookCalendarImportModal {...base({ loading: true })} />);
    expect(screen.getByText(/Loading events/i)).toBeInTheDocument();
    rerender(<OutlookCalendarImportModal {...base({ events: [] })} />);
    expect(screen.getByText(/No time-away events found/i)).toBeInTheDocument();
    rerender(<OutlookCalendarImportModal {...base({ error: "Permission denied" })} />);
    expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
  });
});
