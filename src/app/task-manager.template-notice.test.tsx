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
    // ★ Explicit timeout, below the test's own 45000 ms: waitFor's default is
    // 1000 ms, and a slow CI runner can take longer than that to render the
    // second template apply, timing this out under load while the test's
    // own budget still has room (MR !492 pipeline 7013, unit-tests-shuffled
    // seed 1: failed here at line 83 with "expected '1' to be '2'"; the
    // retry at the same seed passed).
    await waitFor(() => expect(taskCount()).toBe("1"), { timeout: 15000 });
    expect(await screen.findByText(t("en-US", "importUnsafeEmailsNotice", 1, "Seeded"))).toBeInTheDocument();

    act(() => chrome.apply!("tpl-unsafe-email", { includeSeed: true }));
    await waitFor(() => expect(taskCount()).toBe("2"), { timeout: 15000 }); // control: the second seed landed beside the first
    expect(screen.getByText(t("en-US", "importUnsafeEmailsNotice", 1, "Seeded"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "importUnsafeEmailsNotice", 2, "Seeded, Seeded"))).toBeNull();
  }, 45000);
});
