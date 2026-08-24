// Pins the SECOND load funnel: a version-history RESTORE must run the task
// resource-FK backfill, exactly as the storage load path does.
//
// ★★★ WHY THIS FILE EXISTS. `backfillTaskResourceFks` repairs tasks that carry
// an assignee STRING but no FK — the shape that rendered one person as two
// swimlanes. `use-storage-backend.test.tsx` pins the funnel in `applyWorkspace`,
// and it is the funnel everyone thinks of. But `task-manager.tsx`
// `applyRestoredWorkspace` is a SECOND, independent funnel, and until this file
// was written it had NO test of any kind: deleting the backfill call there and
// leaving a bare `setTasks(w.tasks ?? [])` kept the entire suite green while a
// Turso version restore silently reverted a project's task FKs to the broken
// pre-repair shape. Any future third funnel needs the same treatment.
//
// ★ The assertion is on the workspace CONTEXT's task list, not on a spy: it
// proves the repaired rows actually reached render scope, not merely that a
// function was called.
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import type { ActivityEntry } from "./activity-log";
import type { Task } from "./types";
import type { Workspace } from "./workspace";

let applyRestored: ((w: Workspace) => void) | null = null;
// The CAPTURE half of the version-history contract. Held separately from
// `applyRestored` because the two halves are independently wrong: an apply-only
// test is green while the capture drops a slice (see the round-trip test below).
let getPayload: (() => string) | null = null;
// Captured from the workspace context so a test can seed the log the same way
// `logActivity` would, without needing the real hook plumbing.
let setActivityLogRef: ((v: readonly ActivityEntry[]) => void) | null = null;

// Capture the callback task-manager hands the version-history hook. This is the
// only way in — `applyRestoredWorkspace` is not exported, and mounting the real
// restore flow would need a Turso backend.
vi.mock("./use-version-history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-version-history")>()),
  useVersionHistory: (args: { applyWorkspace: (w: Workspace) => void; getPayload: () => string }) => {
    applyRestored = args.applyWorkspace;
    getPayload = args.getPayload;
    return {
      versions: [], busy: false, notifySaved: () => {},
      captureNow: async () => {}, loadDiff: async () => [],
      restore: async () => true, remove: async () => true, refresh: async () => {},
    };
  },
}));

// Probe standing in for the heavy pane: reports each task's id and FK straight
// out of the workspace context.
vi.mock("./workspace-section", async (importOriginal) => {
  const { useWorkspace } = await import("./workspace-context");
  return {
    ...(await importOriginal<typeof import("./workspace-section")>()),
    WorkspaceSection: () => {
      const ws = useWorkspace();
      setActivityLogRef = ws.setActivityLog;
      return (
        <div>
          <div data-testid="ws-fks">
            {ws.tasks.map((t) => `${t.id}:${t.resourceId ?? "none"}`).join(",")}
          </div>
          <div data-testid="ws-doc-versions">
            {ws.documentVersions.map((v) => `${v.id}:${v.source}:${v.op}`).join(",")}
          </div>
          <div data-testid="ws-activity-log">
            {ws.activityLog.map((e) => e.id).join(",")}
          </div>
          {/* All six OPTIONAL slices in one cell, so a single assertion covers
              the set. ★ Four of them are `readonly T[] | undefined` on the
              context (knowledgeItems / insights / calendarEvents, and
              settingsOverrides is `| undefined` too) — `?? []` is load-bearing,
              not defensive noise: a payload that omits a slice restores it as
              `undefined`, and a bare `.length` would throw a TypeError instead
              of reporting the 0 this test is here to catch. */}
          <div data-testid="ws-six">
            {[
              `k:${(ws.knowledgeItems ?? []).length}`,
              `i:${(ws.insights ?? []).length}`,
              `d:${ws.documents.length}`,
              `dv:${ws.documentVersions.length}`,
              `so:${Object.keys(ws.settingsOverrides ?? {}).length}`,
              `ce:${(ws.calendarEvents ?? []).length}`,
            ].join(",")}
          </div>
        </div>
      );
    },
  };
});

import TaskManager from "./task-manager";
// ★★★ VALUE import, and it MUST stay BELOW `./task-manager`. Imports are
// evaluated in source order, and there is a runtime cycle around this module
// (settings-types imports the VALUE `defaultStorageConfig` from ./workspace,
// which imports ./document-model, which imports back from ./settings-types —
// see document-model.ts). Entering through ./workspace FIRST leaves
// settings-types mid-evaluation: measured, hoisting this line to the top made
// `defaultStorageConfig` undefined and every test in this file died in
// `createBackend` on `config.kind`. `./task-manager` pulls ./storage first,
// which is the order the real app loads in. A bare `import type` is erased and
// so was always safe up here — this one is not.
import { jsonToWorkspace, workspaceToJson } from "./workspace";

