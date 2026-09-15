import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { StakeholderEditModal } from "./stakeholder-edit-modal";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";
import { selectFieldTier } from "../test/field-tier";
import { expectNoLabelBoundToButton } from "../test/label-binding";
import { expectExactLabelNames, expectNoHintInNamingLabel } from "../test/hint-label";
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
  // ★★ This modal used to stack its own window-level `useEscapeKey(onCancel)`
  // ON TOP of the Modal's Escape handling. That hook ignored `defaultPrevented`,
  // so an Escape aimed at a descendant (the ResourcePicker dropdown) closed the
  // modal too and discarded the draft. Removing it left NOTHING asserting that
  // Escape still closes this modal at all — the whole handler was deletable
  // with every suite green. These two pin both halves.
  it("closes on Escape", () => {
    const props = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not close on an Escape a descendant already consumed", () => {
    const props = setup();
    const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    consumed.preventDefault();
    document.dispatchEvent(consumed);
    expect(props.onCancel).not.toHaveBeenCalled();
  });

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

describe("stakeholder email follows the changed-only write rule", () => {
  // ★ StakeholderEditModal is controlled (the parent owns `draft`), so a typed
  //  change must be reflected back through a stateful host or the value never
  //  reaches the modal's own handleSubmit.
  function Host({
    initial,
    onSave,
    resources = [],
  }: {
    initial: Stakeholder;
    onSave: () => void;
    resources?: Resource[];
  }) {
    const [d, setD] = useState(initial);
    return (
      <>
        <Seed tier="full" />
        <StakeholderEditModal
          lang="en-US"
          draft={d}
          isNew={true}
          milestones={milestones}
          resources={resources}
          onChange={setD}
          onSave={onSave}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </>
    );
  }

  it("refuses a CHANGED malformed email on save", () => {
    const onSave = vi.fn();
    render(
      <Host
        initial={{ id: 1, name: "Sam", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "old@x.com" }}
        onSave={onSave}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByDisplayValue("old@x.com"), { target: { value: "nope" } });
    fireEvent.submit(screen.getByDisplayValue("Sam").closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(t("en-US", "errorInvalidEmail"));
  });

  // M-C4 — the editor hands `onSave` the `Name <addr>`-unwrapped (then capped)
  //  address, as every AI write and load stores it, and judges that same value.
  it("M-C4: a typed Name <addr> email is saved as addr, unflagged", () => {
    const onSave = vi.fn();
    render(
      <Host
        initial={{ id: 1, name: "Sam", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "old@x.com" }}
        onSave={onSave}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByDisplayValue("old@x.com"), { target: { value: "Ann Lee <ann@x.com>" } });
    expect(screen.queryByText(t("en-US", "errorInvalidEmail"))).toBeNull();
    fireEvent.submit(screen.getByDisplayValue("Sam").closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 1, name: "Sam", email: "ann@x.com" });
  });

  it("M-C4: a shape-only email edit is saved as the unchanged address", () => {
    const onSave = vi.fn();
    render(
      <Host
        initial={{ id: 1, name: "Sam", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "ada@x.com" }}
        onSave={onSave}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByDisplayValue("ada@x.com"), { target: { value: "Ada<ada@x.com>" } });
    fireEvent.submit(screen.getByDisplayValue("Sam").closest("form")!);
    expect(onSave.mock.calls[0][0].email).toBe("ada@x.com");
  });

  it("saves while an unchanged stored email is unsafe", () => {
    const onSave = vi.fn();
    render(
      <Host
        initial={{ id: 1, name: "Sam", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "a,b@x.com" }}
        onSave={onSave}
      />,
      { wrapper },
    );
    fireEvent.submit(screen.getByDisplayValue("Sam").closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  // Fix round 1, IMPORTANT 3 — the copy-source exemption was unpinned: every
  // host passed `resources={[]}`, so a real linked resource's unsafe email was
  // never actually exercised as a copy source.
  it("exempts a copy of the linked resource's stored email", () => {
    const onSave = vi.fn();
    const linked: Resource = {
      id: 9, firstName: "Ada", lastName: "L", email: "a,b@x.com",
      roleId: null, utilizationMode: "percent", utilization: {},
    };
    render(
      <Host
        initial={{ id: 1, name: "Sam", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "old@x.com", resourceId: 9 }}
        onSave={onSave}
        resources={[linked]}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByDisplayValue("old@x.com"), { target: { value: "a,b@x.com" } });
    fireEvent.submit(screen.getByRole("button", { name: /save/i }).closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  // Positive control: the SAME unsafe value with no resource link is refused.
  it("positive control: the identical value with no link is refused", () => {
    const onSave = vi.fn();
    render(
      <Host
        initial={{ id: 1, name: "Sam", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "old@x.com" }}
        onSave={onSave}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByDisplayValue("old@x.com"), { target: { value: "a,b@x.com" } });
    fireEvent.submit(screen.getByDisplayValue("Sam").closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
  });

  // The typed value is judged CAPPED (200) while the linked email is 250 chars,
  // so the capped value never equals the copy source and no exemption applies.
  it("refuses an over-cap (250-char) unsafe email even when the linked resource holds the same string", () => {
    const onSave = vi.fn();
    const longUnsafe = "a,b@x.co" + "m".repeat(242);
    expect(longUnsafe).toHaveLength(250);
    const linked: Resource = {
      id: 9, firstName: "Ada", lastName: "L", email: longUnsafe,
      roleId: null, utilizationMode: "percent", utilization: {},
    };
    render(
      <Host
        initial={{ id: 1, name: "Sam", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "old@x.com", resourceId: 9 }}
        onSave={onSave}
        resources={[linked]}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByDisplayValue("old@x.com"), { target: { value: longUnsafe } });
    fireEvent.submit(screen.getByRole("button", { name: /save/i }).closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(t("en-US", "errorEmailDelimiter"));
  });

  // Fix round 2, MINOR — an UNRELATED banner error (blank name) must never
  // hide the flag: the stored unsafe email is untouched.
  it("keeps the flag visible while an unrelated banner error is showing", () => {
    const onSave = vi.fn();
    render(
      <Host
        initial={{ id: 1, name: "", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "a,b@x.com" }}
        onSave={onSave}
      />,
      { wrapper },
    );
    fireEvent.submit(screen.getByRole("button", { name: /save/i }).closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toContain(t("en-US", "raidErrorTitleRequired"));
    expect(alerts).toContain(t("en-US", "errorEmailDelimiter"));
    expect(alerts).toHaveLength(2);
  });

  // Fix round 1, IMPORTANT 2 — the value that would be STORED must be judged,
  // not the raw typed one: `sanitizeStakeholder` caps email at BUDGET_NAME_MAX
  // (200). Capping at 200 removes the trailing delimiter, leaving a SAFE
  // 200-char address.
  it("saves a >200-char email that is safe once capped at BUDGET_NAME_MAX", () => {
    const onSave = vi.fn();
    render(
      <Host
        initial={{ id: 1, name: "Sam", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "old@x.com" }}
        onSave={onSave}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByDisplayValue("old@x.com"), {
      target: { value: "a".repeat(195) + "@x.co,zz" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /save/i }).closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  // The other side of the same probe: capping at 200 truncates mid-domain,
  // leaving an INVALID 200-char address — still refused.
  it("refuses a >200-char email that is invalid once capped at BUDGET_NAME_MAX", () => {
    const onSave = vi.fn();
    render(
      <Host
        initial={{ id: 1, name: "Sam", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "old@x.com" }}
        onSave={onSave}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByDisplayValue("old@x.com"), {
      target: { value: "a".repeat(199) + "@x.com" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /save/i }).closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
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

// open-followups §386: every hinted field's control is named by its caption
// alone. (Category names itself with aria-label.)
describe("StakeholderEditModal — hinted field names (§386)", () => {
  it("names every hinted control with its caption alone", () => {
    setupFull();
    expectNoHintInNamingLabel({ minHints: 4 });
    expectExactLabelNames([
      t("en-US", "stakeholderFieldOrganization"),
      t("en-US", "stakeholderFieldTitle"),
      t("en-US", "stakeholderFieldEmail"),
      t("en-US", "stakeholderFieldNotes"),
    ]);
  });
});

describe("StakeholderEditModal — field visibility", () => {
  // The required Name input is always shown; the Influence/Interest matrix is an
  // Advanced field shown by default; the RACI block is Full-only and hidden at
  // the Advanced default. The cog popover is closed, so body labels are safe.
  const RACI_LABEL = t("en-US", "raciSectionTitle");

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

  // ★★ This modal got FIVE label conversions (Name → `FieldGroup`; Organization,
  // Title and Notes → `htmlFor`; Documents → `DocumentLinksGroup` — Email and the
  // category `<Select>` were already correct) and, until this test, no render
  // guard at all. The other three MODALS have one each; the remaining call
  // sites are not modals. Counting them here has now been wrong twice, so the
  // command is the answer rather than the number —
  // `grep -rn "expectNoLabelBoundToButton()" src | grep -v src/test/label-binding`. Its reach is limited
  // in the SAME two ways as theirs, and both limits are invisible here rather
  // than absent: under jsdom the dictation mic renders `null` (`voice.ts`
  // `getCtor()` has no SpeechRecognition), and `KnowledgeLinksFieldGated`
  // returns a bare `<p>` because SharePoint is mocked off above. So this pins
  // the four plain-input rows and the Name group; the mic and document-links
  // classes are covered by `label-binding.guard.test.ts`, which reads SOURCE.
  it("binds no field label to a button, and no htmlFor dangles", () => {
    setupFull();
    expectNoLabelBoundToButton();
  });

  it("clicking Simple hides the advanced field while the required Name input remains", () => {
    setup();
    selectFieldTier("fieldViewSimple");
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
