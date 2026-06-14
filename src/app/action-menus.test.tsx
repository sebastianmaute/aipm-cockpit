import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type React from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { ActionMenus } from "./action-menus";
import { defaultExportConfig, type ExportConfig } from "./settings-types";
import { t } from "./i18n";

// Capture the exportConfig prop ExportMenu receives so we can assert it.
let capturedExportConfig: ExportConfig | undefined;
vi.mock("./export-menu", () => ({
  ExportMenu: (props: { exportConfig?: ExportConfig }) => {
    capturedExportConfig = props.exportConfig;
    return null;
  },
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

describe("ActionMenus", () => {
  it("renders the Export, Help, and Version menu triggers", () => {
    capturedExportConfig = undefined;
    render(
      <ActionMenus lang="en-US" onCommand={vi.fn()} onVoiceError={vi.fn()} />,
      { wrapper: Wrapper },
    );
    expect(
      screen.getByRole("button", { name: t("en-US", "help") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("en-US", "version") }),
    ).toBeInTheDocument();
  });

  it("hides the save/apply-template menus unless expert mode is on", () => {
    const { rerender } = render(
      <ActionMenus lang="en-US" onCommand={vi.fn()} onVoiceError={vi.fn()} />,
      { wrapper: Wrapper },
    );
    expect(screen.queryByRole("button", { name: t("en-US", "templateSaveTitle") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "templateApplyTitle") })).toBeNull();

    rerender(
      <Wrapper>
        <ActionMenus lang="en-US" onCommand={vi.fn()} onVoiceError={vi.fn()} expertMode />
      </Wrapper>,
    );
    expect(screen.getByRole("button", { name: t("en-US", "templateSaveTitle") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "templateApplyTitle") })).toBeInTheDocument();
  });

  it("uses defaultExportConfig when no exportConfig prop is supplied", () => {
    capturedExportConfig = undefined;
    render(
      <ActionMenus lang="en-US" onCommand={vi.fn()} onVoiceError={vi.fn()} />,
      { wrapper: Wrapper },
    );
    expect(capturedExportConfig).toEqual(defaultExportConfig);
  });

  it("passes the supplied exportConfig prop through to ExportMenu", () => {
    capturedExportConfig = undefined;
    const customConfig: ExportConfig = { ...defaultExportConfig, milestones: true, stakeholders: true };
    render(
      <ActionMenus
        lang="en-US"
        onCommand={vi.fn()}
        onVoiceError={vi.fn()}
        exportConfig={customConfig}
      />,
      { wrapper: Wrapper },
    );
    // Verify the live config was forwarded unchanged to ExportMenu.
    expect(capturedExportConfig).toEqual(customConfig);
    // Verify the custom toggles are reflected (guards against default fallback).
    expect((capturedExportConfig as ExportConfig | undefined)?.milestones).toBe(true);
    expect((capturedExportConfig as ExportConfig | undefined)?.stakeholders).toBe(true);
  });
});
