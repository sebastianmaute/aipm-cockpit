// AI people protection, Task 5 (spec layer 1): the chat's people tools are classified, removed from the
// request and refused by the executor, with ONE predicate behind both gates.
import { describe, it, expect, vi } from "vitest";
import { TOOL_DEFS, PEOPLE_TOOLS, NON_PEOPLE_TOOLS, PEOPLE_TOOL_REFUSAL, peopleToolsLive } from "./chat-tool-defs";
import { toolNamesFor, toolsFor, buildStableSystemBlocks, buildTurnContext, type ToolFlags } from "./chat-api";
import { runTool, type ToolDispatcher } from "./chat-tools";

const SPEC_MINIMUM = [
  "list_resources", "get_resource", "create_resource", "update_resource", "delete_resource",
  "list_stakeholders", "create_stakeholder", "update_stakeholder", "delete_stakeholder",
  "list_absences", "create_absence", "update_absence", "delete_absence",
  "list_allocations", "get_contact_email", "search_history", "search_chats",
];

const OPEN: ToolFlags = { historySearch: true, chatSearch: true, forecast: true };

describe("people tool classification", () => {
  it("puts every tool in exactly one of PEOPLE_TOOLS and NON_PEOPLE_TOOLS", () => {
    const names = TOOL_DEFS.map((d) => d.name);
    expect(names.length).toBeGreaterThan(40);
    const unclassified = names.filter((n) => PEOPLE_TOOLS.has(n) === NON_PEOPLE_TOOLS.has(n));
    expect(unclassified).toEqual([]);
    // No stale entry either: a classified name that is no longer a tool would hide a rename.
    expect([...PEOPLE_TOOLS, ...NON_PEOPLE_TOOLS].filter((n) => !names.includes(n))).toEqual([]);
  });

  it("classifies at least the spec's people tools as people tools", () => {
    expect(SPEC_MINIMUM.filter((n) => !PEOPLE_TOOLS.has(n))).toEqual([]);
  });

  // Review 3, R5: escalating is acting on a person, and under protection the recipient (required) is stripped and
  // its look-up (get_contact_email) is gone, so the tool could never succeed. It is a people tool: not offered.
  it("escalate_raid_item is a people tool", () => {
    expect(PEOPLE_TOOLS.has("escalate_raid_item")).toBe(true);
    expect(toolNamesFor({ ...OPEN, peopleProtected: true }).has("escalate_raid_item")).toBe(false);
    expect(toolNamesFor({ ...OPEN, peopleProtected: false }).has("escalate_raid_item")).toBe(true);
  });

  it("only an explicit true takes the people tools away", () => {
    expect(peopleToolsLive(true)).toBe(false);
    expect(peopleToolsLive(false)).toBe(true);
    expect(peopleToolsLive(undefined)).toBe(true);
  });
});

describe("advertisement gate", () => {
  it("a protected request carries no people tool, and an allowed one carries them all", () => {
    const protectedNames = toolNamesFor({ ...OPEN, peopleProtected: true });
    expect([...PEOPLE_TOOLS].filter((n) => protectedNames.has(n))).toEqual([]);
    expect(toolsFor({ ...OPEN, peopleProtected: true }).map((d) => d.name).filter((n) => PEOPLE_TOOLS.has(n))).toEqual([]);
    const allowed = toolNamesFor({ ...OPEN, peopleProtected: false });
    expect([...PEOPLE_TOOLS].filter((n) => !allowed.has(n))).toEqual([]);
    // The rest of the list is untouched.
    expect([...NON_PEOPLE_TOOLS].filter((n) => !protectedNames.has(n))).toEqual([]);
  });

  // §773: four date-writing tools told the model to call list_absences, which a protected request withholds.
  it("a protected request's tool texts never point at the withheld list_absences; an allowed one still does", () => {
    const prot = { ...OPEN, peopleProtected: true };
    expect(toolNamesFor(prot).has("list_absences")).toBe(false);
    expect(toolsFor(prot).filter((d) => /\blist_absences\b/.test(JSON.stringify(d))).map((d) => d.name)).toEqual([]);
    const pointing = toolsFor({ ...OPEN, peopleProtected: false }).filter((d) => JSON.stringify(d).includes("list_absences")).map((d) => d.name);
    expect(pointing).toEqual(expect.arrayContaining(["create_task", "update_task", "create_milestone", "update_milestone"]));
    // The clash sentence stays: clashes still come back under protection.
    const createTask = toolsFor(prot).find((d) => d.name === "create_task");
    expect(JSON.stringify(createTask)).toContain("absenceClashes");
  });

  it("keeps one array identity per combination, so the cached tool list stays stable", () => {
    expect(toolsFor({ ...OPEN, peopleProtected: true })).toBe(toolsFor({ ...OPEN, peopleProtected: true }));
    expect(toolsFor({ ...OPEN, peopleProtected: true })).not.toBe(toolsFor(OPEN));
  });

  it("the protected system prompt does not advertise the resource tools", () => {
    const snapshot = {
      today: "2026-10-30", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 0,
      knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [] as string[],
      currentView: "open-points" as const,
    } as unknown as ReturnType<ToolDispatcher["getSnapshot"]>;
    const prot = buildStableSystemBlocks("en-US", snapshot, [], false, { ...OPEN, peopleProtected: true })[0]!.text;
    expect(prot).not.toContain("create_resource");
    expect(prot).toContain("protects its people");
    const open = buildStableSystemBlocks("en-US", snapshot, [], false, OPEN)[0]!.text;
    expect(open).toContain("create_resource");
  });

  it("the protected turn context drops per-person insight lines", () => {
    const snapshot = {
      today: "2026-10-30", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 0,
      knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [] as string[],
      currentView: "open-points" as const,
      insights: [{
        id: 1, type: "timelogCapPerDay", severity: "medium", status: "active",
        data: { person: "Alice Anderson", count: 2, threshold: 10, worstHours: 12 },
        firstSeenAt: "2026-10-01", lastSeenAt: "2026-10-30",
      }],
    } as unknown as ReturnType<ToolDispatcher["getSnapshot"]>;
    expect(buildTurnContext("en-US", snapshot, [], false, OPEN)).toContain("Alice Anderson");
    expect(buildTurnContext("en-US", snapshot, [], false, { ...OPEN, peopleProtected: true })).not.toContain("Alice Anderson");
  });
});

describe("executor gate", () => {
  // Every dispatcher method is a spy; the protected one answers true. A refused call must touch none of the others.
  function spyDispatcher(protectedNow: boolean): { d: ToolDispatcher; calls: string[] } {
    const calls: string[] = [];
    const d = new Proxy({} as Record<string, unknown>, {
      get(_t, prop: string) {
        if (prop === "isPeopleProtected") return () => protectedNow;
        if (prop === "then") return undefined;
        return vi.fn(() => { calls.push(prop); return []; });
      },
    }) as unknown as ToolDispatcher;
    return { d, calls };
  }

  it("refuses every people tool under protection and touches no state", async () => {
    for (const name of PEOPLE_TOOLS) {
      const { d, calls } = spyDispatcher(true);
      await expect(runTool(d, name, { id: 1, firstName: "A", lastName: "B", name: "X" }), name).rejects.toThrow(PEOPLE_TOOL_REFUSAL);
      expect(calls, name).toEqual([]);
    }
  });

  // The positive control: the same dispatcher, allowed, reaches the dispatcher.
  it("serves a people tool when the project allows people", async () => {
    const { d, calls } = spyDispatcher(false);
    await runTool(d, "list_resources", {});
    expect(calls).toContain("listResources");
  });
});
