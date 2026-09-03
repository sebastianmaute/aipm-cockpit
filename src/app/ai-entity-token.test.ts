import { describe, expect, it, vi } from "vitest";
import { entityToken, TOKEN_EXCLUDED, type TokenEntity } from "./ai-entity-token";
import { TOOL_DEFS } from "./chat-tool-defs";
import { runTool, type ToolDispatcher } from "./chat-tools";
import type { Task } from "./types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Ship it",
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    dueDate: "2030-12-31",
    lastUpdateDate: "2030-01-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "<p>original</p>",
    ...overrides,
  } as Task;
}

describe("entityToken", () => {
  it("is stable for an unchanged entity", () => {
    expect(entityToken("task", task())).toBe(entityToken("task", task()));
  });

  it("changes when a COVERED field changes", () => {
    // The positive direction. Without it a constant would pass every other case.
    expect(entityToken("task", task({ description: "<p>edited</p>" })))
      .not.toBe(entityToken("task", task()));
    expect(entityToken("task", task({ status: "Done" })))
      .not.toBe(entityToken("task", task()));
  });

  it("does NOT change when an EXCLUDED field changes", () => {
    // The negative direction, and the reason the exclusion set exists: a Jira
    // sync stamp or a note append must not refuse an unrelated edit.
    for (const field of TOKEN_EXCLUDED.task) {
      const mutated = task({ [field]: "2031-01-01" } as Partial<Task>);
      expect(entityToken("task", mutated)).toBe(entityToken("task", task()));
    }
  });
});

