import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import type React from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { ActionMenus } from "./action-menus";
import { defaultExportConfig, type ExportConfig } from "./settings-types";
import { EXPORT_WORKSPACE_KEYS, type ExportWorkspaceKey } from "./export-workspace";
import type { Workspace } from "./storage";
import { t } from "./i18n";

// Capture the exportConfig prop ExportMenu receives so we can assert it.
let capturedExportConfig: ExportConfig | undefined;
let capturedExportFooter: string | undefined;
// §463 M3 — the workspace prop ExportMenu is actually handed, captured so a
// test can pin it PER FIELD against the live context (see the describe block
// below), not just the presence of exportConfig/exportFooter.
let capturedWorkspace: Workspace | undefined;
vi.mock("./export-menu", () => ({
  ExportMenu: (props: { exportConfig?: ExportConfig; exportFooter?: string; workspace?: Workspace }) => {
    capturedExportConfig = props.exportConfig;
    capturedExportFooter = props.exportFooter;
    capturedWorkspace = props.workspace;
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

// §463 M3 — `ActionMenus` builds `capturedWorkspace` from `useWorkspace()`
// through `buildExportWorkspace`. A survivor mutant dropped ONE field
// (`calendarEvents: undefined`) with no test noticing, because nothing pinned
// the header path's per-field CONTENT — only that it calls
// `buildExportWorkspace(` (source-text sweep) and that `ExportMenu` re-exports
// whatever `workspace` it is handed unchanged. `Seeder` pushes three distinct,
// non-empty-by-identity sentinel arrays into context via the real setters so a
// dropped/undefined/swapped field is observable; `Probe` records the SAME
// `useWorkspace()` snapshot `ActionMenus` reads, so the assertion below compares
// like-for-like rather than against a hand-built expectation that could itself
// drift from the context shape.
let probeSnapshot: Record<ExportWorkspaceKey, unknown> | undefined;

function Seeder() {
  const { setCalendarEvents, setKnowledgeItems, setInsights } = useWorkspace();
  useEffect(() => {
    setCalendarEvents([]);
    setKnowledgeItems([]);
    setInsights([]);
  }, [setCalendarEvents, setKnowledgeItems, setInsights]);
  return null;
}

function Probe() {
  const ws = useWorkspace() as unknown as Record<ExportWorkspaceKey, unknown>;
  // Recorded in an effect (a side effect), not during render, per
  // react-hooks/globals — re-runs every commit so it always reflects the
  // latest context value by the time an assertion reads it.
  useEffect(() => {
    probeSnapshot = ws;
  });
  return null;
}

describe("ActionMenus", () => {
  it("hands the export footer on to the Export menu", () => {
    // ★ Optional on both components: a dropped hop would print the built-in footer.
    capturedExportFooter = undefined;
    render(
      <ActionMenus lang="en-US" onCommand={vi.fn()} onVoiceError={vi.fn()} exportFooter="Acme GmbH" />,
      { wrapper: Wrapper },
    );
    expect(capturedExportFooter).toBe("Acme GmbH");
  });

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

describe("ActionMenus — header export workspace pins every field (§463 M3)", () => {
  it("hands ExportMenu the SAME per-field values useWorkspace() holds, not a partial rebuild", async () => {
    capturedWorkspace = undefined;
    probeSnapshot = undefined;
    render(
      <>
        <Seeder />
        <Probe />
        <ActionMenus lang="en-US" onCommand={vi.fn()} onVoiceError={vi.fn()} />
      </>,
      { wrapper: Wrapper },
    );

    // Wait for Seeder's effect to land and ActionMenus to re-render with it.
    await waitFor(() => {
      expect(probeSnapshot?.calendarEvents).toEqual([]);
      expect(capturedWorkspace?.calendarEvents).toEqual([]);
    });

    const ws = capturedWorkspace as unknown as Record<ExportWorkspaceKey, unknown>;
    for (const key of EXPORT_WORKSPACE_KEYS) {
      expect(ws[key], key).toBe(probeSnapshot![key]);
    }
    // A field could pass the loop above vacuously if it were undefined on both
    // sides (a dropped slice reads back as undefined === undefined). Pin one
    // seeded field to a real, non-undefined value so that can't happen.
    expect(ws.calendarEvents).toBe(probeSnapshot!.calendarEvents);
    expect(ws.knowledgeItems).toBe(probeSnapshot!.knowledgeItems);
    expect(ws.insights).toBe(probeSnapshot!.insights);
  });
});
