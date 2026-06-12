import {
  render as rtlRender,
  screen,
  fireEvent,
  type RenderOptions,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsMenu } from "./settings-menu";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { defaultSettings } from "./settings-types";

// SettingsMenu embeds TemplatesSection, which reads the live workspace
// (useCurrentWorkspace), so every render needs the workspace providers.
function Providers({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}
function render(ui: ReactElement, options?: RenderOptions) {
  return rtlRender(ui, { wrapper: Providers, ...options });
}

const asyncNoop = async () => {};

describe("SettingsMenu layout control", () => {
  it("calls onChange with the chosen layout", () => {
    const onChange = vi.fn();
    render(
      <SettingsMenu
        settings={{ ...defaultSettings, layout: "modern" }}
        onChange={onChange}
        storageDescription={null}
        storageReady
        onPickStorageFile={asyncNoop}
        onOpenStorageFile={asyncNoop}
        onGrantStorageWrite={asyncNoop}
        onRequestStorageSwitch={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Classic" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ layout: "classic" }));
  });

  it("shows the panel when controlled open=true without clicking the trigger", () => {
    render(
      <SettingsMenu
        settings={defaultSettings}
        onChange={() => {}}
        storageDescription={null}
        storageReady
        onPickStorageFile={asyncNoop}
        onOpenStorageFile={asyncNoop}
        onGrantStorageWrite={asyncNoop}
        onRequestStorageSwitch={() => {}}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: "Classic" })).toBeInTheDocument();
  });

  it("hides the panel when controlled open=false", () => {
    render(
      <SettingsMenu
        settings={defaultSettings}
        onChange={() => {}}
        storageDescription={null}
        storageReady
        onPickStorageFile={asyncNoop}
        onOpenStorageFile={asyncNoop}
        onGrantStorageWrite={asyncNoop}
        onRequestStorageSwitch={() => {}}
        open={false}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.queryByRole("radio", { name: "Classic" })).not.toBeInTheDocument();
  });
});
