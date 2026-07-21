import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { StakeholderEditModal } from "./stakeholder-edit-modal";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";
import type { Stakeholder, Milestone, Resource } from "./types";

// Mock M365 hooks consumed by KnowledgeLinksFieldGated — default: SharePoint off.
vi.mock("./use-settings", () => ({
  useSettings: () => ({ settings: { integrations: { m365: { enabled: false, sharepoint: false } } }, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" }),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken: vi.fn(async () => "tok") }),
}));

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
    setFieldVisibility(() => ({ stakeholder: applyTier("stakeholder", tier) }));
  }, [setFieldVisibility, tier]);
  return null;
}

const draft: Stakeholder = {
  id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "Medium", raci: {},
};
const milestones: Milestone[] = [{ id: 10, name: "Go-Live", date: "2026-09-01", linkedTaskIds: [] }];

function setup(over: Partial<React.ComponentProps<typeof StakeholderEditModal>> = {}) {
  const props = {
    lang: "en-US" as const, draft, isNew: true, milestones, resources: [],
    onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn(), ...over,
  };
  render(<StakeholderEditModal {...props} />, { wrapper });
  return props;
}

/** Like setup, but seeds the Full tier first so Full-only fields (notes, raci) render. */
function setupFull(over: Partial<React.ComponentProps<typeof StakeholderEditModal>> = {}) {
  const props = {
    lang: "en-US" as const, draft, isNew: true, milestones, resources: [],
    onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn(), ...over,
  };
  render(
    <>
      <Seed tier="full" />
      <StakeholderEditModal {...props} />
    </>,
    { wrapper },
  );
  return props;
}

describe("StakeholderEditModal", () => {
  it("requires a name to save", () => {
    const p = setup({ draft: { ...draft, name: "" } });
    fireEvent.submit(screen.getByRole("button", { name: /save/i }).closest("form")!);
    expect(p.onSave).not.toHaveBeenCalled();
  });
  it("edits a RACI cell for a milestone", () => {
    // raci is a Full-only registry field, hidden at the Advanced default — seed Full.
    const p = setupFull();
    fireEvent.change(screen.getByLabelText("Go-Live (RACI)"), { target: { value: "A" } });
    expect(p.onChange).toHaveBeenCalledWith(expect.objectContaining({ raci: { "10": "A" } }));
  });
  it("picks influence and interest together from the matrix", () => {
    const p = setup({ draft: { ...draft, influence: "Low", interest: "Low" } });
    fireEvent.click(screen.getByRole("button", { name: /influence high.*interest high/i }));
    expect(p.onChange).toHaveBeenCalledWith(expect.objectContaining({ influence: "High", interest: "High" }));
  });
});

describe("StakeholderEditModal — name picker (link-only)", () => {
  const resources: Resource[] = [
    { id: 1, firstName: "Sample", lastName: "Dummy", email: "Sample@x.com", roleId: null, utilizationMode: "percent", utilization: {} },
  ];

  // The name picker is the combobox wired to the name counter; the Category
  // <select> also carries the implicit combobox role, so disambiguate by that.
  const namePicker = () =>
    screen
      .getAllByRole("combobox")
      .find((el) => el.getAttribute("aria-describedby") === "stakeholder-name-counter")!;

  // The picker's onChange dropped next.email, so picking a person never adopted
  // their address — and once ✕ started clearing the whole field, clearing the
  // name left the old email stranded on a stakeholder with no name. Every other
  // consumer of this picker threads the email through.
  it("picking a resource adopts their email too", () => {
    const p = setup({ draft: { ...draft, name: "", email: "stale@old.com" }, resources });
    fireEvent.focus(namePicker());
    fireEvent.mouseDown(screen.getByText("Alex Example"));
    expect(p.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Alex Example", email: "Sample@x.com", resourceId: 1 }),
    );
  });

  it("clearing the picker clears the adopted email with it", () => {
    const p = setup({ draft: { ...draft, name: "Alex Example", email: "Sample@x.com", resourceId: 1 }, resources });
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(p.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "", email: "", resourceId: null }),
    );
  });

  it("picking a resource sets both name and resourceId", () => {
    const p = setup({ draft: { ...draft, name: "" }, resources });
    fireEvent.focus(namePicker());
    fireEvent.mouseDown(screen.getByText("Alex Example"));
    expect(p.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Alex Example", resourceId: 1 }),
    );
  });

  it("typing a free name keeps the stakeholder external (no + Add row, resourceId stays unset)", () => {
    const p = setup({ draft: { ...draft, name: "" }, resources });
    fireEvent.focus(namePicker());
    fireEvent.change(namePicker(), { target: { value: "External Person" } });
    expect(screen.queryByText(/Add .* as resource/i)).toBeNull();
    const onChangeSpy = p.onChange as ReturnType<typeof vi.fn>;
    const lastCall = onChangeSpy.mock.calls.at(-1)?.[0] as Stakeholder;
    expect(lastCall.name).toBe("External Person");
    expect(lastCall.resourceId == null).toBe(true);
  });
});

describe("StakeholderEditModal — document links", () => {
  it("shows the SharePoint hint when M365 is off", () => {
    setup({ draft: { id: 1, name: "S", category: "Internal", influence: "Low", interest: "Low", raci: {} } });
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });
});

describe("StakeholderEditModal — edit heading", () => {
  it("shows 'Edit stakeholder' heading when editing an existing item", () => {
    setup({ isNew: false });
    expect(screen.getByRole("heading", { name: t("en-US", "stakeholderEditTitle") })).toBeInTheDocument();
  });
});

describe("StakeholderEditModal — field tooltips", () => {
  it("renders an InfoTooltip for the Organization field (accessible by hint text as aria-label)", () => {
    setup();
    expect(screen.getByRole("button", { name: t("en-US", "stakeholderFieldOrganizationHint") })).toBeInTheDocument();
  });
  it("renders an InfoTooltip for the Name field (accessible by hint text as aria-label)", () => {
    setup();
    expect(screen.getByRole("button", { name: t("en-US", "stakeholderFieldNameHint") })).toBeInTheDocument();
  });
});

describe("StakeholderEditModal — field visibility", () => {
  // The required Name input is always shown; the Influence/Interest matrix is an
  // Advanced field shown by default; the RACI block is Full-only and hidden at
  // the Advanced default. The cog popover is closed, so body labels are safe.
  const RACI_LABEL = t("en-US", "raciSectionTitle");
  const SIMPLE_LABEL = t("en-US", "fieldViewSimple");

  it("shows the advanced influence/interest field and hides Full-only RACI at the Advanced default", () => {
    setup();
    // Required Name input is always present (its ResourcePicker carries the counter).
    expect(
      screen
        .getAllByRole("combobox")
        .some((el) => el.getAttribute("aria-describedby") === "stakeholder-name-counter"),
    ).toBe(true);
    // Advanced field visible by default — the matrix descriptor mentions Influence.
    expect(screen.getByText(/Influence: High/)).toBeInTheDocument();
    // Full-only RACI block hidden at the Advanced default.
    expect(screen.queryByText(RACI_LABEL)).not.toBeInTheDocument();
  });

  it("clicking Simple hides the advanced field while the required Name input remains", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: SIMPLE_LABEL }));
    // Advanced influence/interest descriptor is now hidden.
    expect(screen.queryByText(/Influence: High/)).not.toBeInTheDocument();
    // Required Name picker remains.
    expect(
      screen
        .getAllByRole("combobox")
        .some((el) => el.getAttribute("aria-describedby") === "stakeholder-name-counter"),
    ).toBe(true);
  });
});
