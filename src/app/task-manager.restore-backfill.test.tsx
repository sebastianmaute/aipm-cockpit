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
import type { DocumentAsset } from "./document-asset";
import type { KnowledgeItem } from "./document-link";
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
// Captured for the DEP-ARRAY pin below: it needs a setter for exactly ONE of
// the six, driven on its own so no other dep of `getVersionPayload` moves.
let setKnowledgeItemsRef: ((v: readonly KnowledgeItem[]) => void) | null = null;
// Captured so the documentAssets-absence test can prove itself non-vacuous: a
// non-empty documentAssets in CONTEXT is what makes `workspaceToJson`'s
// additive check (workspace.ts) actually emit a `documentAssets` key IF the
// slice were ever added to `getVersionPayload` — an unseeded (empty) slice
// would stay omitted either way, which would make that test pass for the
// wrong reason.
let setDocumentAssetsRef: ((v: readonly DocumentAsset[] | undefined) => void) | null = null;

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
      setKnowledgeItemsRef = ws.setKnowledgeItems;
      setDocumentAssetsRef = ws.setDocumentAssets;
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
              the set. Rendered through the SHARED `sixCells`, so this cell, the
              serializer control and the captured-payload key assertion cannot
              drift apart — see SIX_SLICES for why the `?? []` / `?? {}` there is
              load-bearing rather than defensive noise. */}
          <div data-testid="ws-six">{sixCells(ws)}</div>
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
import { defaultSettings } from "./settings-types";

// ★★★ SELF-DESCRIBING GUARD for the import-order landmine above. Nothing
// MECHANICAL protects that ordering — no `import/order` rule is configured — so
// an "organize imports" pass can hoist the `./workspace` line and re-break it.
// `defaultSettings.storageConfig` is EXACTLY the value the cycle poisons:
// settings-types builds it from `defaultStorageConfig` at module scope, so it is
// undefined iff the cycle was entered through ./workspace. Without this, the
// breakage surfaces as four identical failures deep inside `createBackend` and
// names nothing.
if (!defaultSettings.storageConfig) {
  throw new Error(
    "IMPORT ORDER BROKEN: ./workspace was evaluated before ./task-manager, so " +
      "settings-types is mid-cycle and defaultSettings.storageConfig is undefined. " +
      "Move the ./workspace value import back BELOW the ./task-manager import.",
  );
}

// ★★ THE SIX OPTIONAL SLICES, SPELLED ONCE. They are read in three places — the
// probe cell, the serializer control and the captured-payload key assertion —
// and a set kept in sync by hand across three spellings is a set that drifts.
// ★ `SixSliceSource` is deliberately STRUCTURAL: it must be satisfied by both a
// `Workspace` and the workspace CONTEXT value, whose optionality differs.
// ★★ THREE of the six are optional array types on the context
// (`readonly T[] | undefined`). `settingsOverrides` is NOT an array — it is
// `Readonly<SettingsOverrides> | undefined`, an object whose KEYS are counted.
// The `?? []` / `?? {}` fallbacks are load-bearing either way: a payload that
// omits a slice restores it as `undefined`, and a bare `.length` /
// `Object.keys()` would throw a TypeError instead of reporting the 0 this file
// exists to catch.
type SixSliceSource = {
  knowledgeItems?: readonly unknown[];
  insights?: readonly unknown[];
  documents?: readonly unknown[];
  documentVersions?: readonly unknown[];
  settingsOverrides?: object;
  calendarEvents?: readonly unknown[];
};

const SIX_SLICES = [
  { tag: "k", key: "knowledgeItems", count: (w: SixSliceSource) => (w.knowledgeItems ?? []).length },
  { tag: "i", key: "insights", count: (w: SixSliceSource) => (w.insights ?? []).length },
  { tag: "d", key: "documents", count: (w: SixSliceSource) => (w.documents ?? []).length },
  { tag: "dv", key: "documentVersions", count: (w: SixSliceSource) => (w.documentVersions ?? []).length },
  { tag: "so", key: "settingsOverrides", count: (w: SixSliceSource) => Object.keys(w.settingsOverrides ?? {}).length },
  { tag: "ce", key: "calendarEvents", count: (w: SixSliceSource) => (w.calendarEvents ?? []).length },
] as const;

/** The probe cell's text, e.g. `k:1,i:0,…`. Also the control's assertion subject. */
const sixCells = (w: SixSliceSource): string =>
  SIX_SLICES.map((s) => `${s.tag}:${s.count(w)}`).join(",");
/** What `sixCells` reads when every slice arrived. */
const SIX_PRESENT = SIX_SLICES.map((s) => `${s.tag}:1`).join(",");
/** The JSON keys a complete version payload must carry. */
const SIX_KEYS: readonly string[] = SIX_SLICES.map((s) => s.key);

