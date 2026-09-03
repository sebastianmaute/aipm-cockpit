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
  const DISPATCH: Array<{ tool: string; kind: TokenEntity; method: keyof ToolDispatcher }> = [
    { tool: "update_task", kind: "task", method: "updateTask" },
    { tool: "update_raid_item", kind: "raid", method: "updateRaid" },
    { tool: "update_change", kind: "change", method: "updateChange" },
    { tool: "update_milestone", kind: "milestone", method: "updateMilestone" },
    { tool: "update_stakeholder", kind: "stakeholder", method: "updateStakeholder" },
    { tool: "update_resource", kind: "resource", method: "updateResource" },
  ];

  it.each(DISPATCH)("$tool ACCEPTS no excluded field", async ({ tool, kind, method }) => {
    // ★ The parameters are DECLARED so `spy.mock.calls[0][1]` is typed. A bare
    //   `vi.fn(() => ...)` gives the call tuple length 0: vitest stays green
    //   and only `npx tsc --noEmit` objects.
    const spy = vi.fn((id: number, patch: Record<string, unknown>) => ({ id, patch }));
    const dispatcher = { [method]: spy } as unknown as ToolDispatcher;
    // Inject every excluded field for this entity as raw tool input, which is
    // exactly what a model could emit -- the schema does not constrain what
    // arrives, only what is documented.
    const input: Record<string, unknown> = { id: 1 };
    for (const field of TOKEN_EXCLUDED[kind]) input[field] = "INJECTED";

    await runTool(dispatcher, tool, input);

    // Anti-vacuity: a throw before dispatch would otherwise pass silently.
    expect(spy, `${tool} must reach the dispatcher`).toHaveBeenCalledTimes(1);
    const patch = spy.mock.calls[0][1];
    const leaked = Object.keys(patch).filter((f) => TOKEN_EXCLUDED[kind].includes(f));
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
  // ★★★ FIVE OF THE SIX PROJECTORS HAD ZERO COVERAGE when this module shipped,
  //   and the failure they hide is silent rather than loud: a projector paired
  //   with the WRONG renderer does not throw, it renders every column the
  //   renderer does not recognise as "" -- so the entity still gets a token,
  //   just a near-constant one, and the guard permits every stale write for
  //   that kind. Only a per-kind covered-field assertion can see it.

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
