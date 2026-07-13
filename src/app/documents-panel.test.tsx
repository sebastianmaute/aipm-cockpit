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

function SeedTasks({ tasks }: { tasks: Task[] }) {
  const { setTasks } = useWorkspace();
  useEffect(() => {
    setTasks(tasks);
  }, [setTasks, tasks]);
  return null;
}

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
  it("renders a card with the document name and a source button labeled by the task", () => {
    renderWithTasks([seededTask([LINK])]);
    expect(screen.getByText(/Spec\.docx/)).toBeInTheDocument();
    const sourceLabel = `${t("en-US", "documentsSourceTask")}: Write spec`;
    expect(screen.getByRole("button", { name: sourceLabel })).toBeInTheDocument();
  });

  it("removes the card when the ✕ remove button is clicked", () => {
    renderWithTasks([seededTask([LINK])]);
    const remove = screen.getByRole("button", { name: `${t("en-US", "documentsRemove")} – ${LINK.name}` });
    fireEvent.click(remove);
    expect(screen.queryByText(/Spec\.docx/)).not.toBeInTheDocument();
    expect(screen.getByText(t("en-US", "documentsTabEmpty"))).toBeInTheDocument();
  });

  it("navigates to the source via requestOpen when the source button is clicked", () => {
    renderWithTasks([seededTask([LINK])]);
    const sourceLabel = `${t("en-US", "documentsSourceTask")}: Write spec`;
    fireEvent.click(screen.getByRole("button", { name: sourceLabel }));
    expect(screen.getByTestId("tab-probe")).toHaveTextContent("open-points:7");
  });

  it("shows the empty-state text when the workspace has no documents", () => {
    renderWithTasks([]);
    expect(screen.getByText(t("en-US", "documentsTabEmpty"))).toBeInTheDocument();
  });

  it("filters the grid when a source chip is selected", () => {
    const raidDoc: DocumentLink = { id: "dl-2", name: "Risk.pdf", url: "https://example.com/Risk.pdf", kind: "file" };
    const task = seededTask([LINK]);
    const taskWithRaid: Task = { ...task, raid: undefined } as Task;
    // Two docs from two different sources: one task link, one task link renamed.
    renderWithTasks([{ ...taskWithRaid, documentLinks: [LINK, raidDoc] }]);
    expect(screen.getByText(/Spec\.docx/)).toBeInTheDocument();
    expect(screen.getByText(/Risk\.pdf/)).toBeInTheDocument();
    // The "All" chip is present and pressed by default.
    const allChip = screen.getByRole("button", { name: new RegExp(t("en-US", "documentsFilterAll")) });
    expect(allChip).toHaveAttribute("aria-pressed", "true");
  });

  it("narrows by the search box", () => {
    const second: DocumentLink = { id: "dl-2", name: "Risk.pdf", url: "https://example.com/Risk.pdf", kind: "file" };
    renderWithTasks([{ ...seededTask([LINK, second]) }]);
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsSearchDocs")), { target: { value: "risk" } });
    expect(screen.queryByText(/Spec\.docx/)).not.toBeInTheDocument();
    expect(screen.getByText(/Risk\.pdf/)).toBeInTheDocument();
  });

  it("shows the no-match text when search excludes everything", () => {
    renderWithTasks([seededTask([LINK])]);
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsSearchDocs")), { target: { value: "zzz" } });
    expect(screen.getByText(t("en-US", "documentsNoneForSource"))).toBeInTheDocument();
  });

  it("renders the derived host badge and file type", () => {
    renderWithTasks([seededTask([LINK])]);
    expect(screen.getByText("SharePoint")).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "documentsTypeWord"))).toBeInTheDocument();
  });

  it("toggles the add panel and lists attach targets when SharePoint is enabled", async () => {
    enableSharePoint();
    renderWithTasks([seededTask([LINK])]);
    const addBtn = await screen.findByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) });
    fireEvent.click(addBtn);
    const select = screen.getByRole("combobox", { name: t("en-US", "documentsTarget") });
    expect(within(select).getByText(`${t("en-US", "documentsSourceTask")}: Write spec`)).toBeInTheDocument();
  });

  it("adds a manual link (stamped with an added date) without SharePoint", () => {
    renderWithTasks([seededTask([])]);
    const addBtn = screen.getAllByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) })[0];
    fireEvent.click(addBtn);
    fireEvent.change(screen.getByRole("combobox", { name: t("en-US", "documentsTarget") }), { target: { value: "task:7" } });
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsManualName")), { target: { value: "Plan" } });
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsManualUrl")), {
      target: { value: "https://example.com/plan.pdf" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "documentsManualAdd") }));
    expect(screen.getByText(/Plan/)).toBeInTheDocument();
    // Stamped addedAt renders an "Added …" line on the new card.
    expect(screen.getByText(new RegExp(t("en-US", "documentsAdded", ".*")))).toBeInTheDocument();
  });

  it("closes the add panel when Cancel is clicked next to Add link", () => {
    renderWithTasks([seededTask([])]);
    const addBtn = screen.getAllByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) })[0];
    fireEvent.click(addBtn);
    fireEvent.change(screen.getByRole("combobox", { name: t("en-US", "documentsTarget") }), { target: { value: "task:7" } });
    // The manual add-link row is visible; Cancel closes the whole add panel.
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(screen.queryByRole("combobox", { name: t("en-US", "documentsTarget") })).toBeNull();
  });

  it("Cancel is reachable and closes the add panel before any target is chosen", () => {
    // The empty-project first-use flow: open Add, then back out without picking a
    // target. Cancel must exist independent of the target-gated manual-link row.
    renderWithTasks([seededTask([])]);
    const addBtn = screen.getAllByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) })[0];
    fireEvent.click(addBtn);
    expect(screen.getByRole("combobox", { name: t("en-US", "documentsTarget") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(screen.queryByRole("combobox", { name: t("en-US", "documentsTarget") })).toBeNull();
  });
});
