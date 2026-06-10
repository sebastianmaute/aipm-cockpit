import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivityLogProvider } from "./activity-log-context";

const acquireToken = vi.fn(async () => "tok");
let mockM365: { enabled: boolean; sharepoint: boolean } | undefined;

vi.mock("./use-settings", () => ({
  useSettings: () => ({ settings: { integrations: { m365: mockM365 } } }),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken }),
}));

import { DocumentLinksFieldGated } from "./document-links-field-gated";

describe("DocumentLinksFieldGated", () => {
  it("shows the needs-SharePoint hint when integration is off", () => {
    mockM365 = { enabled: false, sharepoint: false };
    render(<DocumentLinksFieldGated value={[]} onChange={vi.fn()} lang="en-US" />);
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });

  it("shows the needs-SharePoint hint when m365 on but sharepoint off", () => {
    mockM365 = { enabled: true, sharepoint: false };
    render(<DocumentLinksFieldGated value={[]} onChange={vi.fn()} lang="en-US" />);
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });

  it("renders the field (Add button) when m365 + sharepoint are on", () => {
    mockM365 = { enabled: true, sharepoint: true };
    render(<DocumentLinksFieldGated value={[]} onChange={vi.fn()} lang="en-US" />);
    expect(screen.getByRole("button", { name: /add from sharepoint/i })).toBeInTheDocument();
  });

  it("calls logActivity with doc.linkRemoved when a link is removed inside ActivityLogProvider", () => {
    mockM365 = { enabled: true, sharepoint: true };
    const mockLog = vi.fn();
    render(
      <ActivityLogProvider value={mockLog}>
        <DocumentLinksFieldGated
          value={[{ id: "1", name: "Spec.docx", url: "https://c.sharepoint.com/x", kind: "file" }]}
          onChange={vi.fn()}
          lang="en-US"
        />
      </ActivityLogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove link/i }));
    expect(mockLog).toHaveBeenCalledWith("doc.linkRemoved", "Spec.docx");
  });
});
