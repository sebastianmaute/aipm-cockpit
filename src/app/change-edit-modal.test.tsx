import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { ChangeEditModal } from "./change-edit-modal";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";
import type { ChangeItem, Stakeholder } from "./types";

// Mock M365 hooks consumed by KnowledgeLinksFieldGated — default: SharePoint off.
vi.mock("./use-settings", () => ({
  useSettings: () => ({ settings: { integrations: { m365: { enabled: false, sharepoint: false } } }, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" }),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken: vi.fn(async () => "tok") }),
}));

const draft: ChangeItem = { id: 1, title: "Widen scope", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] };
const base = {
  lang: "en-US" as const, tasks: [], raid: [], draft, isNew: false,
  onChange: vi.fn(), onApplyStatus: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn(),
};

function change(over: Partial<ChangeItem> = {}): ChangeItem {
  return { ...draft, ...over };
}
function s(id: number, name: string): Stakeholder {
  return { id, name, category: "Internal", influence: "Medium", interest: "Medium", raci: {} };
}

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
    setFieldVisibility(() => ({ change: applyTier("change", tier) }));
  }, [setFieldVisibility, tier]);
  return null;
}

function renderModal(over: Partial<React.ComponentProps<typeof ChangeEditModal>> = {}) {
  return render(<ChangeEditModal {...base} {...over} />, { wrapper });
}

/** Render with the Full tier seeded, so Full-only fields (links) are present. */
function renderModalFull(over: Partial<React.ComponentProps<typeof ChangeEditModal>> = {}) {
  return render(
    <>
      <Seed tier="full" />
      <ChangeEditModal {...base} {...over} />
    </>,
    { wrapper },
  );
}

describe("ChangeEditModal", () => {
  // ★★ Same as the stakeholder modal: this one stacked a window-level
  // `useEscapeKey(onCancel)` on top of Modal's own Escape handling. It ignored
  // `defaultPrevented`, and only avoided discarding drafts because the linked-
  // tasks picker ALSO calls stopPropagation — an accident, not a design.
  // Removing it left nothing asserting Escape still closes this modal.
  it("closes on Escape", () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not close on an Escape a descendant already consumed", () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });
    const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    consumed.preventDefault();
    document.dispatchEvent(consumed);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("renders the title field, a type select, and a status select", () => {
    const { getByDisplayValue } = renderModal();
    expect(getByDisplayValue("Widen scope")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: t("en-US", "changeFieldType") })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: t("en-US", "changeFieldStatus") })).toBeTruthy();
  });
  it("calls onApplyStatus when the status changes", () => {
    const onApplyStatus = vi.fn();
    renderModal({ onApplyStatus });
    const sel = screen.getByRole("combobox", { name: t("en-US", "changeFieldStatus") }) as HTMLSelectElement;
    sel.value = "Approved";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onApplyStatus).toHaveBeenCalledWith("Approved");
  });
  it("calls onSave / onCancel from the footer buttons", () => {
    const onSave = vi.fn(), onCancel = vi.fn();
    const { getByRole } = renderModal({ onSave, onCancel });
    getByRole("button", { name: /save/i }).click();
    getByRole("button", { name: /cancel/i }).click();
    expect(onSave).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("ChangeEditModal — document links", () => {
  it("shows the SharePoint hint when M365 is off", () => {
    renderModal();
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });
});

describe("ChangeEditModal — stakeholders", () => {
  it("edits linked stakeholders when stakeholders module is enabled", () => {
    const onChange = vi.fn();
    // Stakeholders live in the Full-only `links` group, so seed the Full tier.
    renderModalFull({ stakeholdersEnabled: true, stakeholders: [s(3, "Dana"), s(7, "Lee")], draft: change({ stakeholderIds: [] }), onChange });
    fireEvent.click(screen.getByLabelText("Dana"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ stakeholderIds: [3] }));
  });
  it("hides the stakeholder picker when the module is disabled", () => {
    renderModalFull({ stakeholdersEnabled: false, stakeholders: [s(3, "Dana")], draft: change({ stakeholderIds: [] }) });
    expect(screen.queryByText(t("en-US", "fieldStakeholders"))).not.toBeInTheDocument();
  });
});

describe("ChangeEditModal — field visibility", () => {
  // The modal body labels (changeFieldRequestedBy / changeFieldLinkedTasks)
  // double as cog-checklist labels, so target the BODY inputs/labels to stay
  // distinct from the cog popover (which is closed by default anyway).
  const REQUESTOR_LABEL = t("en-US", "changeFieldRequestedBy");
  const LINKED_TASKS_LABEL = t("en-US", "changeFieldLinkedTasks");

  it("shows advanced fields and hides Full-only links by default (Advanced)", () => {
    renderModal();
    // Advanced-tier field present.
    expect(screen.getByText(REQUESTOR_LABEL)).toBeTruthy();
    // Full-only `links` group (linked tasks) absent.
    expect(screen.queryByText(LINKED_TASKS_LABEL)).toBeNull();
    // Required Title input always rendered.
    expect(screen.getByDisplayValue("Widen scope")).toBeTruthy();
  });

  it("hides advanced fields like Requested-by when switched to Simple, keeping Title", async () => {
    const user = userEvent.setup();
    renderModal();
    expect(screen.getByText(REQUESTOR_LABEL)).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: t("en-US", "fieldViewSimple") }),
    );

    expect(screen.queryByText(REQUESTOR_LABEL)).toBeNull();
    expect(screen.getByDisplayValue("Widen scope")).toBeTruthy();
  });

  it("shows the Full-only linked-tasks group in Full tier", () => {
    renderModalFull();
    expect(screen.getByText(LINKED_TASKS_LABEL)).toBeTruthy();
  });
});

describe("ChangeEditModal — edit heading", () => {
  it("shows 'Edit change' heading when editing an existing item", () => {
    renderModal({ isNew: false });
    expect(screen.getByRole("heading", { name: t("en-US", "changeEditTitle") })).toBeInTheDocument();
  });
});

describe("ChangeEditModal — field tooltips", () => {
  it("renders an InfoTooltip for the Title field (accessible by hint text as aria-label)", () => {
    renderModal();
    expect(screen.getByRole("button", { name: t("en-US", "changeFieldTitleHint") })).toBeInTheDocument();
  });
});
