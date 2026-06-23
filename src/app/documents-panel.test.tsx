import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { DocumentsPanel } from "./documents-panel";
import { SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";
import type { DocumentLink } from "./document-link";
import type { Task } from "./types";

afterEach(() => {
  window.localStorage.clear();
});

/** Persist settings with the M365+SharePoint integration enabled so the gated
 *  "Add document" control renders (useSettings hydrates from localStorage). */
function enableSharePoint() {
  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      ...defaultSettings,
      integrations: { m365: { ...defaultSettings.integrations?.m365, enabled: true, sharepoint: true } },
    }),
  );
}

const LINK: DocumentLink = {
  id: "dl-1",
  name: "Spec.docx",
  url: "https://example.sharepoint.com/Spec.docx",
  kind: "file",
};

function seededTask(documentLinks: DocumentLink[]): Task {
  return {
    id: 7,
    taskName: "Write spec",
    assignee: "Ada",
    assigneeEmail: "ada@example.com",
    dueDate: "2026-07-01",
    lastUpdateDate: "2026-06-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    notes: "",
    documentLinks,
  };
}

/** Seeds workspace state once on mount so the context-driven panel has data. */
function SeedTasks({ tasks }: { tasks: Task[] }) {
  const { setTasks } = useWorkspace();
  useEffect(() => {
    setTasks(tasks);
  }, [setTasks, tasks]);
  return null;
}

/** Surfaces the active tab + pending-open id so the test can assert navigation. */
function TabProbe() {
  const { activeTab, pendingOpen } = useWorkspaceTab();
  return (
    <div data-testid="tab-probe">
      {activeTab}:{pendingOpen ? pendingOpen.id : "none"}
    </div>
  );
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

function renderWithTasks(tasks: Task[]) {
  render(
    <>
      <SeedTasks tasks={tasks} />
      <TabProbe />
      <DocumentsPanel />
    </>,
    { wrapper },
  );
}

describe("DocumentsPanel", () => {
  it("renders the document name and a source button labeled with the task name", () => {
    renderWithTasks([seededTask([LINK])]);
    // Link name (with folder/file glyph + ↗ around it) — match by substring.
    expect(screen.getByText(/Spec\.docx/)).toBeInTheDocument();
    const sourceLabel = `${t("en-US", "documentsSourceTask")}: Write spec`;
    expect(screen.getByRole("button", { name: sourceLabel })).toBeInTheDocument();
  });

  it("removes the row when the ✕ remove button is clicked", () => {
    renderWithTasks([seededTask([LINK])]);
    expect(screen.getByText(/Spec\.docx/)).toBeInTheDocument();
    const remove = screen.getByRole("button", { name: `${t("en-US", "documentsRemove")} – ${LINK.name}` });
    fireEvent.click(remove);
    expect(screen.queryByText(/Spec\.docx/)).not.toBeInTheDocument();
    // Empty state shows once the last link is gone.
    expect(screen.getByText(t("en-US", "documentsTabEmpty"))).toBeInTheDocument();
  });

  it("navigates to the source via requestOpen when the source button is clicked", () => {
    renderWithTasks([seededTask([LINK])]);
    const sourceLabel = `${t("en-US", "documentsSourceTask")}: Write spec`;
    fireEvent.click(screen.getByRole("button", { name: sourceLabel }));
    // requestOpen("open-points", 7) → activeTab=open-points, pendingOpen.id=7
    expect(screen.getByTestId("tab-probe")).toHaveTextContent("open-points:7");
  });

  it("shows the empty-state text when the workspace has no documents", () => {
    renderWithTasks([]);
    expect(screen.getByText(t("en-US", "documentsTabEmpty"))).toBeInTheDocument();
  });

  it("toggles the add panel and lists attach targets when SharePoint is enabled", async () => {
    enableSharePoint();
    renderWithTasks([seededTask([LINK])]);
    // The Add button is gated on the M365+SharePoint integration, which hydrates
    // asynchronously from localStorage — await it rather than reading synchronously.
    const addBtn = await screen.findByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) });
    fireEvent.click(addBtn);
    const select = screen.getByRole("combobox");
    expect(within(select).getByText(`${t("en-US", "documentsSourceTask")}: Write spec`)).toBeInTheDocument();
  });

  it("shows the Add-document button and adds a manual link without SharePoint", () => {
    renderWithTasks([seededTask([])]);
    // Add is now always available (no SharePoint required).
    const addBtn = screen.getByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) });
    fireEvent.click(addBtn);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "task:7" } });
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsManualName")), { target: { value: "Plan" } });
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsManualUrl")), {
      target: { value: "https://example.com/plan.pdf" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "documentsManualAdd") }));
    expect(screen.getByText(/Plan/)).toBeInTheDocument();
  });
});