const makeTask = (over: Partial<Task>): Task => ({
  id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-03-01",
  lastUpdateDate: "2026-02-01", priority: "Medium", status: "To Do",
  blockers: "", description: "", ...over,
} as Task);

const restored = (): Workspace => ({
  project: { id: "p1", name: "Seed", code: "SEED" },
  resources: [{
    id: 42, firstName: "Dennis", lastName: "Kurschner", roleId: null,
    utilizationMode: "percent", utilization: {},
  }],
  // Case- and whitespace-variant on purpose: only the normalising matcher links
  // it, so a raw-string comparison would leave the FK unset and fail here.
  tasks: [makeTask({ id: 1, assignee: "  dennis   KURSCHNER " })],
  // ★★ `source: "ai"` / `op: "restored"` are unreachable by default: the context
  // state initialises to `[]` and the sanitizer falls back to "user"/"update",
  // so seeing them proves the restore funnel really carried this slice through.
  documentVersions: [{
    id: 11, documentId: 7, title: "Before image", blocks: [],
    savedAt: "2026-08-06T00:00:00.000Z", source: "ai", op: "restored",
  }],
} as unknown as Workspace);

// The six slices `applyRestoredWorkspace` restores but `getVersionPayload` does
// not capture. ★★ Every literal here is shaped to survive its own sanitizer on
// the way back through `jsonToWorkspace` — a fixture the sanitizer drops would
// read as `k:0,…` exactly like the defect does, making the round-trip pin
// unfalsifiable. The test asserts that survival explicitly before it asserts
// anything about the payload.
// ★ `documentVersions` is deliberately NOT overridden: `restored()` already
// carries a sanitizer-valid one (positive int ids, canonical ISO `savedAt`,
// non-empty title), and a second spelling of that shape could only drift.
const sixSlicesWorkspace = (): Workspace => ({
  ...restored(),
  // ★★★ `raid: []` is LOAD-BEARING and `restored()` does not carry it.
  // `jsonToWorkspace` bails to `emptyWorkspace()` unless BOTH `tasks` and
  // `raid` parse as arrays, and `workspaceToJson` omits an undefined key
  // entirely — so without this the anti-vacuity control below reads
  // "k:0,i:0,…", i.e. EXACTLY what the defect produces. Measured: adding this
  // one line flips the control from all-zero to all-one. The live app never
  // hits it (context state is `[]`), which is precisely why a fixture can.
  raid: [],
  knowledgeItems: [{ id: "k1", name: "K", url: "https://knowledge.test/a", kind: "file" }],
  insights: [{
    id: 1, key: "i1", type: "raidAging", severity: "low", status: "active",
    data: {}, firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z", occurrences: 1,
  }],
  documents: [{
    id: 5, title: "D", blocks: [],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  }],
  settingsOverrides: { timezone: { timezone: "Europe/Berlin" } },
  calendarEvents: [{
    id: 3, title: "E", startDate: "2026-01-02", startTime: "09:00", durationMinutes: 60,
  }],
});

/** What the probe renders when all six slices are present. */
const SIX_PRESENT = "k:1,i:1,d:1,dv:1,so:1,ce:1";

beforeEach(() => {
  __resetMintStateForTests();
  applyRestored = null;
  getPayload = null;
  setActivityLogRef = null;
  window.localStorage.clear();
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
});

