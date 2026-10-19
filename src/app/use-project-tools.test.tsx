// §715 — Claude's `update_project` writes through the project form's writer (`handleUpdateCurrentProjectByMode`),
// reached through `ChatDispatcherArgs.projectWriterRef`. A failed write, a project switch during the write and a
// read-only window each reject with a message the model can relay, and none of them changes the record.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { entityToken } from "./ai-entity-token";
import { applyProposal } from "./chat-proposal-apply";
import { describeProposal } from "./chat-proposal-describe";
import type { ProposedCall } from "./chat-proposal";
import { runTool } from "./chat-tools";
import { t } from "./i18n";
import { defaultSettings } from "./settings-types";
import type { ProjectMeta } from "./types";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { emptyWorkspace, type Workspace } from "./workspace";
import { useWorkspace } from "./workspace-context";

const STORED: ProjectMeta = {
  name: "Apollo",
  code: "AP-1",
  description: "Moon programme",
  projectManager: "Pat",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "Acme",
  naceSection: "C",
  identityTypes: ["B2B"],
  products: "Rockets",
  deployment: "Cloud",
  startDate: "2030-03-01",
  endDate: "2030-12-31",
  profitCenter: "PC1",
  contactPersons: [],
  regulatory: [],
  knowledgeLinks: [],
};
const NEXT: ProjectMeta = { ...STORED, customer: "Globex" };
const SAVE_FAILED = "The project could not be saved; nothing was changed.";
const SCOPE_MOVED = "The open project changed while this update was being saved; reopen that project to check what was stored.";
const READ_ONLY = t(defaultSettings.language, "popoutReadOnly");

type Writer = (meta: ProjectMeta) => Promise<boolean>;

function mount(opts: { writer?: Writer; isReadOnly?: boolean; epoch?: { value: number } } = {}) {
  const writer = vi.fn<Writer>(opts.writer ?? (async () => true));
  const projectWriterRef = { current: writer as Writer | null };
  const epoch = opts.epoch ?? { value: 0 };
  const logActivityAs = vi.fn();
  const captureComposite = vi.fn();
  const view = renderHook(
    () => ({
      dispatcher: useChatDispatcher(makeDispatcherArgs({
        isReadOnly: opts.isReadOnly ?? false,
        logActivityAs,
        undo: { captureComposite },
        projectWriterRef,
        getScopeEpoch: () => epoch.value,
      })),
      ws: useWorkspace(),
    }),
    { wrapper: dispatcherWrapperWith({ project: STORED }) },
  );
  return { ...view, writer, logActivityAs, captureComposite, epoch };
}

