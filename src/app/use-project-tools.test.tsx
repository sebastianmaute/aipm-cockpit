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
import { clearDiagLog, readDiagLog } from "./diagnostics";
import { useUndoStack, type CaptureCompositeOpts } from "./undo/use-undo-stack";
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
  const captureComposite = vi.fn<(o: CaptureCompositeOpts) => void>();
  const showToast = vi.fn();
  const view = renderHook(
    () => ({
      dispatcher: useChatDispatcher(makeDispatcherArgs({
        isReadOnly: opts.isReadOnly ?? false,
        logActivityAs,
        undo: { captureComposite },
        projectWriterRef,
        getScopeEpoch: () => epoch.value,
        showToast,
      })),
      ws: useWorkspace(),
    }),
    { wrapper: dispatcherWrapperWith({ project: STORED }) },
  );
  return { ...view, writer, logActivityAs, captureComposite, showToast, epoch };
}

/** The one undo fragment the AI update captured, driven the way `compositeUndoRunner` drives a lone fragment:
 *  the call reverts and returns the redo. */
function capturedRestore(h: ReturnType<typeof mount>): () => () => void {
  expect(h.captureComposite).toHaveBeenCalledTimes(1);
  const [part] = h.captureComposite.mock.calls[0][0].parts;
  if (!part) throw new Error("no fragment captured");
  return () => part.restore({ current: new Map() }, true);
}

/** Lets the fire-and-forget writer promise an undo or redo started settle. */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

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

