// Pins the template-apply notice WIRING in task-manager.tsx (spec Part 2,
// pre-flight I4). The REAL handleApplyTemplate runs, captured from the deps
// task-manager hands buildShellChrome, and the assertions read the toast the
// real AppModals renders. Which rows count is ALSO pinned purely by the
// templateSeedEmailScope test; this file pins that the handler uses it.
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { t } from "./i18n";
import { ALL_MODULE_IDS } from "./feature-modules";

const chrome = vi.hoisted(() => ({ apply: null as null | ((id: string, opts: { includeSeed: boolean }) => void) }));

vi.mock("./shell-chrome", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./shell-chrome")>();
  return {
    ...actual,
    buildShellChrome: (deps: Parameters<typeof actual.buildShellChrome>[0]) => {
      chrome.apply = deps.handleApplyTemplate;
      return actual.buildShellChrome(deps);
    },
  };
});

vi.mock("./workspace-section", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workspace-section")>();
  const { useWorkspace } = await import("./workspace-context");
  return {
    ...actual,
    WorkspaceSection: () => {
      const { tasks } = useWorkspace();
      return <div data-testid="ws-section-mock" data-task-count={tasks.length} />;
    },
  };
});

import TaskManager from "./task-manager";

const SEEDED_TASK = { id: 1, taskName: "Seeded", assignee: "B", assigneeEmail: "a,b@x.com", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do", createdDate: "2026-06-01" };
// ★ `features` MUST keep every module on. The handler applies the template's
//   features to the project, and `features: []` switches the dashboard module
//   off, so `disabledViewRedirect` moves the modern shell to Open Points, which
//   renders through `tasksSection` rather than WorkspaceSection. The mock below
//   then UNMOUNTS on apply. Measured: `[]` gives mounted-before and gone-after
//   with the view on #open-points; all modules keep it on #dashboard. That is
//   intended simple-mode behaviour, not a mount delay.
const TEMPLATE = { id: "tpl-unsafe-email", name: "Unsafe email", features: [...ALL_MODULE_IDS], fieldVisibility: {}, seed: { tasks: [SEEDED_TASK] } };

async function mount() {
  window.localStorage.clear();
  chrome.apply = null;
  window.localStorage.setItem("aipm-cockpit:projects", JSON.stringify({
    projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
    currentProjectId: "p1",
  }));
  window.localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ templates: [TEMPLATE] }));
  window.history.replaceState(null, "", "/");
  render(<TaskManager />);
  await screen.findByTestId("ws-section-mock");
  // ★★★ WAIT FOR THE FIRST BACKEND LOAD TO LAND, not just for the mock to
  // mount. use-storage-backend.ts's load effect calls
  // applyWorkspace(workspace, "reset", "merge") once it resolves, which
  // REPLACES tasks with whatever was in browser storage -- empty, on the
  // freshly-cleared localStorage this test seeds. `ws-section-mock` renders
  // unconditionally on mount, before that load effect has necessarily
  // finished, so a template apply issued right after `mount()` returns can
  // land BEFORE the load and then get silently wiped when the load lands
  // after it: apply sets tasks to [seed], the load resets to [], and a
  // second apply re-mints the same id, so the count never exceeds 1 no
  // matter how long a caller waits on it. THIS IS A PRODUCT DEFECT, not just
  // a test race -- filed as **§548** in docs/open-followups.md (an edit made
  // during a project's first backend load is silently overwritten when that
  // load lands); this test merely raced the same window. Instrumented
  // locally (M-4, final-review-report.md; the capture itself lived in a
  // gitignored scratch file and is not checked in -- the numbers are
  // recorded here instead): without this wait, the apply → reset → re-mint
  // sequence above raced 3 of 13 local runs; with it, 8 of 8. No waitFor
  // timeout on the taskCount assertions below could ever have fixed it,
  // since the count settles at a wrong value rather than merely arriving
  // late. `storage.loaded` is the product's own diag-log marker for "the
  // load effect ran" (`logDiag("info", "storage.loaded", ...)` in
  // use-storage-backend.ts's load effect, written into
  // localStorage["aipm-cockpit:diag-log"]); 15000ms because the load is a
  // real IndexedDB/localStorage read, not a synchronous re-render -- the
  // timeouts removed from the taskCount waits below are unrelated and stay
  // at the default now that they no longer have a race to paper over.
  // ★ §548 CLOSED the product window this comment describes: the main window now renders PanelSkeleton
  //   until the load settles, so `findByTestId("ws-section-mock")` above already implies it. The wait is
  //   kept as a second, independent pin on the same fact.
  await waitFor(
    () =>
      expect(window.localStorage.getItem("aipm-cockpit:diag-log") ?? "").toContain("storage.loaded"),
    { timeout: 15000 },
  );
}

const taskCount = () => screen.getByTestId("ws-section-mock").getAttribute("data-task-count");

beforeEach(() => { __resetMintStateForTests(); });
afterEach(() => { window.history.replaceState(null, "", "/"); });

describe("handleApplyTemplate — the unsafe-email notice (spec Part 2, pre-flight I4)", () => {
  it("positive control: applying WITHOUT the seed shows the applied toast and no notice", async () => {
    await mount();
    act(() => chrome.apply!("tpl-unsafe-email", { includeSeed: false }));
    expect(await screen.findByText(t("en-US", "templateApplied"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "importUnsafeEmailsNotice", 1, "Seeded"))).toBeNull();
    expect(taskCount()).toBe("0");
  }, 45000);

  it("names only the rows the template brought in: a second apply announces ONE record, not two", async () => {
    await mount();
    act(() => chrome.apply!("tpl-unsafe-email", { includeSeed: true }));
    await waitFor(() => expect(taskCount()).toBe("1"));
    expect(await screen.findByText(t("en-US", "importUnsafeEmailsNotice", 1, "Seeded"))).toBeInTheDocument();

    act(() => chrome.apply!("tpl-unsafe-email", { includeSeed: true }));
    await waitFor(() => expect(taskCount()).toBe("2")); // control: the second seed landed beside the first
    expect(screen.getByText(t("en-US", "importUnsafeEmailsNotice", 1, "Seeded"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "importUnsafeEmailsNotice", 2, "Seeded, Seeded"))).toBeNull();
  }, 45000);
});
