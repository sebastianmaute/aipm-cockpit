// AI people protection: the chat's people tools are classified, removed from the
// request and refused by the executor, with ONE predicate behind both gates.
import { describe, it, expect, vi } from "vitest";
import {
  TOOL_DEFS, PEOPLE_TOOLS, NON_PEOPLE_TOOLS, PEOPLE_TOOL_REFUSAL, RESOURCES_HIDDEN_TOOL_REFUSAL, PeopleToolRefusedError,
  peopleToolsLive, peopleToolsOffered,
} from "./chat-tool-defs";
import { RESOURCES_HIDDEN_INSTRUCTION, toolNamesFor, toolsFor, buildStableSystemBlocks, buildTurnContext, type ToolFlags } from "./chat-api";
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

  // Follow-up: get_task told the model to use get_contact_email, which a protected request withholds. Every tool text
  // a protected request advertises (descriptions and parameter descriptions, every tool, every flag combination) must
  // name no withheld people tool. Both lists are derived: withheld = PEOPLE_TOOLS minus what the request carries.
  it("no tool text a protected request advertises names a withheld people tool", () => {
    const offenders = new Set<string>();
    let checked = 0;
    for (const historySearch of [false, true]) for (const chatSearch of [false, true]) for (const forecast of [false, true]) {
      const flags: ToolFlags = { historySearch, chatSearch, forecast, peopleProtected: true };
      const advertised = toolsFor(flags);
      const carried = toolNamesFor(flags);
      const withheld = [...PEOPLE_TOOLS].filter((n) => !carried.has(n));
      expect(withheld.length).toBeGreaterThan(0);
      for (const def of advertised) {
        const text = JSON.stringify(def);
        checked += 1;
        for (const name of withheld) if (new RegExp(String.raw`\b${name}\b`).test(text)) offenders.add(`${def.name} -> ${name}`);
      }
    }
    expect(checked).toBeGreaterThan(8 * 40);
    expect([...offenders].sort()).toEqual([]);
    // The probe can see a withheld name: the allowed get_task still points at get_contact_email.
    expect(JSON.stringify(toolsFor({ ...OPEN, peopleProtected: false }).find((d) => d.name === "get_task"))).toMatch(/\bget_contact_email\b/);
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
      // Timelog shown: a TimeLog line is sent at all only then.
      knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: ["timelog"] as string[],
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

// §810 — a project whose Resources function is hidden: the people tools are neither offered nor served, by the
// same predicate (`peopleToolsOffered`), and nothing else about the list changes (no protected-definition swap).
describe("Resources hidden (§810)", () => {
  const OFF_SNAPSHOT = {
    today: "2026-10-30", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 0,
    knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [] as string[],
    currentView: "open-points" as const,
  } as unknown as ReturnType<ToolDispatcher["getSnapshot"]>;

  it("offers people tools only when neither protection nor a hidden Resources function withholds them", () => {
    expect(peopleToolsOffered({})).toBe(true);
    expect(peopleToolsOffered({ peopleProtected: false, resourcesHidden: false })).toBe(true);
    expect(peopleToolsOffered({ resourcesHidden: true })).toBe(false);
    expect(peopleToolsOffered({ peopleProtected: true })).toBe(false);
    expect(peopleToolsOffered({ peopleProtected: true, resourcesHidden: true })).toBe(false);
  });

  it("a request with Resources hidden carries no people tool and every other definition unchanged", () => {
    const hidden = toolsFor({ resourcesHidden: true });
    expect(hidden.map((d) => d.name).filter((n) => PEOPLE_TOOLS.has(n))).toEqual([]);
    // No swap: each kept tool is the definition the default request sends (the cache breakpoint aside).
    const strip = (d: object) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== "cache_control"));
    const plain = toolsFor({}).filter((d) => !PEOPLE_TOOLS.has(d.name));
    expect(hidden.map(strip)).toEqual(plain.map(strip));
    expect(hidden.length).toBeGreaterThan(0);
    expect(toolNamesFor({ resourcesHidden: true }).has("list_resources")).toBe(false);
  });

  it("only an explicit true withdraws them, and each combination keeps one array identity", () => {
    expect(toolsFor({ resourcesHidden: false })).toBe(toolsFor({}));
    expect(toolsFor({ resourcesHidden: true })).toBe(toolsFor({ resourcesHidden: true }));
    expect(toolsFor({ resourcesHidden: true })).not.toBe(toolsFor({}));
    // Protection keeps its own meaning: the swap still applies when both are set.
    const both = toolsFor({ peopleProtected: true, resourcesHidden: true });
    expect(both.map((d) => d.name).filter((n) => PEOPLE_TOOLS.has(n))).toEqual([]);
    expect(JSON.stringify(both.find((d) => d.name === "get_task"))).not.toMatch(/\bget_contact_email\b/);
  });

  it("the system prompt does not advertise the resource tools while Resources is hidden", () => {
    const text = buildStableSystemBlocks("en-US", OFF_SNAPSHOT, [], false, { ...OPEN, resourcesHidden: true })[0]!.text;
    expect(text).not.toContain("create_resource");
    expect(text).not.toContain("protects its people");
    expect(text).toContain(RESOURCES_HIDDEN_INSTRUCTION);
  });

  function hiddenDispatcher(resourcesHidden: boolean): { d: ToolDispatcher; calls: string[] } {
    const calls: string[] = [];
    const d = new Proxy({} as Record<string, unknown>, {
      get(_t, prop: string) {
        if (prop === "isPeopleProtected") return () => false;
        if (prop === "isResourcesHidden") return () => resourcesHidden;
        if (prop === "then") return undefined;
        return vi.fn(() => { calls.push(prop); return []; });
      },
    }) as unknown as ToolDispatcher;
    return { d, calls };
  }

  it("the executor refuses every people tool while Resources is hidden and touches no state", async () => {
    for (const name of PEOPLE_TOOLS) {
      const { d, calls } = hiddenDispatcher(true);
      await expect(runTool(d, name, { id: 1, firstName: "A", lastName: "B", name: "X" }), name).rejects.toBeInstanceOf(PeopleToolRefusedError);
      expect(calls, name).toEqual([]);
    }
    const { d } = hiddenDispatcher(true);
    await expect(runTool(d, "list_resources", {})).rejects.toThrow(RESOURCES_HIDDEN_TOOL_REFUSAL);
  });

  it("CONTROL: the same dispatcher with Resources shown serves a people tool", async () => {
    const { d, calls } = hiddenDispatcher(false);
    await runTool(d, "list_resources", {});
    expect(calls).toContain("listResources");
  });

  it("a non-people tool is still served while Resources is hidden", async () => {
    const { d, calls } = hiddenDispatcher(true);
    await runTool(d, "list_tasks", {});
    expect(calls).toContain("listTasks");
  });
});