describe("useProjectTools — updateProjectMeta (§715)", () => {
  test("update writes through the writer and resolves the stored meta", async () => {
    const h = mount();
    let stored: ProjectMeta | undefined;
    await act(async () => {
      stored = await h.result.current.dispatcher.updateProjectMeta(NEXT);
    });
    expect(h.writer).toHaveBeenCalledTimes(1);
    expect(h.writer).toHaveBeenCalledWith(NEXT);
    expect(stored).toBe(NEXT);
    // ★ Read back at once, before any effect: a later call in the same turn sees what was stored.
    expect(h.result.current.dispatcher.getProjectMeta()).toBe(NEXT);
  });

  test("update fails: card row error, project unchanged, no log, no undo", async () => {
    const h = mount({ writer: async () => false });
    let error: unknown;
    await act(async () => {
      await h.result.current.dispatcher.updateProjectMeta(NEXT).catch((e: unknown) => { error = e; });
    });
    expect(h.writer).toHaveBeenCalledTimes(1);
    expect((error as Error).message).toBe(SAVE_FAILED);
    expect(h.result.current.dispatcher.getProjectMeta()).toBe(STORED);
    expect(h.result.current.ws.project).toBe(STORED);
    expect(h.logActivityAs).not.toHaveBeenCalled();
    expect(h.captureComposite).not.toHaveBeenCalled();
  });

  test("project switch before apply drops the write", async () => {
    const epoch = { value: 1 };
    // The writer is reached, and the project is switched while it is in flight.
    const h = mount({ epoch, writer: async () => { epoch.value = 2; return true; } });
    let error: unknown;
    await act(async () => {
      await h.result.current.dispatcher.updateProjectMeta(NEXT).catch((e: unknown) => { error = e; });
    });
    expect((error as Error).message).toBe(SCOPE_MOVED);
    // The result is discarded: the record read back is not the one written for the other project.
    expect(h.result.current.dispatcher.getProjectMeta()).toBe(STORED);
    expect(h.logActivityAs).not.toHaveBeenCalled();
    expect(h.captureComposite).not.toHaveBeenCalled();
  });

  test("an unmoved scope epoch around the write is not a switch", async () => {
    const h = mount({ epoch: { value: 7 } });
    await act(async () => {
      await h.result.current.dispatcher.updateProjectMeta(NEXT);
    });
    expect(h.result.current.dispatcher.getProjectMeta()).toBe(NEXT);
  });

  test("read-only window refuses", async () => {
    const h = mount({ isReadOnly: true });
    let error: unknown;
    await act(async () => {
      await h.result.current.dispatcher.updateProjectMeta(NEXT).catch((e: unknown) => { error = e; });
    });
    expect((error as Error).message).toBe(READ_ONLY);
    expect(h.writer).not.toHaveBeenCalled();
  });

  test("no writer wired yet: refuses with the save-failed message and writes nothing", async () => {
    const h = mount();
    // Simulates the first render, before task-manager's effect fills the ref.
    const ref = { current: null as Writer | null };
    const view = renderHook(
      () => useChatDispatcher(makeDispatcherArgs({ projectWriterRef: ref, getScopeEpoch: () => 0 })),
      { wrapper: dispatcherWrapperWith({ project: STORED }) },
    );
    await expect(view.result.current.updateProjectMeta(NEXT)).rejects.toThrow(SAVE_FAILED);
    expect(h.writer).not.toHaveBeenCalled();
  });

  test("update_project through runTool relays the failure to the model", async () => {
    const h = mount({ writer: async () => false });
    const call = runTool(h.result.current.dispatcher, "update_project", { expectedToken: entityToken("project", STORED), customer: "Globex" });
    await expect(act(async () => { await call; })).rejects.toThrow(SAVE_FAILED);
  });
});

// From Task 4's review: staging stamps a token-less call from `ws.project`, and the write re-checks it against
// `getProjectMeta()`. Both must read the same record, so a token-less call goes through when nothing moved and is
// stale when the project changed after staging.
describe("useProjectTools — a token-less update_project through the real applyProposal (§715)", () => {
  const batch = { runBatched: async <T,>(fn: () => Promise<T>) => fn() };
  const CALL: ProposedCall = { name: "update_project", input: { customer: "Globex" } };

  function stage(project: ProjectMeta | undefined) {
    const ws = { ...emptyWorkspace(), project } as Workspace;
    return describeProposal([CALL], ws);
  }

  test("the live project still matches what was staged: the write goes through", async () => {
    const h = mount();
    const rows = stage(h.result.current.ws.project);
    let outcome: Awaited<ReturnType<typeof applyProposal>> | undefined;
    await act(async () => {
      outcome = await applyProposal({ dispatcher: h.result.current.dispatcher, rows, selected: new Set([0]), batch });
    });
    expect(outcome!.rows[0]).toMatchObject({ ok: true });
    expect(h.writer).toHaveBeenCalledWith({ ...STORED, customer: "Globex" });
  });

  test("the live project changed after staging: stale, and the writer is not called", async () => {
    const h = mount();
    const rows = stage(h.result.current.ws.project);
    act(() => h.result.current.ws.setProject({ ...STORED, description: "Changed in the form" }));
    let outcome: Awaited<ReturnType<typeof applyProposal>> | undefined;
    await act(async () => {
      outcome = await applyProposal({ dispatcher: h.result.current.dispatcher, rows, selected: new Set([0]), batch });
    });
    expect(outcome!.rows[0]).toMatchObject({ ok: false, stale: true });
    expect(h.writer).not.toHaveBeenCalled();
  });
});