// Owner decision B: Claude's project edit is logged as the assistant's and is ONE undo entry, reverted and re-applied
// through the same writer; a failure, a refusal or a mid-write switch logs and captures nothing (tests above).
describe("useProjectTools — the AI edit is logged and undoable (§715)", () => {
  const TWO_FIELDS: ProjectMeta = { ...STORED, customer: "Globex", endDate: "2031-01-31" };

  test("a successful AI update logs project.updated with the changed fields", async () => {
    const h = mount();
    await act(async () => { await h.result.current.dispatcher.updateProjectMeta(TWO_FIELDS); });
    expect(h.logActivityAs).toHaveBeenCalledTimes(1);
    expect(h.logActivityAs).toHaveBeenCalledWith("ai", "project.updated", "customer, endDate");
  });

  test("a successful AI update captures one project undo entry, stamped with the epoch it was read in", async () => {
    const h = mount({ epoch: { value: 4 } });
    await act(async () => { await h.result.current.dispatcher.updateProjectMeta(NEXT); });
    expect(h.captureComposite).toHaveBeenCalledTimes(1);
    expect(h.captureComposite.mock.calls[0][0]).toMatchObject({
      kind: "project.updated", entityKey: "project", primaryCount: 1, name: "Apollo", readEpoch: 4,
    });
  });

  test("an update that changes nothing logs nothing and captures nothing", async () => {
    const h = mount();
    await act(async () => { await h.result.current.dispatcher.updateProjectMeta({ ...STORED }); });
    expect(h.logActivityAs).not.toHaveBeenCalled();
    expect(h.captureComposite).not.toHaveBeenCalled();
  });

  test("undo after an AI project update restores the previous meta through the writer", async () => {
    const h = mount();
    await act(async () => { await h.result.current.dispatcher.updateProjectMeta(NEXT); });
    let redo: () => void = () => {};
    act(() => { redo = capturedRestore(h)(); });
    await settle();
    expect(h.writer).toHaveBeenCalledTimes(2);
    expect(h.writer.mock.calls[1][0]).toEqual(STORED);
    act(() => redo());
    await settle();
    expect(h.writer).toHaveBeenCalledTimes(3);
    expect(h.writer.mock.calls[2][0]).toEqual(NEXT);
  });

  test("undo reverts only the fields the update changed, keeping a later form edit", async () => {
    const h = mount();
    await act(async () => { await h.result.current.dispatcher.updateProjectMeta(NEXT); });
    act(() => h.result.current.ws.setProject({ ...NEXT, description: "Edited in the form" }));
    act(() => { capturedRestore(h)(); });
    await settle();
    expect(h.writer.mock.calls[1][0]).toEqual({ ...STORED, description: "Edited in the form" });
  });

  // A list field is merged three ways, not reverted whole: a form save is not undoable, so Claude's entry is still
  // on top when the user adds to the same list, and a whole-value revert would silently drop that addition.
  describe("a list field Claude changed and the form changed again", () => {
    const GDPR = "GDPR / data protection regulation" as const;
    const WITH_GDPR: ProjectMeta = { ...STORED, regulatory: [GDPR] };
    const FORM_ADDED: ProjectMeta = { ...WITH_GDPR, regulatory: [GDPR, "NIS2"] };

    test("undo drops Claude's GDPR and keeps the form's NIS2", async () => {
      const h = mount();
      await act(async () => { await h.result.current.dispatcher.updateProjectMeta(WITH_GDPR); });
      act(() => h.result.current.ws.setProject(FORM_ADDED));
      act(() => { capturedRestore(h)(); });
      await settle();
      expect(h.writer.mock.calls[1][0].regulatory).toEqual(["NIS2"]);
    });

    test("redo puts GDPR back and still keeps NIS2", async () => {
      const h = mount();
      await act(async () => { await h.result.current.dispatcher.updateProjectMeta(WITH_GDPR); });
      act(() => h.result.current.ws.setProject(FORM_ADDED));
      let redo: () => void = () => {};
      act(() => { redo = capturedRestore(h)(); });
      await settle();
      act(() => h.result.current.ws.setProject({ ...STORED, regulatory: ["NIS2"] }));
      act(() => redo());
      await settle();
      expect(h.writer.mock.calls[2][0].regulatory).toEqual([GDPR, "NIS2"]);
    });

    test("a non-racing undo restores exactly the before value", async () => {
      const h = mount();
      await act(async () => { await h.result.current.dispatcher.updateProjectMeta(WITH_GDPR); });
      act(() => { capturedRestore(h)(); });
      await settle();
      expect(h.writer.mock.calls[1][0]).toEqual(STORED);
    });
  });

  test("a restore the writer could not store is logged; the writer has already shown its error", async () => {
    clearDiagLog();
    let calls = 0;
    const h = mount({ writer: async () => { calls += 1; return calls === 1; } });
    await act(async () => { await h.result.current.dispatcher.updateProjectMeta(NEXT); });
    act(() => { capturedRestore(h)(); });
    await settle();
    expect(readDiagLog().some((e) => e.code === "undo.projectRestoreFailed")).toBe(true);
    expect(h.showToast).not.toHaveBeenCalled();
  });

  test("a restore whose writer throws is shown as an error, not swallowed", async () => {
    clearDiagLog();
    let calls = 0;
    const h = mount({ writer: async () => { calls += 1; if (calls > 1) throw new Error("boom"); return true; } });
    await act(async () => { await h.result.current.dispatcher.updateProjectMeta(NEXT); });
    act(() => { capturedRestore(h)(); });
    await settle();
    expect(h.showToast).toHaveBeenCalledWith("error", expect.stringContaining("boom"));
    expect(readDiagLog().some((e) => e.code === "undo.projectRestoreFailed")).toBe(true);
  });

  describe("through the real undo stack", () => {
    function mountWithStack(epoch: { value: number }) {
      const writer = vi.fn<Writer>(async () => true);
      const view = renderHook(
        () => {
          const undo = useUndoStack({
            lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn(),
            getScopeEpoch: () => epoch.value,
          });
          const dispatcher = useChatDispatcher(makeDispatcherArgs({
            undo, projectWriterRef: { current: writer }, getScopeEpoch: () => epoch.value,
          }));
          return { undo, dispatcher };
        },
        { wrapper: dispatcherWrapperWith({ project: STORED }) },
      );
      return { ...view, writer };
    }

    test("Ctrl+Z writes the previous record through the writer", async () => {
      const h = mountWithStack({ value: 1 });
      await act(async () => { await h.result.current.dispatcher.updateProjectMeta(NEXT); });
      expect(h.result.current.undo.stack.map((m) => m.label)).toEqual(['Edit project "Apollo"']);
      act(() => h.result.current.undo.undo());
      await settle();
      expect(h.writer).toHaveBeenCalledTimes(2);
      expect(h.writer.mock.calls[1][0]).toEqual(STORED);
    });

    test("an undo after a project switch writes nothing into the project open now", async () => {
      const epoch = { value: 1 };
      const h = mountWithStack(epoch);
      await act(async () => { await h.result.current.dispatcher.updateProjectMeta(NEXT); });
      epoch.value = 2;
      act(() => h.result.current.undo.undo());
      await settle();
      expect(h.writer).toHaveBeenCalledTimes(1);
    });
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
