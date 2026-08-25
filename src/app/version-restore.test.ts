import { describe, it, expect } from "vitest";
import { applyRestore, changeKey, type RestoreSelection } from "./version-restore";
import { diffWorkspaces } from "./version-diff";
import { workspaceToJson, type Workspace } from "./workspace";

function ws(over: Partial<Workspace>): Workspace {
  return { tasks: [], raid: [], absences: [], shifts: [], resources: [], roles: [],
    disciplines: [], grades: [], plan: {} as never, budgets: [], milestones: [],
    changes: [], stakeholders: [], status: {} as never, ...over } as Workspace;
}
const task = (id: number, over: Record<string, unknown> = {}) => ({ id, title: `T${id}`, ...over } as never);

describe("applyRestore", () => {
  it("reverts a selected modified field, leaving unselected fields as-is", () => {
    const version = ws({ tasks: [task(1, { title: "Old", owner: "Ann" })] });
    const now = ws({ tasks: [task(1, { title: "New", owner: "Bob" })] });
    const changes = diffWorkspaces(version, now);
    const sel: RestoreSelection = { [changeKey("tasks", 1)]: ["title"] };
    const out = applyRestore(now, version, changes, sel);
    const t1 = out.tasks.find((t) => (t as { id: number }).id === 1) as Record<string, unknown>;
    expect(t1.title).toBe("Old");
    expect(t1.owner).toBe("Bob");
  });
  it("re-adds a record that was removed since the version", () => {
    const version = ws({ tasks: [task(1), task(2)] });
    const now = ws({ tasks: [task(1)] });
    const changes = diffWorkspaces(version, now);
    const sel: RestoreSelection = { [changeKey("tasks", 2)]: "all" };
    const out = applyRestore(now, version, changes, sel);
    expect(out.tasks.map((t) => (t as { id: number }).id).sort()).toEqual([1, 2]);
  });
  it("removes a record that was added since the version (opt-in)", () => {
    const version = ws({ tasks: [task(1)] });
    const now = ws({ tasks: [task(1), task(2)] });
    const changes = diffWorkspaces(version, now);
    const sel: RestoreSelection = { [changeKey("tasks", 2)]: "all" };
    const out = applyRestore(now, version, changes, sel);
    expect(out.tasks.map((t) => (t as { id: number }).id)).toEqual([1]);
  });
  it("leaves everything unchanged when nothing is selected", () => {
    const version = ws({ tasks: [task(1, { title: "Old" })] });
    const now = ws({ tasks: [task(1, { title: "New" })] });
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, {});
    expect((out.tasks[0] as unknown as { title: string }).title).toBe("New");
  });
  it("restores selected fields of a singleton (project)", () => {
    const version = ws({ project: { name: "A", code: "X" } as never });
    const now = ws({ project: { name: "B", code: "Y" } as never });
    const changes = diffWorkspaces(version, now);
    const sel: RestoreSelection = { [changeKey("project", null)]: ["name"] };
    const out = applyRestore(now, version, changes, sel);
    expect((out.project as { name: string; code: string }).name).toBe("A");
    expect((out.project as { name: string; code: string }).code).toBe("Y");
  });
  it("does not mutate the input workspaces", () => {
    const version = ws({ tasks: [task(1, { title: "Old" })] });
    const now = ws({ tasks: [task(1, { title: "New" })] });
    const changes = diffWorkspaces(version, now);
    applyRestore(now, version, changes, { [changeKey("tasks", 1)]: "all" });
    expect((now.tasks[0] as unknown as { title: string }).title).toBe("New");
  });
});

