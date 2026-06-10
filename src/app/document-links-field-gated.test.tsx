import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
});