describe("task-manager → applyRestoredWorkspace", () => {
  it("backfills task resource FKs on a version restore, not only on load", async () => {
    render(<TaskManager />);
    await screen.findByTestId("ws-fks", undefined, { timeout: 40000 });
    await waitFor(() => expect(applyRestored).not.toBeNull(), { timeout: 40000 });

    act(() => applyRestored!(restored()));

    // 42, not "none": the restore path ran the repair.
    await waitFor(
      () => expect(screen.getByTestId("ws-fks")).toHaveTextContent("1:42"),
      { timeout: 40000 },
    );
  }, 45000);

  it("carries documentVersions through the restore funnel", async () => {
    // The restore path fans a workspace into every setter by hand, so a slice
    // missing from that list is silently dropped on a version restore even when
    // the ordinary load path handles it correctly.
    render(<TaskManager />);
    await screen.findByTestId("ws-doc-versions", undefined, { timeout: 40000 });
    await waitFor(() => expect(applyRestored).not.toBeNull(), { timeout: 40000 });
    // Control: empty before the restore, so the assertion cannot pass by accident.
    expect(screen.getByTestId("ws-doc-versions")).toHaveTextContent("");

    act(() => applyRestored!(restored()));

    await waitFor(
      () => expect(screen.getByTestId("ws-doc-versions")).toHaveTextContent("11:ai:restored"),
      { timeout: 40000 },
    );
  }, 45000);

  it("preserves the activity log across a version restore", async () => {
    // `restored()` carries no `activityLog` field at all, so a fan-out that
    // "completed the pattern" with `setActivityLog(w.activityLog ?? [])` would
    // reset the live log to `[]` here. `applyRestoredWorkspace` deliberately
    // omits activityLog (see task-manager.tsx) — a version restore must leave
    // whatever the log already held untouched.
    render(<TaskManager />);
    await screen.findByTestId("ws-activity-log", undefined, { timeout: 40000 });
    await waitFor(() => expect(applyRestored).not.toBeNull(), { timeout: 40000 });
    await waitFor(() => expect(setActivityLogRef).not.toBeNull(), { timeout: 40000 });

    const seeded: ActivityEntry = {
      id: "dev-1-1", timestamp: "2026-01-01T00:00:00.000Z", kind: "task.created", args: ["T1"],
    };
    act(() => setActivityLogRef!([seeded]));
    await waitFor(
      () => expect(screen.getByTestId("ws-activity-log")).toHaveTextContent("dev-1-1"),
      { timeout: 40000 },
    );

    act(() => applyRestored!(restored()));

    // Give the restore a tick to (mis)apply, then assert the seeded entry is
    // still there — a regression would flip this to empty.
    await waitFor(
      () => expect(screen.getByTestId("ws-fks")).toHaveTextContent("1:42"),
      { timeout: 40000 },
    );
    expect(screen.getByTestId("ws-activity-log")).toHaveTextContent("dev-1-1");
  }, 45000);

  it("round-trips all six optional slices through getVersionPayload, not just applyWorkspace", async () => {
    // ★★★ The sibling documentVersions test above feeds applyRestored a workspace
    // that ALREADY carries the slice, so it passes while getVersionPayload drops it.
    // This one captures the payload the app would actually store, parses it back,
    // and only then restores — the shape a real version capture takes.
    //
    // ★★ ANTI-VACUITY CONTROL, and it is not optional. A fixture the SANITIZER
    // rejects produces the same "k:0,i:0,…" the defect does, so the pin would be
    // green after any fix that changed nothing. Prove the six survive a full
    // workspaceToJson → jsonToWorkspace round trip FIRST; after that, a 0 below
    // can only mean the payload never carried them.
    const control = jsonToWorkspace(workspaceToJson(sixSlicesWorkspace()));
    expect({
      k: control.knowledgeItems?.length ?? 0,
      i: control.insights?.length ?? 0,
      d: control.documents?.length ?? 0,
      dv: control.documentVersions?.length ?? 0,
      so: Object.keys(control.settingsOverrides ?? {}).length,
      ce: control.calendarEvents?.length ?? 0,
    }).toEqual({ k: 1, i: 1, d: 1, dv: 1, so: 1, ce: 1 });

    render(<TaskManager />);
    await screen.findByTestId("ws-six", undefined, { timeout: 40000 });
    await waitFor(() => expect(getPayload).not.toBeNull(), { timeout: 40000 });
    await waitFor(() => expect(applyRestored).not.toBeNull(), { timeout: 40000 });

    // Seed all six non-empty through the restore funnel (which is NOT under test
    // here — the sibling tests pin it — it is just the cheapest way to populate).
    act(() => applyRestored!(sixSlicesWorkspace()));
    await waitFor(
      () => expect(screen.getByTestId("ws-six")).toHaveTextContent(SIX_PRESENT),
      { timeout: 40000 },
    );

    // Capture as the version-history hook would, then restore from that capture.
    const captured = getPayload!();
    act(() => applyRestored!(jsonToWorkspace(captured)));

    // Every slice must survive the capture. Before the fix this reads
    // "k:0,i:0,d:0,dv:0,so:0,ce:0" — the payload never carried them.
    await waitFor(
      () => expect(screen.getByTestId("ws-six")).toHaveTextContent(SIX_PRESENT),
      { timeout: 40000 },
    );
  }, 45000);
});