/** Mount + hook-capture budget. The first render pulls the whole task-manager
 *  tree through the vitest transform, which is genuinely slow. */
const MOUNT_MS = 40000;
/** Per-test budget. ★★ It MUST exceed the waits inside it by a real margin: the
 *  slowest test here measured ~35s, so a 40000ms wait inside a 45000ms test
 *  leaves ~5s, and under `test:shuffle` contention the TEST timeout fires FIRST
 *  — printing `Test timed out in 45000ms` instead of the assertion diagnostic
 *  the pin exists to produce. The fix is to shrink the WAIT (see SETTLE_MS), not
 *  to grow this. */
const TEST_MS = 45000;
/** Post-`act()` settle. Both `applyRestored` calls are act-wrapped, so the DOM
 *  is already committed — this is a stray-tick guard, NOT a mount wait. Reusing
 *  MOUNT_MS for one of these is what created the margin problem above. */
const SETTLE_MS = 2000;

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

// The six slices `applyRestoredWorkspace` restored while `getVersionPayload`
// did NOT capture them — past tense on purpose: this branch closed that gap, and
// this fixture is what keeps it closed. ★★ Every literal here is shaped to survive its own sanitizer on
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

beforeEach(() => {
  __resetMintStateForTests();
  applyRestored = null;
  getPayload = null;
  setActivityLogRef = null;
  setKnowledgeItemsRef = null;
  setDocumentAssetsRef = null;
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
    await screen.findByTestId("ws-fks", undefined, { timeout: MOUNT_MS });
    await waitFor(() => expect(typeof applyRestored).toBe("function"), { timeout: MOUNT_MS });

    act(() => applyRestored!(restored()));

    // 42, not "none": the restore path ran the repair.
    await waitFor(
      () => expect(screen.getByTestId("ws-fks")).toHaveTextContent("1:42"),
      { timeout: MOUNT_MS },
    );
  }, TEST_MS);

  it("carries documentVersions through the restore funnel", async () => {
    // The restore path fans a workspace into every setter by hand, so a slice
    // missing from that list is silently dropped on a version restore even when
    // the ordinary load path handles it correctly.
    render(<TaskManager />);
    await screen.findByTestId("ws-doc-versions", undefined, { timeout: MOUNT_MS });
    await waitFor(() => expect(typeof applyRestored).toBe("function"), { timeout: MOUNT_MS });
    // Control: empty before the restore, so the assertion cannot pass by accident.
    expect(screen.getByTestId("ws-doc-versions")).toHaveTextContent("");

    act(() => applyRestored!(restored()));

    await waitFor(
      () => expect(screen.getByTestId("ws-doc-versions")).toHaveTextContent("11:ai:restored"),
      { timeout: MOUNT_MS },
    );
  }, TEST_MS);

  it("preserves the activity log across a version restore", async () => {
    // `restored()` carries no `activityLog` field at all, so a fan-out that
    // "completed the pattern" with `setActivityLog(w.activityLog ?? [])` would
    // reset the live log to `[]` here. `applyRestoredWorkspace` deliberately
    // omits activityLog (see task-manager.tsx) — a version restore must leave
    // whatever the log already held untouched.
    render(<TaskManager />);
    await screen.findByTestId("ws-activity-log", undefined, { timeout: MOUNT_MS });
    await waitFor(() => expect(typeof applyRestored).toBe("function"), { timeout: MOUNT_MS });
    await waitFor(() => expect(typeof setActivityLogRef).toBe("function"), { timeout: MOUNT_MS });

    const seeded: ActivityEntry = {
      id: "dev-1-1", timestamp: "2026-01-01T00:00:00.000Z", kind: "task.created", args: ["T1"],
    };
    act(() => setActivityLogRef!([seeded]));
    await waitFor(
      () => expect(screen.getByTestId("ws-activity-log")).toHaveTextContent("dev-1-1"),
      { timeout: MOUNT_MS },
    );

    act(() => applyRestored!(restored()));

    // Give the restore a tick to (mis)apply, then assert the seeded entry is
    // still there — a regression would flip this to empty.
    await waitFor(
      () => expect(screen.getByTestId("ws-fks")).toHaveTextContent("1:42"),
      { timeout: MOUNT_MS },
    );
    expect(screen.getByTestId("ws-activity-log")).toHaveTextContent("dev-1-1");
  }, TEST_MS);

  // ★★ ANTI-VACUITY CONTROL for the round-trip test below, and it is not
  // optional: a fixture the SANITIZER rejects reads "k:0,i:0,…" — byte-identical
  // to what the defect produces — so the pin would go green on a fix that changed
  // nothing, and stay red on a correct one. It lives in its OWN test so a
  // sanitizer regression is reported under a name pointing at the SERIALIZER
  // rather than at the payload.
  // ★ SCOPE, and it is narrow: this covers the serializer half ONLY, and only
  // while `getVersionPayload` delegates to `workspaceToJson`. Reimplemented as a
  // hand-rolled `JSON.stringify`, this control silently stops covering that half —
  // the captured-payload key assertion in the next test is what would still catch it.
  it("control: the six-slice fixture survives workspaceToJson → jsonToWorkspace", () => {
    expect(sixCells(jsonToWorkspace(workspaceToJson(sixSlicesWorkspace())))).toBe(SIX_PRESENT);
  });

  it("round-trips all six optional slices through getVersionPayload, not just applyWorkspace", async () => {
    // ★★★ The sibling documentVersions test above feeds applyRestored a workspace
    // that ALREADY carries the slice, so it would pass even if getVersionPayload
    // dropped it — which is the shape the defect took before this branch.
    // This one captures the payload the app would actually store, parses it back,
    // and only then restores — the shape a real version capture takes.
    render(<TaskManager />);
    await screen.findByTestId("ws-six", undefined, { timeout: MOUNT_MS });
    // ★★ `typeof … === "function"`, never `not.toBeNull()`: `toBeNull` is `=== null`,
    // so `undefined` PASSES it. Capturing a NEW prop BY NAME is this test's whole
    // point, and "useVersionHistory renamed getPayload" must not read as "the hook
    // has not been called yet" — which is the only thing `toBeNull` could tell them
    // apart by, and it cannot.
    await waitFor(() => expect(typeof getPayload).toBe("function"), { timeout: MOUNT_MS });
    await waitFor(() => expect(typeof applyRestored).toBe("function"), { timeout: MOUNT_MS });

    // Seed all six non-empty through the restore funnel.
    // ★★ That funnel is not the SUBJECT here, but for FOUR of the six this waitFor
    // is the only pin it has anywhere: the siblings above cover the apply half for
    // `tasks` and `documentVersions` ONLY, and nothing else in the suite asserts
    // that `applyRestoredWorkspace` carries knowledgeItems / insights /
    // settingsOverrides / calendarEvents. Load-bearing, not scaffolding.
    act(() => applyRestored!(sixSlicesWorkspace()));
    await waitFor(
      () => expect(screen.getByTestId("ws-six")).toHaveTextContent(SIX_PRESENT),
      { timeout: SETTLE_MS },
    );

    // Capture exactly as the version-history hook would.
    const captured = getPayload!();

    // ★★★ THE DIRECT PIN, and the one that cannot rot. It reads the payload
    // ITSELF: it names the missing slices in its own diagnostic and fails in
    // milliseconds. The end-to-end leg below observes the same fact through three
    // layers that are NOT under test (jsonToWorkspace → the apply funnel → context
    // state → this probe's render), and it can only fail because
    // `applyRestoredWorkspace` clobbers UNCONDITIONALLY — true today, but the
    // activity-log test above pins the OPPOSITE convention for its own slice, so
    // that is live drift, not a hypothetical. This assertion is immune to it.
    expect(Object.keys(JSON.parse(captured))).toEqual(expect.arrayContaining([...SIX_KEYS]));

    // End-to-end leg: restore from that capture and prove the slices reach render
    // scope. Before the fix the cell reads "k:0,i:0,d:0,dv:0,so:0,ce:0".
    act(() => applyRestored!(jsonToWorkspace(captured)));
    await waitFor(
      () => expect(screen.getByTestId("ws-six")).toHaveTextContent(SIX_PRESENT),
      { timeout: SETTLE_MS },
    );
  }, TEST_MS);

  // ★★ `documentAssets` IS DELIBERATELY ABSENT (docs/open-followups.md §254).
  // A capture carrying image bytes changes the cost of every autosave-triggered
  // version on a Turso project, and that is a measurement, not a docs task. This
  // pins the decision so adding the slice is a conscious act that fails here
  // first. `documents` is the positive control: an absence assertion alone would
  // pass against a payload that was never built.
  // ★ `documents` is an ADDITIVE key in `workspaceToJson` — it is only emitted
  // when non-empty (workspace.ts) — so an unseeded mount would make the
  // positive control fail too, for a reason unrelated to what this test is
  // pinning. Seed it through the same restore funnel the round-trip test above
  // uses.
  // ★★ WHAT THIS DOES NOT CATCH, so the seeding is not credited with more than
  // it buys: adding `documentAssets` to `getVersionPayload`'s object AND its dep
  // array turns this RED (the deps move, the callback is rebuilt, the key
  // appears). Adding it to the OBJECT ALONE does not — the mount-time
  // `useCallback` closure survives, its captured `documentAssets` is undefined,
  // and the additive key stays omitted with this test green. That mutant is
  // unreachable in practice only because `react-hooks/exhaustive-deps` is FATAL
  // here (`--max-warnings=0`), i.e. the lint gate is load-bearing for this pin.
  // ★★ `documentAssets` is ALSO additive-only, so it is not enough to leave it
  // unseeded and check for absence — an empty `documentAssets` would stay out
  // of the payload even if `getVersionPayload` were changed to pass it through.
  // Seed it non-empty via the workspace context directly (there is no restore-
  // funnel path for it — `applyRestoredWorkspace` never sets it, see
  // task-manager.tsx), so this test can actually fail if the slice is added.
  it("captures documents but not documentAssets", async () => {
    render(<TaskManager />);
    await screen.findByTestId("ws-six", undefined, { timeout: MOUNT_MS });
    await waitFor(() => expect(typeof getPayload).toBe("function"), { timeout: MOUNT_MS });
    await waitFor(() => expect(typeof applyRestored).toBe("function"), { timeout: MOUNT_MS });
    await waitFor(() => expect(typeof setDocumentAssetsRef).toBe("function"), { timeout: MOUNT_MS });

    act(() => applyRestored!(sixSlicesWorkspace()));
    await waitFor(
      () => expect(screen.getByTestId("ws-six")).toHaveTextContent(SIX_PRESENT),
      { timeout: SETTLE_MS },
    );
    act(() => setDocumentAssetsRef!([{
      id: "a1", name: "x.png", mime: "image/png", size: 1, hash: "h",
      createdAt: "2026-01-01T00:00:00.000Z",
    }]));

    const payload = getPayload!();
    const keys = Object.keys(JSON.parse(payload));
    expect(keys).toContain("documents");
    expect(keys).not.toContain("documentAssets");
  }, TEST_MS);

  // ★★★ THE DEPENDENCY-ARRAY PIN, and the round-trip test above CANNOT be it.
  // `getVersionPayload` is a `useCallback` over 24 names. The test above drives
  // its six slices through `applyRestoredWorkspace`, which also writes tasks,
  // raid, resources and more — all already in the dep array — so the closure is
  // refreshed by THOSE writes and the six could be absent from the deps entirely
  // with that test still green. Measured, not reasoned: dropping `knowledgeItems`
  // from the dep array alone leaves every other test in this file passing.
  //
  // ★★ The failure it guards is real, not theoretical: with the dep absent, a
  // capture taken right after an AI document write stores the PRE-write slice,
  // because nothing else changed to refresh the closure. Unlike
  // `use-storage-backend.ts`'s save-effect deps, this line carries NO
  // `eslint-disable`, so `react-hooks/exhaustive-deps` does flag it — at
  // severity 1, and CI runs bare `npm run lint` with no `--max-warnings`, so it
  // ships green. This test is the only thing that fails.
  //
  // ★ ONE slice, deliberately. Driving all six would re-introduce the very
  // multi-dep refresh that makes the test above blind here.
  it("recaptures a slice mutated ON ITS OWN — the getVersionPayload dep array", async () => {
    render(<TaskManager />);
    await screen.findByTestId("ws-six", undefined, { timeout: MOUNT_MS });
    await waitFor(() => expect(typeof getPayload).toBe("function"), { timeout: MOUNT_MS });
    await waitFor(() => expect(typeof setKnowledgeItemsRef).toBe("function"), { timeout: MOUNT_MS });

    // ★★ ANTI-VACUITY: the assertion below must be able to read BOTH answers off
    // this same payload shape. Without this leg a capture that always carried the
    // slice — or one that never did — would be indistinguishable from a pass.
    expect(JSON.parse(getPayload!()).knowledgeItems ?? []).toHaveLength(0);

    // The ONLY state write in this test. Nothing else `getVersionPayload`
    // depends on moves, so a listed dep is the only thing that can refresh the
    // memoized closure.
    act(() => setKnowledgeItemsRef!([
      { id: "k-dep", name: "K", url: "https://knowledge.test/dep", kind: "file" } as KnowledgeItem,
    ]));
    // Prove the write reached render scope before capturing — otherwise a red
    // run cannot tell a stale closure from a write that never landed.
    await waitFor(
      () => expect(screen.getByTestId("ws-six")).toHaveTextContent("k:1"),
      { timeout: SETTLE_MS },
    );

    const captured = JSON.parse(getPayload!()) as { knowledgeItems?: readonly KnowledgeItem[] };
    expect(captured.knowledgeItems ?? []).toHaveLength(1);
    expect((captured.knowledgeItems ?? [])[0]?.id).toBe("k-dep");
  }, TEST_MS);
});
