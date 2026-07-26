import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { CalendarEventModal } from "./calendar-event-modal";
import { t } from "./i18n";
import type { CalendarEvent } from "./calendar-event";

// ModalFieldControls (rendered in the modal header) reads field visibility
// from the workspace, so every render needs a WorkspaceProvider/FiltersProvider
// (mirrors absence-edit-modal.test.tsx). The default tier is "advanced", and
// every field this modal registers is simple/advanced, so no seeding is needed.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const base: CalendarEvent = {
  id: 1,
  title: "  Standup  ",
  startDate: "2026-01-01",
  startTime: "09:00",
  durationMinutes: 15,
};

type ModalProps = React.ComponentProps<typeof CalendarEventModal>;

function setup(over: Partial<ModalProps> = {}) {
  const props: ModalProps = {
    lang: "en-US" as const,
    event: base,
    isNew: false,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const result = render(<CalendarEventModal {...props} />, { wrapper });
  return { props, ...result };
}

function submit() {
  fireEvent.submit(screen.getByRole("button", { name: /save/i }).closest("form")!);
}

describe("CalendarEventModal", () => {
  it("renders nothing when event is null", () => {
    const { container } = setup({ event: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("saves a sanitized event, not the raw draft (title is trimmed)", () => {
    const onSave = vi.fn();
    setup({ onSave });
    submit();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ title: "Standup" });
  });

  it("echoes isNew=true back to onSave for a new event, so the save handler can route create-vs-update by explicit intent", () => {
    const onSave = vi.fn();
    setup({ isNew: true, onSave });
    submit();
    expect(onSave.mock.calls[0][1]).toBe(true);
  });

  it("echoes isNew=false back to onSave for an existing event", () => {
    const onSave = vi.fn();
    setup({ isNew: false, onSave });
    submit();
    expect(onSave.mock.calls[0][1]).toBe(false);
  });

  it("blocks save and shows an error when title is blank", () => {
    const onSave = vi.fn();
    setup({ event: { ...base, title: "" }, isNew: true, onSave });
    submit();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("clamps the ends-on date when the first occurrence moves past it", () => {
    setup({
      event: {
        ...base,
        startDate: "2026-01-01",
        recurrence: { freq: "weekly", interval: 1, until: "2026-01-10" },
      },
    });
    const startInput = screen.getByLabelText(
      new RegExp(t("en-US", "calendarEventFirstOccurrence")),
    ) as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: "2026-01-15" } });
    const endInput = screen.getByLabelText(
      new RegExp(t("en-US", "calendarEventEndsUntilLabel")),
    ) as HTMLInputElement;
    expect(endInput.value).toBe("2026-01-15");
  });

  it("hides recurrence detail fields when repeat is never, shows them for a repeating event", () => {
    const { rerender } = setup({ event: { ...base, recurrence: undefined } });
    expect(screen.queryByText(t("en-US", "calendarEventInterval"))).toBeNull();
    expect(screen.queryByText(t("en-US", "calendarEventEnds"))).toBeNull();

    rerender(
      <CalendarEventModal
        lang="en-US"
        event={{ ...base, recurrence: { freq: "weekly", interval: 1 } }}
        isNew={false}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(t("en-US", "calendarEventInterval"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "calendarEventEnds"))).toBeInTheDocument();
  });

  it("round-trips a weekly byDay rule through the form into the saved rule", () => {
    const onSave = vi.fn();
    setup({
      event: {
        ...base,
        startDate: "2026-01-05",
        recurrence: { freq: "weekly", interval: 1, byDay: ["MO", "WE"] },
      },
      onSave,
    });
    submit();
    expect(onSave.mock.calls[0][0].recurrence).toMatchObject({
      freq: "weekly",
      byDay: ["MO", "WE"],
    });
  });

  it("clears exceptions when the series is switched back to non-recurring (regression: it used to render nowhere while still listed)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    setup({
      event: {
        ...base,
        recurrence: { freq: "weekly", interval: 1 },
        exceptions: [{ date: "2026-01-01", kind: "skip" }],
      },
      onSave,
    });
    // "Never" also names the recurrence-ends option, so scope to the Repeat
    // radiogroup specifically rather than matching either one.
    const repeatGroup = within(
      screen.getByRole("radiogroup", { name: t("en-US", "calendarEventRepeat") }),
    );
    await user.click(repeatGroup.getByRole("radio", { name: t("en-US", "calendarEventRepeatNever") }));
    submit();
    expect(onSave.mock.calls[0][0].recurrence).toBeUndefined();
    expect(onSave.mock.calls[0][0].exceptions).toBeUndefined();
  });

  it("round-trips a monthly nth-weekday rule through the form into the saved rule", () => {
    const onSave = vi.fn();
    setup({
      event: {
        ...base,
        startDate: "2026-01-13",
        recurrence: { freq: "monthly", interval: 1, byDay: { ordinal: 2, day: "TU" } },
      },
      onSave,
    });
    submit();
    expect(onSave.mock.calls[0][0].recurrence).toMatchObject({
      freq: "monthly",
      byDay: { ordinal: 2, day: "TU" },
    });
  });

  it("clears a validation error once any field is edited afterwards", () => {
    // Mirrors absence-edit-modal's own landmine guard: update() clears the
    // error for free, but the first-occurrence field bypasses update() for
    // its two-field write, and that handler must not lose the reset.
    setup({ event: { ...base, title: "" }, isNew: true });
    submit();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    const startInput = screen.getByLabelText(
      new RegExp(t("en-US", "calendarEventFirstOccurrence")),
    ) as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: "2026-02-01" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hides the delete button for a new item", () => {
    setup({ isNew: true });
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("does not delete without a real confirmation", async () => {
    // No ConfirmProvider is mounted in this harness, so useConfirm()'s
    // context-default resolves false — clicking Delete must route through
    // that confirmation and NOT call onDelete when it declines.
    const onDelete = vi.fn();
    const user = userEvent.setup();
    setup({ onDelete });
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  describe("weekly recurrence pre-selects the start weekday when nothing is checked", () => {
    // base.startDate = "2026-01-01", a Thursday.
    it("checks the start weekday on switching to weekly with no prior selection", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      setup({ event: { ...base, recurrence: undefined }, onSave });
      await user.click(screen.getByRole("radio", { name: t("en-US", "calendarEventRepeatWeekly") }));
      expect(screen.getByLabelText(t("en-US", "shiftDayThu"))).toBeChecked();
      expect(screen.getByLabelText(t("en-US", "shiftDayMon"))).not.toBeChecked();
      submit();
      expect(onSave.mock.calls[0][0].recurrence).toMatchObject({ freq: "weekly", byDay: ["TH"] });
    });

    it("pre-checks the start weekday for an existing weekly event whose byDay is empty", () => {
      setup({
        event: { ...base, startDate: "2026-01-05", recurrence: { freq: "weekly", interval: 1 } },
      });
      // 2026-01-05 is a Monday.
      expect(screen.getByLabelText(t("en-US", "shiftDayMon"))).toBeChecked();
    });

    it("does not override an existing selection when switching away and back to weekly", async () => {
      const user = userEvent.setup();
      setup({
        event: { ...base, recurrence: { freq: "weekly", interval: 1, byDay: ["TU"] } },
      });
      expect(screen.getByLabelText(t("en-US", "shiftDayTue"))).toBeChecked();
      await user.click(screen.getByRole("radio", { name: t("en-US", "calendarEventRepeatDaily") }));
      await user.click(screen.getByRole("radio", { name: t("en-US", "calendarEventRepeatWeekly") }));
      expect(screen.getByLabelText(t("en-US", "shiftDayTue"))).toBeChecked();
      expect(screen.getByLabelText(t("en-US", "shiftDayThu"))).not.toBeChecked();
    });

    it("still saves an empty byDay (the implicit default) when the user unchecks it and saves without re-touching freq", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      setup({ event: { ...base, recurrence: undefined }, onSave });
      await user.click(screen.getByRole("radio", { name: t("en-US", "calendarEventRepeatWeekly") }));
      const thuBox = screen.getByLabelText(t("en-US", "shiftDayThu"));
      expect(thuBox).toBeChecked();
      await user.click(thuBox);
      expect(thuBox).not.toBeChecked();
      submit();
      const saved = onSave.mock.calls[0][0].recurrence;
      expect(saved).toEqual({ freq: "weekly", interval: 1 });
    });
  });

  it("warns that turning repeat off will discard the series' exceptions", async () => {
    const user = userEvent.setup();
    const series: CalendarEvent = {
      ...base,
      recurrence: { freq: "daily", interval: 1 },
      exceptions: [
        { date: "2026-01-03", kind: "skip" },
        { date: "2026-01-05", kind: "move", toDate: "2026-01-06" },
      ],
    };
    setup({ event: series });
    // Nothing to warn about while the series is still recurring.
    expect(screen.queryByText(/discards/i)).not.toBeInTheDocument();
    const repeatGroup = within(
      screen.getByRole("radiogroup", { name: t("en-US", "calendarEventRepeat") }),
    );
    await user.click(repeatGroup.getByRole("radio", { name: t("en-US", "calendarEventRepeatNever") }));
    expect(screen.getByText(/discards 2 adjusted occurrence/i)).toBeInTheDocument();
  });

  it("does not warn when a de-recurred series has no exceptions", async () => {
    const user = userEvent.setup();
    const series: CalendarEvent = {
      ...base,
      recurrence: { freq: "daily", interval: 1 },
    };
    setup({ event: series });
    const repeatGroup = within(
      screen.getByRole("radiogroup", { name: t("en-US", "calendarEventRepeat") }),
    );
    await user.click(repeatGroup.getByRole("radio", { name: t("en-US", "calendarEventRepeatNever") }));
    expect(screen.queryByText(/discards/i)).not.toBeInTheDocument();
  });
});
