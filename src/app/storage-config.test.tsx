import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StorageConfigSection } from "./storage-config";

vi.mock("./use-ms-auth", () => ({
  useMsAuth: (enabled: boolean) => ({
    account: enabled ? { username: "x@y.com" } : null,
    ready: enabled,
    signIn: vi.fn(),
    signOut: vi.fn(),
    acquireToken: async () => (enabled ? "t" : null),
  }),
}));

const noop = vi.fn();
const noopAsync = async () => {};

describe("StorageConfigSection — SharePoint gating", () => {
  it("shows 'enable M365 first' when M365 is OFF and config is sp-json", () => {
    render(
      <StorageConfigSection
        lang="en-US"
        config={{ kind: "sp-json", hostname: "x", sitePath: "/sites/a", itemPath: "f" }}
        onChange={noop}
        m365Enabled={false}
        sharepointEnabled={false}
        description={null}
        ready={false}
        onPickFile={noopAsync}
        onOpenFile={noopAsync}
        onGrantWrite={noopAsync}
      />,
    );
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });

  it("shows URL input when M365 + SharePoint enabled AND signed in", () => {
    render(
      <StorageConfigSection
        lang="en-US"
        config={{ kind: "sp-json", hostname: "x.sharepoint.com", sitePath: "/sites/a", itemPath: "f.json" }}
        onChange={noop}
        m365Enabled={true}
        sharepointEnabled={true}
        description={null}
        ready={false}
        onPickFile={noopAsync}
        onOpenFile={noopAsync}
        onGrantWrite={noopAsync}
      />,
    );
    expect(screen.getByText(/sharepoint file url/i)).toBeInTheDocument();
  });
});