describe("the exclusion set is disjoint from what the AI can write", () => {
  // ★★★ EXCLUDING A WRITABLE FIELD REINTRODUCES A FALSE PERMIT for exactly that
  //   field: two writers could both change it with neither detected. This test
  //   is the only thing standing between that rule and good intentions.
  const UPDATE_TOOLS: Record<string, TokenEntity> = {
    update_task: "task",
    update_raid_item: "raid",
    update_milestone: "milestone",
    update_change: "change",
    update_stakeholder: "stakeholder",
    update_resource: "resource",
  };

  /** `update_*` tools deliberately outside the token, each because the thing it
   *  writes has no CSV projection to derive a token FROM — not because it is
   *  safe to overwrite. Both are meta-blob or config slices.
   *    update_settings  app config, not workspace entity data
   *    update_document  a `ProjectDocument` persists as a meta-blob (one JSON
   *                     row in `meta`) with no CSV projection, so `PROJECTORS`
   *                     has no entry and `entityToken` structurally cannot
   *                     cover it. ★ It does NOT follow that documents need a
   *                     new mechanism: `DocOp` already carries an optional
   *                     `expect` on `replace`/`delete`/`move` (`document-ops.ts`),
   *                     which is per-block optimistic concurrency. It is
   *                     merely UNADVERTISED — `chat-tool-defs-documents.ts`
   *                     exposes op/index/block/blocks with no `expect`, and
   *                     its op enum omits `move` entirely. Wiring documents up
   *                     means advertising what exists, not building it. */
  const NOT_TOKEN_GUARDED = ["update_settings", "update_document"];

  it("names every update tool that exists, so a new one cannot slip past", () => {
    // Anti-vacuity: without this, deleting a row from UPDATE_TOOLS above would
    // silently shrink the check to nothing and still pass. ★ TOOL_DEFS spreads
    // DOCUMENT_TOOL_DEFS from a SECOND file, so a grep over chat-tool-defs.ts
    // alone under-counts the update tools -- which is how update_document was
    // missed when this test was specified.
    const defined = TOOL_DEFS.map((d) => d.name).filter((n) => n.startsWith("update_"));
    const covered = Object.keys(UPDATE_TOOLS).concat(NOT_TOKEN_GUARDED).sort();
    expect(defined.slice().sort()).toEqual(covered);
  });

  /** Token-guarded tools whose NAME sits outside the `update_*` convention. */
  const GUARDED_NON_UPDATE = ["set_task_dependencies"];

  // ★★★ THE `update_*` NAME IS NOT THE GUARDED SET, AND THE CASE ABOVE CANNOT
  //   SEE THAT. It filters `TOOL_DEFS` on `startsWith("update_")`, so a
  //   token-guarded tool named anything else is invisible to it BY
  //   CONSTRUCTION — which is exactly how `set_task_dependencies` shipped
  //   unguarded through the slice that introduced the token. It is a WHOLE-LIST
  //   REPLACE of `dependencies`: a field that is in `CSV_COLUMNS`, is not in
  //   `TOKEN_EXCLUDED.task`, and comes straight from model input, behind a
  //   `case` with no `requireToken` at all. Worse, `ai-entity-token.ts`'s
  //   carve-out NAMED the tool while accounting only for its `localModifiedAt`
  //   stamp, so an auditor read it as cleared and moved on.
  //   This case enumerates by what a schema ADVERTISES instead — a property of
  //   the TOOL, not of its name — so it is equality in both directions: a new
  //   guarded tool must be listed here, and a listed tool that silently drops
  //   `expectedTokenField` turns it red.
  it("names every tool that advertises a token, so a guarded tool outside the update_* naming cannot slip past", () => {
    const advertising = TOOL_DEFS.filter(
      (d) =>
        "expectedToken" in
        ((d.input_schema as { properties?: Record<string, unknown> }).properties ?? {}),
    )
      .map((d) => d.name)
      .sort();
    expect(advertising).toEqual(Object.keys(UPDATE_TOOLS).concat(GUARDED_NON_UPDATE).sort());
  });

  it.each(Object.entries(UPDATE_TOOLS))("%s ADVERTISES no excluded field", (toolName, kind) => {
    const def = TOOL_DEFS.find((d) => d.name === toolName);
    expect(def, `${toolName} must exist`).toBeDefined();
    const writable = Object.keys(
      (def!.input_schema as { properties?: Record<string, unknown> }).properties ?? {},
    );
    const overlap = writable.filter((f) => TOKEN_EXCLUDED[kind].includes(f));
    expect(overlap).toEqual([]);
  });

  // ★★★ THE ADVERTISED SURFACE IS NOT THE ACCEPTED ONE, AND ONLY THE ACCEPTED
  //   ONE MATTERS. The case above reads `input_schema.properties`, i.e. what
  //   the tool DECLARES it takes. For five of the six tools that is strictly
  //   smaller than what `runTool` actually forwards: `patchWithoutId` used to
  //   be `{...input}` minus `id` -- no whitelist at all -- and
  //   `use-register-tools` spreads that raw patch straight over the stored
  //   entity, where `sanitizeRaidItem`/`sanitizeMilestone` PRESERVE
  //   `outlookEventId` and `inquiriesSent`. So the model could write two
  //   excluded fields on raid, one on change and one on milestone, and the
  //   token was blind to all of them by construction -- a false PERMIT for
  //   exactly those fields. `update_task` was the only one safe, because it
  //   goes through the `buildPatch` whitelist instead.
  //   This case drives the REAL dispatch path, so it stays honest if someone
  //   reverts the strip or adds a seventh pass-through tool.
  //   ★★ EACH ROW ALSO NAMES THE ENTITY'S FULL-ROW GETTER, because a
  //   token-guarded update fetches the stored row BEFORE it will accept a
  //   write. A dispatcher carrying only the update method makes the tool throw
  //   on a missing getter, and the anti-vacuity assertion below then reports it
  //   honestly rather than passing. The getter is threaded for all six because
  //   all six are guarded.
  //   ★★ THIS COMMENT USED TO SINGLE OUT `update_task` as the only tool
  //   enforcement had reached, and to describe the other five as still to
  //   come. It was written mid-slice and described PRE-FIX code as current:
  //   the five were guarded in the same slice, in the commit right after the
  //   one that sentence shipped in, and `set_task_dependencies` later made
  //   seven. It read as a live TODO for finished work -- the direction that
  //   wastes a reader's time rather than misleading them into a defect, but
  //   the same rot.
  //   ★★ THE OLD WORDING IS DESCRIBED HERE, NOT QUOTED, AND THAT IS
  //   DELIBERATE. A verbatim quotation of a corrected string makes a `grep`
  //   for the defect hit the CORRECTION and report it as still live -- which
  //   is exactly what happened on this comment: a reviewer grepped the old
  //   sentence, found it inside the fix, and re-reported the item as
  //   outstanding. Correct a claim by describing what it used to say.
  const DISPATCH: Array<{
    tool: string;
    kind: TokenEntity;
    method: keyof ToolDispatcher;
    getter: keyof ToolDispatcher;
  }> = [
    { tool: "update_task", kind: "task", method: "updateTask", getter: "getTask" },
    { tool: "update_raid_item", kind: "raid", method: "updateRaid", getter: "getRaidRow" },
    { tool: "update_change", kind: "change", method: "updateChange", getter: "getChangeRow" },
    { tool: "update_milestone", kind: "milestone", method: "updateMilestone", getter: "getMilestoneRow" },
    { tool: "update_stakeholder", kind: "stakeholder", method: "updateStakeholder", getter: "getStakeholderRow" },
    { tool: "update_resource", kind: "resource", method: "updateResource", getter: "getResourceRow" },
  ];

  it.each(DISPATCH)("$tool ACCEPTS no excluded field", async ({ tool, kind, method, getter }) => {
    // ★ The parameters are DECLARED so `spy.mock.calls[0][1]` is typed. A bare
    //   `vi.fn(() => ...)` gives the call tuple length 0: vitest stays green
    //   and only `npx tsc --noEmit` objects.
    const spy = vi.fn((id: number, patch: Record<string, unknown>) => ({ id, patch }));
    // The stored row. It is the token's ONLY input, so a bare id is enough --
    // this case is about what the patch carries, not about token sensitivity,
    // which the projector cases below cover.
    const current = { id: 1 };
    const dispatcher = {
      [method]: spy,
      [getter]: vi.fn(() => current),
    } as unknown as ToolDispatcher;
    // Inject every excluded field for this entity as raw tool input, which is
    // exactly what a model could emit -- the schema does not constrain what
    // arrives, only what is documented.
    const input: Record<string, unknown> = {
      id: 1,
      expectedToken: entityToken(kind, current),
    };
    for (const field of TOKEN_EXCLUDED[kind]) input[field] = "INJECTED";

    await runTool(dispatcher, tool, input);

    // Anti-vacuity: a throw before dispatch would otherwise pass silently.
    expect(spy, `${tool} must reach the dispatcher`).toHaveBeenCalledTimes(1);
    const patch = spy.mock.calls[0][1];
    // ★★ `expectedToken` IS CHECKED ALONGSIDE THE EXCLUDED FIELDS, and it is a
    //   separate hazard: it is not an entity field at all but a control value
    //   the model now sends to all six tools, and the five pass-through ones
    //   spread their patch straight onto the stored row. Without the strip in
    //   `patchWithoutId` it would be persisted as a junk property.
    const leaked = Object.keys(patch).filter(
      (f) => TOKEN_EXCLUDED[kind].includes(f) || f === "expectedToken",
    );
    expect(leaked).toEqual([]);
  });
});

