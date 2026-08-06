import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { AbsenceEditModal } from "./absence-edit-modal";
import { applyTier } from "./field-visibility";
import { selectFieldTier } from "../test/field-tier";
import { t } from "./i18n";
import type { Absence } from "./types";

// ModalFieldControls (rendered in the modal header) reads field visibility from
// the workspace, so every render needs a WorkspaceProvider/FiltersProvider.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
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
    setFieldVisibility(() => ({ absence: applyTier("absence", tier) }));
  }, [setFieldVisibility, tier]);
  return null;
}

const base: Absence = {
  id: 1,
  assignee: "Alex Example",
  assigneeEmail: "Sample@example.com",
  startDate: "2026-06-01",
  endDate: "2026-06-05",
  type: "vacation",
  note: "Annual leave",
};

type ModalProps = React.ComponentProps<typeof AbsenceEditModal>;

/** Renders the modal at the Advanced default (email + note are Full-only → hidden). */
function setup(over: Partial<ModalProps> = {}) {
  const props: ModalProps = {
    lang: "en-US" as const,
    absence: base,
    isNew: false,
    knownAssignees: [],
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const result = render(<AbsenceEditModal {...props} />, { wrapper });
  return { props, ...result };
}

/** Like setup, but seeds the Full tier first so the Full-only Email/Note render. */
function setupFull(over: Partial<ModalProps> = {}) {
  const props: ModalProps = {
    lang: "en-US" as const,
    absence: base,
    isNew: false,
    knownAssignees: [],
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const result = render(
    <>
      <Seed tier="full" />
      <AbsenceEditModal {...props} />
    </>,
    { wrapper },
  );
  return { props, ...result };
}

describe("AbsenceEditModal", () => {
  it("renders nothing when absence is null", () => {
    const { container } = setup({ absence: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("saves with assignee/dates preserved", () => {
    const onSave = vi.fn();
    setup({ onSave });
    fireEvent.submit(
      screen.getByRole("button", { name: /save/i }).closest("form")!,
    );
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      assignee: "Alex Example",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
    });
  });

  it("blocks save when assignee is empty", () => {
    const onSave = vi.fn();
    setup({ absence: { ...base, assignee: "" }, isNew: true, onSave });
    fireEvent.submit(
      screen.getByRole("button", { name: /save/i }).closest("form")!,
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("preserves the hidden Full-only email/note values on save (Advanced default)", () => {
    const onSave = vi.fn();
    setup({ onSave });
    // Email + Note are Full-only, hidden at the Advanced default, but their
    // draft values must round-trip through save untouched.
    fireEvent.submit(
      screen.getByRole("button", { name: /save/i }).closest("form")!,
    );
    expect(onSave.mock.calls[0][0]).toMatchObject({
      assigneeEmail: "Sample@example.com",
      note: "Annual leave",
    });
  });

  it("renders an InfoTooltip for the Start date field (accessible by hint text as aria-label)", () => {
    setup();
    expect(screen.getByRole("button", { name: t("en-US", "absenceStartHint") })).toBeInTheDocument();
  });

  it("renders an InfoTooltip on the assignee field accessible by absenceAssigneeHint", () => {
    setup();
    expect(
      screen.getByRole("button", { name: t("en-US", "absenceAssigneeHint") }),
    ).toBeInTheDocument();
  });

  describe("field visibility", () => {
    it("Advanced default shows Type and hides Full-only Email; Simple hides Type while the required Assignee stays", () => {
      setup();
      // Advanced default: Type (advanced) is visible; Email (full) is hidden.
      expect(screen.getByText(t("en-US", "absenceType"))).toBeInTheDocument();
      expect(screen.queryByText(t("en-US", "absenceAssigneeEmail"))).toBeNull();
      // Required Assignee input is always rendered, regardless of tier.
      expect(
        screen.getByText((c) => c.startsWith(t("en-US", "absenceAssignee"))),
      ).toBeInTheDocument();

      // Switch to Full via the modal-header control cluster → Email appears.
      selectFieldTier("fieldViewFull");
      expect(screen.getByText(t("en-US", "absenceAssigneeEmail"))).toBeInTheDocument();

      // Switch to Simple → Type and Email are hidden, Assignee still present.
      selectFieldTier("fieldViewSimple");
      expect(screen.queryByText(t("en-US", "absenceType"))).toBeNull();
      expect(screen.queryByText(t("en-US", "absenceAssigneeEmail"))).toBeNull();
      expect(
        screen.getByText((c) => c.startsWith(t("en-US", "absenceAssignee"))),
      ).toBeInTheDocument();
    });

    it("renders Email and Note when seeded to the Full tier", () => {
      setupFull();
      expect(screen.getByText(t("en-US", "absenceAssigneeEmail"))).toBeInTheDocument();
      expect(screen.getByText(t("en-US", "absenceNote"))).toBeInTheDocument();
    });
  });

  it("pulls the end date along when the start moves past it", () => {
    setup();
    const start = screen.getByLabelText(/start/i) as HTMLInputElement;
    fireEvent.change(start, { target: { value: "2026-07-10" } });
    const end = screen.getByLabelText(/end/i) as HTMLInputElement;
    expect(end.value).toBe("2026-07-10");
  });

  it("clears the end-before-start error once the start date is corrected", () => {
    setup();
    // End is deliberately unclamped — edit it directly to trigger the
    // submit-time "end before start" guard.
    const end = screen.getByLabelText(/end/i) as HTMLInputElement;
    fireEvent.change(end, { target: { value: "2026-05-01" } });
    fireEvent.submit(
      screen.getByRole("button", { name: /save/i }).closest("form")!,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    const start = screen.getByLabelText(/start/i) as HTMLInputElement;
    fireEvent.change(start, { target: { value: "2026-04-01" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
