import { render, screen, fireEvent } from "@testing-library/react";
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
});
