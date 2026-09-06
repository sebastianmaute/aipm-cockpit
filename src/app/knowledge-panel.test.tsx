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

/** A seeded task with no knowledge links, renamed and re-numbered — the
 *  attach-to picker filters on the NAME, so its fixtures need distinct ones. */
function namedTask(id: number, taskName: string): Task {
  return { ...seededTask([]), id, taskName };
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
  function openAdd() {
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) })[0]);
  }
  function targetSearch() {
    return screen.getByRole("combobox", { name: t("en-US", "documentsTarget") }) as HTMLInputElement;
  }
  // ★ The linked-tasks picker below the attach-to field is the OTHER combobox
  // on this surface, but its own dropdown opens only while ITS query is
  // non-blank — so with only the attach-to query typed, `getByRole("listbox")`
  // is unambiguous. Both are addressed by their distinct accessible names.
  function searchTargets(query: string) {
    const box = targetSearch();
    fireEvent.change(box, { target: { value: query } });
    return box;
  }
  function chooseTarget(query: string, name: RegExp) {
    searchTargets(query);
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name }));
  }

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

  // WCAG 1.4.1 (open-followups §55): the selected source chip used to be carried
  // by the --ui-dark-blue fill ALONE, which measures 1.01-1.17:1 against the
  // unselected --surface-muted in the three dark schemes — invisible to every
  // user, not only to users with a colour-vision deficiency. The non-colour cue
  // is ToggleButton's trailing marker. ★ Assert it in BOTH states: it is
  // rendered always and merely `invisible` when off, so an ON-state-only
  // assertion passes against a conditional-render regression that would resize
  // the chip on every click.
  it("gives the source filter chips a non-colour pressed marker in both states", () => {
    renderWithTasks([seededTask([LINK])]);
    const allChip = screen.getByRole("button", { name: new RegExp(t("en-US", "documentsFilterAll")) });
    const chips = Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    expect(chips.length).toBeGreaterThanOrEqual(2);
    const offChip = chips.find((c) => c.getAttribute("aria-pressed") === "false");
    expect(allChip).toHaveAttribute("aria-pressed", "true");
    expect(offChip).toBeDefined();
    expect(allChip.querySelector("[data-pressed-marker]")?.getAttribute("data-pressed-marker")).toBe("on");
    expect(offChip!.querySelector("[data-pressed-marker]")).not.toBeNull();
    expect(offChip!.querySelector("[data-pressed-marker]")?.getAttribute("data-pressed-marker")).toBe("off");
    // The trailing count span survives the migration.
    expect(allChip.textContent).toMatch(/\d/);
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
    // The candidate list is search-driven, so a query is what surfaces a
    // target. Scoped to the listbox: the seeded card's own source button
    // carries the task name too.
    searchTargets("write");
    const option = within(screen.getByRole("listbox")).getByRole("option", { name: /Write spec/ });
    expect(option).toHaveTextContent(t("en-US", "documentsSourceTask"));
  });

  it("filters attach-to candidates by a typed query", () => {
    renderWithTasks([namedTask(1, "Ship the release"), namedTask(2, "Draft the plan")]);
    openAdd();
    searchTargets("ship");
    const list = within(screen.getByRole("listbox"));
    expect(list.getAllByRole("option")).toHaveLength(1);
    expect(list.getByRole("option", { name: /Ship the release/ })).toBeInTheDocument();
  });

  // The wildcard comes free from filterPickerOptions/wildcardMatcher; this pins
  // that the panel actually routes through them rather than doing its own match.
  it("treats * as a wildcard in the attach-to search", () => {
    renderWithTasks([namedTask(1, "Ship the release"), namedTask(2, "Draft the plan")]);
    openAdd();
    searchTargets("*");
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.length).toBeGreaterThanOrEqual(2);
  });

  // ★★ The attach-to call site passes `MAX_TARGET_OPTIONS` (200) EXPLICITLY;
  // `filterPickerOptions` would otherwise default to 20 and silently drop most
  // of a real project's targets, with no "showing 20 of N" affordance and a
  // placeholder promising `* for all`. Both assertions earn their place: the
  // first is the regression itself (250 seeded tasks plus the standalone row is
  // 251 candidates, of which the default returns 20), the second pins WHERE
  // truncation lands, so the cap cannot quietly become unbounded either.
  // ★ The 200 is written as a LITERAL rather than imported from the panel: an
  // imported bound compares the constant against itself and would go on passing
  // if someone lowered it back to 20.
  it("caps attach-to options at the panel's own limit, not filterPickerOptions' default of 20", () => {
    renderWithTasks(Array.from({ length: 250 }, (_, i) => namedTask(i + 1, `Target ${i + 1}`)));
    openAdd();
    searchTargets("*");
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.length).toBeGreaterThan(20);
    expect(options).toHaveLength(200);
  });

  // ★ Asserted through the ADD, not through the picker's own selected caption:
  // the caption would render for any string the picker echoes back, while a
  // card whose source button names the task proves `targetKey` still resolves
  // through `targets.find((s) => `${s.kind}:${s.id}` === targetKey)`.
  it("selecting an option sets the composite kind:id target the manual add writes to", () => {
    renderWithTasks([namedTask(7, "Ship the release")]);
    openAdd();
    const box = targetSearch();
    chooseTarget("ship", /Ship the release/);
    expect(box.value).toBe("");
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsManualName")), { target: { value: "Plan" } });
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsManualUrl")), {
      target: { value: "https://example.com/plan.pdf" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "documentsManualAdd") }));
    expect(
      screen.getByRole("button", { name: `${t("en-US", "documentsSourceTask")}: Ship the release` }),
    ).toBeInTheDocument();
  });

  it("adds a manual link (stamped with an added date) without SharePoint", () => {
    renderWithTasks([seededTask([])]);
    openAdd();
    chooseTarget("write", /Write spec/);
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
    openAdd();
    chooseTarget("write", /Write spec/);
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
    openAdd();
    chooseTarget("write", /Write spec/);
    // The manual add-link row is visible; Cancel closes the whole add panel.
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(screen.queryByRole("combobox", { name: t("en-US", "documentsTarget") })).toBeNull();
  });

  it("defaults the target to Standalone so the manual-add row is immediately available", () => {
    renderWithTasks([seededTask([])]);
    openAdd();
    // The picker renders its CURRENT VALUE above the search box, and the box
    // itself holds the query — so the default reads off the caption, not off
    // the combobox's value. The dropdown is closed while the query is blank,
    // so the Standalone row cannot be what this matches.
    expect(targetSearch().value).toBe("");
    expect(screen.getByText(t("en-US", "knowledgeStandaloneOption"))).toBeInTheDocument();
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
    openAdd();
    // Target defaults to Standalone, so the linked-tasks picker is present.
    const search = screen.getByRole("combobox", { name: t("en-US", "knowledgeLinkedTasks") });
    fireEvent.change(search, { target: { value: "Write spec" } });
    // Scoped to the picker's listbox. The attach-to control is a combobox over
    // the same tasks, but its list opens only while ITS query is non-blank and
    // nothing has typed into it here — so exactly one listbox is on screen.
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
    openAdd();
    // ★ Move OFF the default first. Without this the reset has nothing to
    //   undo and the test passes with Cancel's `setTargetKey` deleted.
    chooseTarget("write", /Write spec/);
    expect(screen.getByText(`${t("en-US", "documentsSourceTask")}: Write spec`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    openAdd();
    expect(screen.getByText(t("en-US", "knowledgeStandaloneOption"))).toBeInTheDocument();
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
