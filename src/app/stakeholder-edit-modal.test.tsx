import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StakeholderEditModal } from "./stakeholder-edit-modal";
import type { Stakeholder, Milestone } from "./types";

// Mock M365 hooks consumed by DocumentLinksFieldGated — default: SharePoint off.
vi.mock("./use-settings", () => ({
  useSettings: () => ({ settings: { integrations: { m365: { enabled: false, sharepoint: false } } }, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" }),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken: vi.fn(async () => "tok") }),
}));

const draft: Stakeholder = {
  id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "Medium", raci: {},
};
const milestones: Milestone[] = [{ id: 10, name: "Go-Live", date: "2026-09-01", linkedTaskIds: [] }];

function setup(over: Partial<React.ComponentProps<typeof StakeholderEditModal>> = {}) {
  const props = {
    lang: "en-US" as const, draft, isNew: true, milestones, resources: [],
    onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn(), ...over,
  };
  render(<StakeholderEditModal {...props} />);
  return props;
}

describe("StakeholderEditModal", () => {
  it("requires a name to save", () => {
    const p = setup({ draft: { ...draft, name: "" } });
    fireEvent.submit(screen.getByRole("button", { name: /save/i }).closest("form")!);
    expect(p.onSave).not.toHaveBeenCalled();
  });
  it("edits a RACI cell for a milestone", () => {
    const p = setup();
    fireEvent.change(screen.getByLabelText("Go-Live (RACI)"), { target: { value: "A" } });
    expect(p.onChange).toHaveBeenCalledWith(expect.objectContaining({ raci: { "10": "A" } }));
  });
  it("picks influence and interest together from the matrix", () => {
    const p = setup({ draft: { ...draft, influence: "Low", interest: "Low" } });
    fireEvent.click(screen.getByRole("button", { name: /influence high.*interest high/i }));
    expect(p.onChange).toHaveBeenCalledWith(expect.objectContaining({ influence: "High", interest: "High" }));
  });
});

describe("StakeholderEditModal — document links", () => {
  it("shows the SharePoint hint when M365 is off", () => {
    setup({ draft: { id: 1, name: "S", category: "Internal", influence: "Low", interest: "Low", raci: {} } });
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });
});
