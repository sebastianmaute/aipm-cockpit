// ★ Wiring guard for the export footer on the Export menu. `exportFooter` is an
//   optional prop on ActionMenus and ExportMenu, so a top bar that stopped
//   passing it would bring back the built-in footer with tsc and every leaf test
//   green. BOTH top bars are built here — the modern `topBarMenus` and the
//   classic `appHeaderEl` (AppHeader) — because a control wired into one is
//   invisible in the other (AGENTS.md "Top bar in TWO independent places").
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type React from "react";

const seen = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./action-menus", () => ({
  ActionMenus: (p: Record<string, unknown>) => {
    seen.props.push(p);
    return null;
  },
}));

import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { buildShellChrome, type ShellChromeDeps } from "./shell-chrome";
import { defaultSettings } from "./settings-types";
import { DEFAULT_EXPORT_FOOTER } from "./export-footer";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

function deps(settings: ShellChromeDeps["settings"]): ShellChromeDeps {
  return {
    handleCancelEdit: vi.fn(), setTaskModalOpen: vi.fn(), showToast: vi.fn(), handleCommand: vi.fn(),
    storageDescription: null, storageOk: true,
    onPickStorageFile: vi.fn().mockResolvedValue(undefined), onOpenStorageFile: vi.fn().mockResolvedValue(undefined),
    onGrantWriteAccess: vi.fn().mockResolvedValue(undefined), onRequestStorageSwitch: vi.fn(),
    setSettings: vi.fn(), settings, additionalTimezones: [], projectSwitcher: undefined, lang: "en-US",
    activeTab: "dashboard", nowCount: 0, setActiveTab: vi.fn(), migrateCurrentProjectToTurso: vi.fn(),
    openPopoutWindow: vi.fn(), requestChat: vi.fn(), projectTemplates: [], handleSaveTemplate: vi.fn(),
    handleApplyTemplate: vi.fn(), undoControl: null,
  };
}

describe("both top bars hand the Export menu the configured footer", () => {
  it.each(["topBarMenus", "appHeaderEl"] as const)("%s", (which) => {
    seen.props.length = 0;
    const built = buildShellChrome(deps({ ...defaultSettings, branding: { exportFooter: "Acme GmbH" } }));
    render(<>{built[which]}</>, { wrapper: Wrapper });
    expect(seen.props.length).toBeGreaterThan(0);
    expect(seen.props.at(-1)!.exportFooter).toBe("Acme GmbH");
  });

  it("hands over the built-in footer when none is configured", () => {
    seen.props.length = 0;
    render(<>{buildShellChrome(deps(defaultSettings)).topBarMenus}</>, { wrapper: Wrapper });
    expect(seen.props.at(-1)!.exportFooter).toBe(DEFAULT_EXPORT_FOOTER);
  });
});
