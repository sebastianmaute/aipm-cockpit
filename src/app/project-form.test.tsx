import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("./use-settings", () => ({
  useSettings: () => ({
    settings: { integrations: { m365: { enabled: false, sharepoint: false } } },
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US",
  }),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({
    account: null,
    ready: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
    acquireToken: vi.fn(async () => "tok"),
  }),
}));

import { ProjectForm } from "./project-form";
import { type Contact } from "./contacts";
import { type ProjectMeta, type Resource } from "./types";

const STAKEHOLDERS = ["Alice Smith", "Bob Jones"];
const ADDRESS_BOOK: Contact[] = [
  { name: "Carol White", email: "carol@example.com" },
];
const RESOURCES: Resource[] = [
  {
    id: 1,
    firstName: "Sample",
    lastName: "Dummy",
    email: "s@x.com",
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
  },
];

function setup(overrides: Partial<React.ComponentProps<typeof ProjectForm>> = {}) {
  const onSubmit = vi.fn<(meta: ProjectMeta) => void>();
  const onCancel = vi.fn();
  render(
    <ProjectForm
      lang="en-US"
      stakeholderNames={STAKEHOLDERS}
      addressBook={ADDRESS_BOOK}
      resources={RESOURCES}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onSubmit, onCancel };
}

/** The submit button (create mode label) — disabled state mirrors validity. */
function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "New project" }) as HTMLButtonElement;
}

/** Type a name into a StakeholderRecipientInput (by id) and press Enter. */
function addStakeholder(inputId: string, name: string) {
  const input = document.getElementById(inputId) as HTMLInputElement;
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function setText(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), {
    target: { value },
  });
}

/** Fill every required field so the form becomes valid. */
function fillRequired() {
  setText("Project name", "Apollo");
  setText("Project code", "APL-1");
  setText("Project manager", "Dana PM");
  addStakeholder("keyStakeholdersInternal", "Alice Smith");
  addStakeholder("keyStakeholdersExternal", "Ext Person");
  setText("Customer", "ACME Corp");
  fireEvent.change(screen.getByLabelText("NACE section", { exact: false }), {
    target: { value: "C" },
  });
  setText("Products", "Widget");
  fireEvent.change(screen.getByLabelText("Deployment", { exact: false }), {
    target: { value: "Cloud" },
  });
  setText("Start date", "2026-01-01");
  setText("End date", "2026-06-01");
  setText("Profit center", "PC-9");
  // Regulatory: tick the first non-"Not applicable" requirement.
  fireEvent.click(screen.getByLabelText("GDPR / data protection regulation"));
  // Contacts are now mandatory (≥1): add one manual contact.
  fireEvent.change(screen.getByPlaceholderText("Add manually"), {
    target: { value: "Pat Contact" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
}

describe("ProjectForm", () => {
  it("disables Save initially in create mode (required fields blank)", () => {
    setup();
    expect(saveButton()).toBeDisabled();
  });

  it("enables Save once all required fields are filled", () => {
    setup();
    fillRequired();
    expect(saveButton()).toBeEnabled();
  });

  it("submits a sanitized ProjectMeta matching the entered values", () => {
    const { onSubmit } = setup();
    fillRequired();
    fireEvent.click(saveButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const meta = onSubmit.mock.calls[0][0];
    expect(meta.name).toBe("Apollo");
    expect(meta.deployment).toBe("Cloud");
    expect(meta.regulatory).toEqual(["GDPR / data protection regulation"]);
    expect(meta.keyStakeholdersInternal).toEqual(["Alice Smith"]);
    expect(meta.keyStakeholdersExternal).toEqual(["Ext Person"]);
    expect(meta.naceSection).toBe("C");
  });

  it("shows endBeforeStart error and disables Save when endDate < startDate", () => {
    setup();
    fillRequired();
    setText("End date", "2025-01-01"); // before start
    const endInput = screen.getByLabelText("End date", { exact: false });
    fireEvent.blur(endInput);

    expect(screen.getByText("End date must be after start date.")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  /** The contact-persons ResourcePicker input, located by its placeholder. */
  function contactPicker(): HTMLInputElement {
    return screen.getByPlaceholderText("Add manually") as HTMLInputElement;
  }

  it("links a resource picked in the contact-persons picker (synced + resourceId)", () => {
    const { onSubmit } = setup();
    fillRequired();

    const picker = contactPicker();
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "Sample" } });
    fireEvent.mouseDown(screen.getByText("Alex Example"));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(saveButton());
    const meta = onSubmit.mock.calls[0][0];
    const Sample = meta.contactPersons.find((c) => c.name === "Alex Example");
    expect(Sample).toEqual({
      name: "Alex Example",
      email: "s@x.com",
      synced: true,
      resourceId: 1,
    });
  });

  it("records a free-typed manual contact as synced:false with no resourceId", () => {
    const { onSubmit } = setup();
    fillRequired();

    const picker = contactPicker();
    fireEvent.change(picker, { target: { value: "Manny Manual" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(saveButton());
    const meta = onSubmit.mock.calls[0][0];
    const manny = meta.contactPersons.find((c) => c.name === "Manny Manual");
    expect(manny).toEqual({ name: "Manny Manual", email: "", synced: false });
  });

  it("captures a typed email for an external (free-typed) contact", () => {
    const { onSubmit } = setup();
    fillRequired();

    fireEvent.change(contactPicker(), { target: { value: "Vera Vendor" } });
    fireEvent.change(screen.getByPlaceholderText("email"), {
      target: { value: "vera@vendor.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(saveButton());
    const meta = onSubmit.mock.calls[0][0];
    const vera = meta.contactPersons.find((c) => c.name === "Vera Vendor");
    expect(vera).toEqual({ name: "Vera Vendor", email: "vera@vendor.com", synced: false });
  });

  it("offers NO '+ Add as resource' row in the contact-persons picker (link-only)", () => {
    setup();
    const picker = contactPicker();
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "Totally New Vendor" } });
    expect(screen.queryByText(/Add .* as resource/i)).toBeNull();
  });

  it("treats Not applicable as exclusive in the regulatory group", () => {
    setup();

    const gdpr = screen.getByLabelText("GDPR / data protection regulation") as HTMLInputElement;
    const na = screen.getByLabelText("Not applicable") as HTMLInputElement;

    fireEvent.click(gdpr);
    expect(gdpr.checked).toBe(true);

    // Selecting "Not applicable" clears the others.
    fireEvent.click(na);
    expect(na.checked).toBe(true);
    expect(gdpr.checked).toBe(false);

    // Selecting another clears "Not applicable".
    fireEvent.click(gdpr);
    expect(gdpr.checked).toBe(true);
    expect(na.checked).toBe(false);
  });

  it("calls onCancel when Cancel is clicked", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders the Documents field with the SharePoint gate hint when M365 is off", () => {
    setup();
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });
});
