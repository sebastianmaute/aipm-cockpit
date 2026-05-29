import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StorageConfigSection } from "./storage-config";
import { t } from "./i18n";

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

function baseProps(overrides: Partial<React.ComponentProps<typeof StorageConfigSection>> = {}): React.ComponentProps<typeof StorageConfigSection> {
  return {
    lang: "en-US",
    config: { kind: "browser" },
    onChange: noop,
    description: null,
    ready: false,
    onPickFile: noopAsync,
    onOpenFile: noopAsync,
    onGrantWrite: noopAsync,
    m365Enabled: false,
    sharepointEnabled: false,
    tursoEnabled: false,
    ...overrides,
  };
}

describe("StorageConfigSection — SharePoint gating", () => {
  beforeEach(() => {
    noop.mockClear();
  });

  it("shows 'enable M365 first' when M365 is OFF and config is sp-json", () => {
    render(
      <StorageConfigSection
        lang="en-US"
        config={{ kind: "sp-json", hostname: "x", sitePath: "/sites/a", itemPath: "f" }}
        onChange={noop}
        m365Enabled={false}
        sharepointEnabled={false}
        tursoEnabled={false}
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
        tursoEnabled={false}
        description={null}
        ready={false}
        onPickFile={noopAsync}
        onOpenFile={noopAsync}
        onGrantWrite={noopAsync}
      />,
    );
    expect(screen.getByText(/sharepoint file url/i)).toBeInTheDocument();
  });

  it("invalid SharePoint URL on blur shows error and does NOT call onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StorageConfigSection
        lang="en-US"
        config={{ kind: "sp-json", hostname: "x.sharepoint.com", sitePath: "/sites/a", itemPath: "f.json" }}
        onChange={onChange}
        m365Enabled={true}
        sharepointEnabled={true}
        tursoEnabled={false}
        description={null}
        ready={false}
        onPickFile={noopAsync}
        onOpenFile={noopAsync}
        onGrantWrite={noopAsync}
      />,
    );
    const input = screen.getByPlaceholderText(/your-tenant.sharepoint.com/i);
    await user.clear(input);
    await user.type(input, "not a url");
    await user.tab();
    expect(screen.getByText(/could not parse/i)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("valid SharePoint URL on blur calls onChange with parsed location", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StorageConfigSection
        lang="en-US"
        config={{ kind: "sp-json", hostname: "old.sharepoint.com", sitePath: "/sites/old", itemPath: "old.json" }}
        onChange={onChange}
        m365Enabled={true}
        sharepointEnabled={true}
        tursoEnabled={false}
        description={null}
        ready={false}
        onPickFile={noopAsync}
        onOpenFile={noopAsync}
        onGrantWrite={noopAsync}
      />,
    );
    const input = screen.getByPlaceholderText(/your-tenant.sharepoint.com/i);
    await user.clear(input);
    await user.type(input, "https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/workspace.json");
    await user.tab();
    expect(onChange).toHaveBeenCalledWith({
      kind: "sp-json",
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Alpha",
      itemPath: "Shared Documents/workspace.json",
    });
  });
});

describe("StorageConfigSection — Turso gating", () => {
  beforeEach(() => {
    noop.mockClear();
  });

  it("Turso option is disabled until tursoEnabled", () => {
    const onChange = vi.fn();
    const { rerender } = render(<StorageConfigSection {...baseProps({ onChange, tursoEnabled: false })} />);
    expect((screen.getByRole("option", { name: t("en-US", "storageTurso") }) as HTMLOptionElement).disabled).toBe(true);
    rerender(<StorageConfigSection {...baseProps({ onChange, tursoEnabled: true })} />);
    expect((screen.getByRole("option", { name: t("en-US", "storageTurso") }) as HTMLOptionElement).disabled).toBe(false);
  });

  it("selecting Turso sets config kind turso", () => {
    const onChange = vi.fn();
    render(<StorageConfigSection {...baseProps({ onChange, tursoEnabled: true })} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "turso" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "turso" });
  });
});
