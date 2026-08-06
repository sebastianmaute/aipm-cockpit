import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivityLogProvider } from "./activity-log-context";
import { t } from "./i18n";

const acquireToken = vi.fn(async () => "tok");
let mockM365: { enabled: boolean; sharepoint: boolean } | undefined;

vi.mock("./use-settings", () => ({
  useSettings: () => ({ settings: { integrations: { m365: mockM365 } } }),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken }),
}));

import { DocumentLinksGroup, KnowledgeLinksFieldGated } from "./knowledge-links-field-gated";

describe("KnowledgeLinksFieldGated", () => {
  it("shows the needs-SharePoint hint when integration is off", () => {
    mockM365 = { enabled: false, sharepoint: false };
    render(<KnowledgeLinksFieldGated value={[]} onChange={vi.fn()} lang="en-US" />);
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });

  it("shows the needs-SharePoint hint when m365 on but sharepoint off", () => {
    mockM365 = { enabled: true, sharepoint: false };
    render(<KnowledgeLinksFieldGated value={[]} onChange={vi.fn()} lang="en-US" />);
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });

  it("renders the field (Add button) when m365 + sharepoint are on", () => {
    mockM365 = { enabled: true, sharepoint: true };
    render(<KnowledgeLinksFieldGated value={[]} onChange={vi.fn()} lang="en-US" />);
    expect(screen.getByRole("button", { name: /add from sharepoint/i })).toBeInTheDocument();
  });

  it("calls logActivity with doc.linkRemoved when a link is removed inside ActivityLogProvider", () => {
    mockM365 = { enabled: true, sharepoint: true };
    const mockLog = vi.fn();
    render(
      <ActivityLogProvider value={mockLog}>
        <KnowledgeLinksFieldGated
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

describe("DocumentLinksGroup", () => {
  it("names the block role=group so the caption is not a click target", () => {
    // ★★ The four entity editors each repeated this caption + wrapper, and the
    // wrapper is the whole point: with SharePoint ON the field renders a ✕ per
    // link and an Add button and NO input, so a `<label>` would adopt the first
    // ✕ and clicking "Documents" would delete a link.
    mockM365 = { enabled: true, sharepoint: true };
    render(<DocumentLinksGroup value={[]} onChange={vi.fn()} lang="en-US" />);
    const group = screen.getByRole("group", { name: t("en-US", "documents") });
    expect(group).toBeInTheDocument();
    expect(group.tagName).toBe("DIV");
    expect(group.className).toBe("flex flex-col gap-1 text-sm sm:col-span-2");
    expect(document.querySelectorAll("label")).toHaveLength(0);
  });

  it("keeps the gate: renders the hint, still grouped, when SharePoint is off", () => {
    mockM365 = { enabled: false, sharepoint: false };
    render(<DocumentLinksGroup value={[]} onChange={vi.fn()} lang="en-US" className="flex flex-col gap-1 text-sm" />);
    expect(screen.getByRole("group", { name: t("en-US", "documents") })).toBeInTheDocument();
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });
});