const KIND_CASES: Array<{ kind: TokenEntity; base: Record<string, unknown>; covered: string }> = [
  { kind: "task", base: { id: 1, taskName: "Ship it" }, covered: "taskName" },
  { kind: "raid", base: { id: 1, title: "Budget risk" }, covered: "title" },
  { kind: "milestone", base: { id: 1, name: "Go live" }, covered: "name" },
  { kind: "change", base: { id: 1, title: "Scope change" }, covered: "title" },
  { kind: "stakeholder", base: { id: 1, name: "Alice" }, covered: "name" },
  { kind: "resource", base: { id: 1, firstName: "Alice" }, covered: "firstName" },
];

describe("every projector is exercised, not just task", () => {
  // ★★★ THESE CASES ARE THE SOLE DETECTOR OF A KEY/TYPE MISPAIRING, and that
  //   is a NARROWER claim than the one that stood here. `PROJECTORS` is
  //   `Record<TokenEntity, ErasedProjector>`, so nothing binds a KEY to its
  //   entity type: `task: projector<RaidItem>({columns: RAID_CSV_COLUMNS,
  //   render: raidFieldToString})` is internally consistent and COMPILES.
  //   Measured with that mutant in place -- tsc exits 0, and these cases fail
  //   2 of 35: "'task': a covered field moves the token" and the injectivity
  //   case.
  //
  // ★★★ THEY ARE BLIND TO THE COLUMNS/RENDERER MISPAIRING, which is the one
  //   `Projector<T>` exists for. This comment used to claim "only a per-kind
  //   covered-field assertion can see it" of that mispairing, and it is FALSE:
  //   measured with `raid: projector<RaidItem>({columns: RAID_CSV_COLUMNS,
  //   render: fieldToString})`, tsc exits 2 and this suite is 35/35 GREEN. A
  //   false coverage claim is worse than none -- it reads as protection and
  //   stops the next audit -- so state which guard does which job.
  //
  // ★ Five of the six projectors had no coverage at all when this module
  //   shipped, which is what these cases fix; the detection split above is a
  //   separate point about what they can and cannot see.

  it.each(KIND_CASES)("$kind: a covered field moves the token", ({ kind, base, covered }) => {
    expect(entityToken(kind, { ...base, [covered]: "CHANGED VALUE" }))
      .not.toBe(entityToken(kind, base));
  });

  it.each(KIND_CASES)("$kind: an excluded field does not move the token", ({ kind, base }) => {
    const before = entityToken(kind, base);
    for (const field of TOKEN_EXCLUDED[kind]) {
      expect(entityToken(kind, { ...base, [field]: "INJECTED" })).toBe(before);
    }
  });

  it.each(KIND_CASES)("$kind: is stable for an unchanged entity", ({ kind, base }) => {
    expect(entityToken(kind, { ...base })).toBe(entityToken(kind, { ...base }));
  });
});

describe("the projection is injective", () => {
  it("distinguishes values that a bare concatenation would collide", () => {
    // `taskName` and `assignee` are ADJACENT in CSV_COLUMNS, so under the
    // original `column + " " + value` encoding these two entities produced
    // byte-identical input to the hash and therefore the same token -- two
    // entities differing in a COVERED field comparing equal. The length prefix
    // is what makes the encoding unambiguous.
    expect(entityToken("task", { id: 1, taskName: "x", assignee: "assignee y" }))
      .not.toBe(entityToken("task", { id: 1, taskName: "xassignee ", assignee: "y" }));
  });
});
