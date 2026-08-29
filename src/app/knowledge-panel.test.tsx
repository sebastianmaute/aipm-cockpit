import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { KnowledgePanel } from "./knowledge-panel";
import { SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";
import type { KnowledgeItem, KnowledgeLink } from "./document-link";
import type { Task } from "./types";
import { expectNoLabelBoundToButton } from "../test/label-binding";

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

const LINK: KnowledgeLink = {
  id: "dl-1",
  name: "Spec.docx",
  url: "https://example.sharepoint.com/Spec.docx",
  kind: "file",
};

function seededTask(knowledgeLinks: KnowledgeLink[]): Task {
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
    description: "",
    knowledgeLinks,
  };
}

function SeedTasks({ tasks }: { tasks: Task[] }) {
  const { setTasks } = useWorkspace();
  useEffect(() => {
    setTasks(tasks);
  }, [setTasks, tasks]);
  return null;
}

function SeedKnowledgeItems({ items }: { items: KnowledgeItem[] }) {
  const { setKnowledgeItems } = useWorkspace();
  useEffect(() => {
    setKnowledgeItems(items);
  }, [setKnowledgeItems, items]);
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
      <KnowledgePanel />
    </>,
    { wrapper },
  );
}

describe("KnowledgePanel", () => {
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

  // ★★ `knowledgeItems` counts toward `workspaceRecordCount`, so a burst of
  // library removes inside ONE save-debounce window reads as a Layer-B mass
  // deletion and the save is REFUSED unless the one-shot bypass was armed.
  // ★★★ THAT WINDOW IS 500ms, NOT A SECOND. This comment used to say an
  // "ordinary click-per-second burst coalesces — this is not a 500ms-reflex
  // edge case", and `SAVE_DEBOUNCE_MS` (debounced-save.ts) refutes it: the
  // debounce is TRAILING at 500ms, so a click at t=0 has already fired its save
  // when a click at t=1000 arrives. Changes must be closer together than 500ms
  // to coalesce — a real but narrower window than the one described.
  // ★ Scoped to the LIBRARY card: the attached-document remove above shares the
  // `documentsRemove` key, so the item name is what keeps the two apart. The
  // string `name` is already a whole-string match in RTL (no `exact` option —
  // passing one fails tsc), and the seeded task carries no links, so nothing
  // else can answer to this name.
  it("arms allowDestructiveSave when a knowledge-library item is removed", () => {
    const allowDestructiveSave = vi.fn();
    const item: KnowledgeItem = { ...LINK, id: "ki-arm-1", name: "Library only.docx" };
    render(
      <>
        <SeedTasks tasks={[seededTask([])]} />
        <SeedKnowledgeItems items={[item]} />
        <KnowledgePanel allowDestructiveSave={allowDestructiveSave} />
      </>,
      { wrapper },
    );
    const remove = screen.getByRole("button", { name: `${t("en-US", "documentsRemove")} – ${item.name}` });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    fireEvent.click(remove);
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Library only\.docx/)).not.toBeInTheDocument();
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
    const raidDoc: KnowledgeLink = { id: "dl-2", name: "Risk.pdf", url: "https://example.com/Risk.pdf", kind: "file" };
    const task = seededTask([LINK]);
    const taskWithRaid: Task = { ...task, raid: undefined } as Task;
    // Two docs from two different sources: one task link, one task link renamed.
    renderWithTasks([{ ...taskWithRaid, knowledgeLinks: [LINK, raidDoc] }]);
    expect(screen.getByText(/Spec\.docx/)).toBeInTheDocument();
    expect(screen.getByText(/Risk\.pdf/)).toBeInTheDocument();
    // The "All" chip is present and pressed by default.
    const allChip = screen.getByRole("button", { name: new RegExp(t("en-US", "documentsFilterAll")) });
    expect(allChip).toHaveAttribute("aria-pressed", "true");
  });

  it("narrows by the search box", () => {
    const second: KnowledgeLink = { id: "dl-2", name: "Risk.pdf", url: "https://example.com/Risk.pdf", kind: "file" };
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

  it("clears the search box via its ✕ and restores the filtered-out cards", () => {
    const second: KnowledgeLink = { id: "dl-2", name: "Risk.pdf", url: "https://example.com/Risk.pdf", kind: "file" };
    renderWithTasks([{ ...seededTask([LINK, second]) }]);
    const field = screen.getByLabelText(t("en-US", "documentsSearchDocs")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "risk" } });
    expect(screen.queryByText(/Spec\.docx/)).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: `${t("en-US", "clear")} – ${t("en-US", "documentsSearchDocs")}`,
      }),
    );
    expect(field.value).toBe("");
    expect(screen.getByText(/Spec\.docx/)).toBeInTheDocument();
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

  it("adds a Confluence-kind link and renders its Confluence type", () => {
    renderWithTasks([seededTask([])]);
    const addBtn = screen.getAllByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) })[0];
    fireEvent.click(addBtn);
    fireEvent.change(screen.getByRole("combobox", { name: t("en-US", "documentsTarget") }), { target: { value: "task:7" } });
    fireEvent.change(screen.getByRole("combobox", { name: t("en-US", "documentsManualKind") }), {
      target: { value: "confluence" },
    });
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsManualName")), { target: { value: "Runbook" } });
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsManualUrl")), {
      target: { value: "https://acme.atlassian.net/wiki/spaces/OPS/pages/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "documentsManualAdd") }));
    expect(screen.getByText(/Runbook/)).toBeInTheDocument();
    // The card renders the Confluence type icon (link kind wins over the URL heuristic).
    expect(screen.getByText("🔷")).toBeInTheDocument();
    // Type label + host badge both read "Confluence".
    expect(screen.getAllByText(t("en-US", "documentsTypeConfluence")).length).toBeGreaterThanOrEqual(1);
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

  it("defaults the target to Standalone so the manual-add row is immediately available", () => {
    renderWithTasks([seededTask([])]);
    const addBtn = screen.getAllByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) })[0];
    fireEvent.click(addBtn);
    const target = screen.getByRole("combobox", { name: t("en-US", "documentsTarget") }) as HTMLSelectElement;
    expect(target.value).toBe("__standalone__");
    expect(screen.getByLabelText(t("en-US", "documentsManualName"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(screen.queryByRole("combobox", { name: t("en-US", "documentsTarget") })).toBeNull();
  });

  // ★ Source scans, deliberately: jsdom reports every rect as zero, so neither
  // a collapsed field nor a too-narrow card is observable from a render.
  it("gives the standalone add-form linked-tasks field a flex basis so it cannot collapse", () => {
    const src = readFileSync(join(__dirname, "knowledge-panel.tsx"), "utf8");
    // The field sits in a `flex flex-wrap items-end` row where every sibling
    // declares a basis; without one it shrinks to content width.
    expect(src).toMatch(/flex flex-1 min-w-\[16rem\] flex-col gap-1 text-xs text-foreground/);
  });

  // ★★★ Both linked-tasks pickers render CHIPS (each with an unlink ×) ABOVE
  // their search box, so a `<label>` wrapper adopts the first chip's × as its
  // labeled control: hovering the caption paints that ×, and clicking the
  // caption UNLINKS the task. Neither picker is reachable from an axe-scanned
  // view, so these two tests are the only coverage. See src/test/label-binding.
  // ★ A picker with nothing linked renders "—" and then the input, so the
  // defect does not exist yet — both tests must put a chip on screen first or
  // they pass against the unfixed code.
  it("does not bind the library card's linked-tasks caption to a chip's unlink button", () => {
    const item: KnowledgeItem = { ...LINK, id: "ki-1", taskIds: [7] };
    render(
      <>
        <SeedTasks tasks={[seededTask([])]} />
        <SeedKnowledgeItems items={[item]} />
        <KnowledgePanel />
      </>,
      { wrapper },
    );
    // Proves the chip is on screen — without it the assertion is vacuous.
    expect(
      screen.getByRole("button", { name: new RegExp(`${t("en-US", "taskUnlink")} #7`) }),
    ).toBeInTheDocument();
    expectNoLabelBoundToButton();
  });

  it("does not bind the standalone add-form's linked-tasks caption to a chip's unlink button", () => {
    renderWithTasks([seededTask([])]);
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) })[0]);
    // Target defaults to Standalone, so the linked-tasks picker is present.
    const search = screen.getByRole("combobox", { name: t("en-US", "knowledgeLinkedTasks") });
    fireEvent.change(search, { target: { value: "Write spec" } });
    // Scoped to the picker's listbox: the target `<select>` also holds an
    // `<option>` named "Write spec" (a native option has role="option" too).
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: /Write spec/ }));
    expect(
      screen.getByRole("button", { name: new RegExp(`${t("en-US", "taskUnlink")} #7`) }),
    ).toBeInTheDocument();
    expectNoLabelBoundToButton();
  });

  // ★★★ THE CALL SITE, which no behavioural test here can reach. Every case
  // above renders `KnowledgePanel` directly and supplies the prop itself, so
  // dropping it in workspace-section.tsx is invisible to all of them — the same
  // structural blind spot workspace-panels.documents.test.tsx exists for on the
  // Documents side. That file can mount its wrapper; this one cannot, because
  // `workspace-section.tsx` needs the whole app's prop surface to render. A
  // SOURCE assertion is the honest remaining option, and it is deliberately
  // narrow: it proves the prop is passed, not that the value is right.
  it("is handed the destructive-save bypass by its call site in workspace-section", () => {
    const src = readFileSync(join(__dirname, "workspace-section.tsx"), "utf8");
    expect(src).toMatch(/<KnowledgePanel allowDestructiveSave=\{allowDestructiveSave\} \/>/);
  });

  it("does not pack knowledge-library cards three-up before xl", () => {
    const src = readFileSync(join(__dirname, "knowledge-panel.tsx"), "utf8");
    // Scoped to the LIBRARY section: those cards carry a linked-tasks picker
    // whose chips overflow a 3-column card. The attached-document grid below
    // has no chips and deliberately keeps its lg breakpoint.
    const library = src.slice(src.indexOf("knowledgeLibraryHeading"));
    const grid = library.slice(0, library.indexOf("</div>"));
    expect(grid).toMatch(/grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3/);
    expect(grid).not.toMatch(/lg:grid-cols-3/);
  });

  it("keeps the Standalone default after Cancel and reopen", () => {
    renderWithTasks([seededTask([])]);
    const openAdd = () => fireEvent.click(screen.getAllByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) })[0]);
    openAdd();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    openAdd();
    const target = screen.getByRole("combobox", { name: t("en-US", "documentsTarget") }) as HTMLSelectElement;
    expect(target.value).toBe("__standalone__");
  });

  describe("toolbar", () => {
    it("shows the toolbar even when there is nothing in the library yet", () => {
      renderWithTasks([]);
      expect(screen.getByRole("button", { name: t("en-US", "printHint") })).toBeTruthy();
      expect(screen.getByRole("button", { name: t("en-US", "tableResetSizeHint") })).toBeTruthy();
    });

    it("keeps the toolbar outside the scrolling region", () => {
      // POPULATED on purpose. With an empty library the panel takes the
      // AddFirstItemButton branch and renders no `.overflow-auto` scroller at
      // all, so `closest(".overflow-auto")` is null however the toolbar is
      // nested — the assertion held for the wrong reason and could not observe
      // the hoist it is named for. A seeded item makes the scroller exist.
      renderWithTasks([seededTask([LINK])]);
      expect(document.querySelector(".overflow-auto")).not.toBeNull();
      const print = screen.getByRole("button", { name: t("en-US", "printHint") });
      expect(print.closest(".overflow-auto")).toBeNull();
    });
  });
});
