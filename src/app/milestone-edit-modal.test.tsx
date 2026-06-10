import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MilestoneEditModal } from "./milestone-edit-modal";

// Mock M365 hooks consumed by DocumentLinksFieldGated — default: SharePoint off.
vi.mock("./use-settings", () => ({
  useSettings: () => ({ settings: { integrations: { m365: { enabled: false, sharepoint: false } } }, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" }),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken: vi.fn(async () => "tok") }),
}));

it("renders a new-milestone form without crashing", () => {
  render(
    <MilestoneEditModal
      lang="en-US"
      milestone={{ id: 1, name: "", date: "2026-08-01", linkedTaskIds: [] }}
      isNew
      tasks={[]}
      onSave={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByText(/new milestone/i)).toBeTruthy();
});

describe("MilestoneEditModal — document links", () => {
  it("shows the SharePoint hint when M365 is off", () => {
    render(
      <MilestoneEditModal
        lang="en-US"
        milestone={{ id: 1, name: "M", date: "2026-01-01", linkedTaskIds: [] }}
        isNew
        tasks={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });
});