// ★★★ ARRAY-TYPED SLICES. `COLLECTION_SPECS` pairs a workspace key with a
// `kind`, and a "singleton" spec sends the key through `mergeFields`, whose
// `{ ...target }` turns an ARRAY into an object with numeric keys. Nothing in
// the type system pairs the two, so the mismatch is invisible until a restore
// runs. These pin the RESULT SHAPE, which is the only place it shows.
describe("applyRestore over array-typed slices", () => {
  const kItem = (id: string, name: string) =>
    ({ id, name, url: `https://example.com/${id}`, kind: "file" }) as never;
  const insight = (id: number, severity: string) =>
    ({
      id, key: `k${id}`, type: "overdueTask", severity, data: {}, status: "open",
      firstSeenAt: "2026-01-01", lastSeenAt: "2026-01-02", occurrences: 1,
    }) as never;
  // The plain per-row "Restore" button in `history-panel` builds exactly this:
  // every change, no user input. So this is the real path, not a contrived pick.
  const selectAll = (changes: ReturnType<typeof diffWorkspaces>): RestoreSelection =>
    Object.fromEntries(changes.map((c) => [changeKey(c.collection, c.recordId), "all" as const]));

  it("keeps knowledgeItems and insights as ARRAYS through a full restore", () => {
    const version = ws({ knowledgeItems: [kItem("a", "Old")], insights: [insight(1, "low")] });
    const now = ws({ knowledgeItems: [kItem("a", "New")], insights: [insight(1, "high")] });
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, selectAll(changes));
    expect({
      knowledgeItems: Array.isArray(out.knowledgeItems),
      insights: Array.isArray(out.insights),
    }).toEqual({ knowledgeItems: true, insights: true });
  });

  // The step that turns corruption into DELETION: `workspaceToJson` gates each
  // additive slice on `.length`, which is `undefined` on an object — so the key
  // is omitted and every one of the six write paths drops the slice on the next
  // save, silently and permanently.
  it("still emits both slices when the restored workspace is re-serialized", () => {
    const version = ws({ knowledgeItems: [kItem("a", "Old")], insights: [insight(1, "low")] });
    const now = ws({ knowledgeItems: [kItem("a", "New")], insights: [insight(1, "high")] });
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, selectAll(changes));
    const keys = Object.keys(JSON.parse(workspaceToJson(out)) as Record<string, unknown>);
    expect({
      knowledgeItems: keys.includes("knowledgeItems"),
      insights: keys.includes("insights"),
    }).toEqual({ knowledgeItems: true, insights: true });
  });

  // BUG-CLASS guard — not about these two names. Any `COLLECTION_SPECS` entry
  // whose declared `kind` disagrees with the slice's real type lands here, and
  // the failure diagnostic NAMES the slice.
  // The SIX slices `getVersionPayload` added to the capture split 5/1 at the
  // restore layer, and the split is deliberate: only `settingsOverrides` is a
  // genuine OBJECT singleton, so only it belongs in `COLLECTION_SPECS`. The
  // other five are arrays and are carried through from the LIVE workspace.
  it("reverts settingsOverrides but carries the five array slices from live state", () => {
    const version = ws({
      settingsOverrides: { timezone: { timezone: "Europe/Berlin" } } as never,
      knowledgeItems: [kItem("a", "Old")],
      insights: [insight(1, "low")],
    });
    const now = ws({
      settingsOverrides: { timezone: { timezone: "UTC" } } as never,
      knowledgeItems: [kItem("a", "New")],
      insights: [insight(1, "high")],
    });
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, selectAll(changes));
    expect((out.settingsOverrides as { timezone: { timezone: string } }).timezone.timezone)
      .toBe("Europe/Berlin");
    expect((out.knowledgeItems as readonly { name: string }[])[0].name).toBe("New");
    expect((out.insights as unknown as readonly { severity: string }[])[0].severity).toBe("high");
  });

  it("turns no array-typed slice of the workspace into an object", () => {
    const arrays = (n: string) => ({
      knowledgeItems: [kItem("a", n)],
      insights: [insight(1, n === "Old" ? "low" : "high")],
      documents: [{ id: `d-${n}`, title: n, blocks: [], createdAt: "2026-01-01", updatedAt: "2026-01-02" }],
      documentVersions: [{ id: `v-${n}`, documentId: "d", capturedAt: "2026-01-01", blocks: [] }],
      calendarEvents: [{ id: 1, title: n, date: "2026-01-01" }],
    }) as unknown as Partial<Workspace>;
    const version = ws(arrays("Old"));
    const now = ws(arrays("New"));
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, selectAll(changes)) as unknown as Record<string, unknown>;
    const before = now as unknown as Record<string, unknown>;
    const broken = Object.keys(before).filter((k) => Array.isArray(before[k]) && !Array.isArray(out[k]));
    expect(broken).toEqual([]);
  });
});
