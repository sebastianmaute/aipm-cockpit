// AI people protection: the chat's people tools are classified, removed from the
// request and refused by the executor, with ONE predicate behind both gates.
import { describe, it, expect, vi } from "vitest";
import {
  TOOL_DEFS, PEOPLE_TOOLS, NON_PEOPLE_TOOLS, PEOPLE_TOOL_REFUSAL, RESOURCES_HIDDEN_DEFS, RESOURCES_HIDDEN_TOOL_REFUSAL, PeopleToolRefusedError,
  RESOURCES_TOOLS, STAKEHOLDER_TOOLS, STAKEHOLDERS_HIDDEN_TOOL_REFUSAL, peopleToolsLive, toolOffered, toolWithheldBy,
} from "./chat-tool-defs";
import { RESOURCES_HIDDEN_INSTRUCTION, STAKEHOLDERS_HIDDEN_INSTRUCTION, toolNamesFor, toolsFor, buildStableSystemBlocks, buildTurnContext, type ToolFlags } from "./chat-api";
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

// §810 — a project whose Resources function is hidden withdraws only the tools Resources owns (the directory,
// absences, allocations and contact e-mail); the stakeholder tools follow the Stakeholders function. Both are
// decided by one predicate (`toolWithheldBy`) that the list and the executor ask. Search, chat search, the
// inquiry mail and the escalation are never withdrawn by a hidden function.
describe("hidden Resources and Stakeholders functions (§810)", () => {
  const OFF_SNAPSHOT = {
    today: "2026-10-30", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 0,
    knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [] as string[],
    currentView: "open-points" as const,
  } as unknown as ReturnType<ToolDispatcher["getSnapshot"]>;
  const NEVER_BY_A_FUNCTION = ["search_history", "search_chats", "send_inquiry", "escalate_raid_item"];

  it("Resources owns the directory, absences, allocations and contact e-mail; Stakeholders owns its four tools", () => {
    expect([...RESOURCES_TOOLS].sort()).toEqual([
      "create_absence", "create_resource", "delete_absence", "delete_resource", "get_contact_email", "get_resource",
      "list_absences", "list_allocations", "list_resources", "update_absence", "update_resource",
    ]);
    expect([...STAKEHOLDER_TOOLS].sort()).toEqual(["create_stakeholder", "delete_stakeholder", "list_stakeholders", "update_stakeholder"]);
    for (const name of [...RESOURCES_TOOLS, ...STAKEHOLDER_TOOLS]) expect(PEOPLE_TOOLS.has(name), name).toBe(true);
    for (const name of NEVER_BY_A_FUNCTION) {
      expect(RESOURCES_TOOLS.has(name), name).toBe(false);
      expect(STAKEHOLDER_TOOLS.has(name), name).toBe(false);
    }
  });

  it("the predicate names the switch that withholds a tool, and protection wins", () => {
    expect(toolWithheldBy("list_resources", {})).toBeNull();
    expect(toolWithheldBy("list_resources", { resourcesHidden: true })).toBe("resources");
    expect(toolWithheldBy("list_resources", { stakeholdersHidden: true })).toBeNull();
    expect(toolWithheldBy("list_stakeholders", { resourcesHidden: true })).toBeNull();
    expect(toolWithheldBy("list_stakeholders", { stakeholdersHidden: true })).toBe("stakeholders");
    expect(toolWithheldBy("send_inquiry", { resourcesHidden: true, stakeholdersHidden: true })).toBeNull();
    expect(toolWithheldBy("send_inquiry", { peopleProtected: true })).toBe("protected");
    expect(toolWithheldBy("list_resources", { peopleProtected: true, resourcesHidden: true })).toBe("protected");
    expect(toolWithheldBy("list_tasks", { peopleProtected: true, resourcesHidden: true, stakeholdersHidden: true })).toBeNull();
    expect(toolOffered("list_resources", { resourcesHidden: false })).toBe(true);
    expect(toolOffered("list_resources", { resourcesHidden: true })).toBe(false);
  });

  it("a request with Resources hidden drops only the Resources tools and swaps only the hint-carrying definitions", () => {
    const hidden = toolsFor({ resourcesHidden: true });
    const names = hidden.map((d) => d.name);
    expect(names.filter((n) => RESOURCES_TOOLS.has(n))).toEqual([]);
    for (const name of [...STAKEHOLDER_TOOLS, ...NEVER_BY_A_FUNCTION]) expect(names, name).toContain(name);
    const strip = (d: object) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== "cache_control"));
    const plain = toolsFor({}).filter((d) => !RESOURCES_TOOLS.has(d.name));
    expect(names).toEqual(plain.map((d) => d.name));
    const changed = hidden.filter((d, i) => JSON.stringify(strip(d)) !== JSON.stringify(strip(plain[i]!))).map((d) => d.name);
    expect(new Set(changed)).toEqual(new Set([...RESOURCES_HIDDEN_DEFS.keys()]));
    // The escalation stays offered, so it loses its pointer at the withdrawn get_contact_email.
    expect(new Set(changed)).toEqual(new Set(["create_task", "update_task", "create_milestone", "update_milestone", "get_task", "escalate_raid_item"]));
    expect(JSON.stringify(hidden.find((d) => d.name === "escalate_raid_item"))).toContain("toEmail is required: if the user did not give it, ask.");
  });

  it("a request with Stakeholders hidden drops the stakeholder tools and stops offering a stakeholder's e-mail", () => {
    const hidden = toolsFor({ stakeholdersHidden: true });
    const strip = (d: object) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== "cache_control"));
    const plain = toolsFor({}).filter((d) => !STAKEHOLDER_TOOLS.has(d.name));
    expect(hidden.map((d) => d.name)).toEqual(plain.map((d) => d.name));
    const changed = hidden.filter((d, i) => JSON.stringify(strip(d)) !== JSON.stringify(strip(plain[i]!))).map((d) => d.name);
    expect(new Set(changed)).toEqual(new Set(["get_contact_email", "escalate_raid_item"]));
    const contact = hidden.find((d) => d.name === "get_contact_email")!;
    expect((contact.input_schema.properties as { entity: { enum: string[] } }).entity.enum).toEqual(["task", "resource", "raid", "absence"]);
    expect(contact.description).not.toMatch(/stakeholder/i);
    expect(JSON.stringify(hidden.find((d) => d.name === "escalate_raid_item"))).not.toMatch(/stakeholder/i);
    expect(toolNamesFor({ stakeholdersHidden: true }).has("list_resources")).toBe(true);
  });

  it("Simple mode (both functions hidden) still carries search, chat search, the inquiry and the escalation", () => {
    const names = toolNamesFor({ ...OPEN, resourcesHidden: true, stakeholdersHidden: true });
    for (const name of NEVER_BY_A_FUNCTION) expect(names.has(name), name).toBe(true);
    for (const name of [...RESOURCES_TOOLS, ...STAKEHOLDER_TOOLS]) expect(names.has(name), name).toBe(false);
  });

  // Fix 1 withholds absence clashes while Resources is hidden, so no text may promise them either.
  it("no tool text a function-hidden request advertises names a withheld tool or (Resources hidden) promises absenceClashes", () => {
    const offenders = new Set<string>();
    let checked = 0;
    for (const peopleProtected of [false, true]) for (const historySearch of [false, true]) for (const forecast of [false, true])
      for (const [resourcesHidden, stakeholdersHidden] of [[true, false], [false, true], [true, true]] as const) {
        const flags: ToolFlags = { historySearch, chatSearch: true, forecast, peopleProtected, resourcesHidden, stakeholdersHidden };
        const carried = toolNamesFor(flags);
        const withheld = [...PEOPLE_TOOLS].filter((n) => toolWithheldBy(n, flags) !== null);
        expect(withheld.every((n) => !carried.has(n))).toBe(true);
        for (const def of toolsFor(flags)) {
          const text = JSON.stringify(def);
          checked++;
          for (const name of withheld) if (new RegExp(String.raw`\b${name}\b`).test(text)) offenders.add(`${def.name} -> ${name}`);
          if (resourcesHidden && text.includes("absenceClashes")) offenders.add(`${def.name} -> absenceClashes`);
          if (stakeholdersHidden && def.name === "get_contact_email" && /stakeholder/i.test(text)) offenders.add(`${def.name} -> stakeholder`);
        }
      }
    expect(checked).toBeGreaterThan(300);
    expect([...offenders]).toEqual([]);
  });

  it("only an explicit true withdraws, and each combination keeps one array identity", () => {
    expect(toolsFor({ resourcesHidden: false, stakeholdersHidden: false })).toBe(toolsFor({}));
    expect(toolsFor({ resourcesHidden: true })).toBe(toolsFor({ resourcesHidden: true }));
    expect(toolsFor({ stakeholdersHidden: true })).toBe(toolsFor({ stakeholdersHidden: true }));
    const distinct = new Set([
      toolsFor({}), toolsFor({ resourcesHidden: true }), toolsFor({ stakeholdersHidden: true }),
      toolsFor({ resourcesHidden: true, stakeholdersHidden: true }),
    ]);
    expect(distinct.size).toBe(4);
    // Protection keeps its own meaning: every people tool goes and the swap still applies when both are set.
    const both = toolsFor({ peopleProtected: true, resourcesHidden: true });
    expect(both.map((d) => d.name).filter((n) => PEOPLE_TOOLS.has(n))).toEqual([]);
    expect(JSON.stringify(both.find((d) => d.name === "get_task"))).not.toMatch(/\bget_contact_email\b/);
  });

  it("the system prompt names the Resources switch for the Resources tools and the Stakeholders switch for stakeholders", () => {
    const text = (flags: ToolFlags) => buildStableSystemBlocks("en-US", OFF_SNAPSHOT, [], false, { ...OPEN, ...flags })[0]!.text;
    const res = text({ resourcesHidden: true });
    expect(res).not.toContain("create_resource");
    expect(res).not.toContain("protects its people");
    expect(res).toContain(RESOURCES_HIDDEN_INSTRUCTION);
    expect(RESOURCES_HIDDEN_INSTRUCTION).not.toMatch(/stakeholder/i);
    expect(res).not.toContain(STAKEHOLDERS_HIDDEN_INSTRUCTION);
    const stk = text({ stakeholdersHidden: true });
    expect(stk).toContain(STAKEHOLDERS_HIDDEN_INSTRUCTION);
    expect(stk).toContain("create_resource");
    expect(stk).not.toContain(RESOURCES_HIDDEN_INSTRUCTION);
    expect(STAKEHOLDERS_HIDDEN_INSTRUCTION).not.toMatch(/Resources/);
    // Nothing hidden: neither line, so the shown prompt is as before.
    const open = text({});
    expect(open).not.toContain(STAKEHOLDERS_HIDDEN_INSTRUCTION);
    expect(open).not.toContain(RESOURCES_HIDDEN_INSTRUCTION);
  });

  it("the fixed prompt lines name stakeholders and people/resources only while their tools are offered", () => {
    const text = (flags: ToolFlags) => buildStableSystemBlocks("en-US", OFF_SNAPSHOT, [], false, { ...OPEN, ...flags })[0]!.text;
    const open = text({});
    expect(open).toContain("change-control items, milestones, and stakeholders via their list_/create_/update_/delete_ tools");
    expect(open).toContain("(tasks, risks, milestones, stakeholders, people/resources)");
    const stk = text({ stakeholdersHidden: true });
    expect(stk).toContain("change-control items, and milestones via their list_/create_/update_/delete_ tools");
    expect(stk).toContain("(tasks, risks, milestones, people/resources)");
    const res = text({ resourcesHidden: true });
    expect(res).toContain("and stakeholders via their");
    expect(res).toContain("(tasks, risks, milestones, stakeholders)");
    const both = text({ resourcesHidden: true, stakeholdersHidden: true });
    expect(both).toContain("(tasks, risks, milestones)");
    expect(both).not.toMatch(/and stakeholders via|people\/resources/);
  });

  function hiddenDispatcher(hidden: { resources?: boolean; stakeholders?: boolean }): { d: ToolDispatcher; calls: string[] } {
    const calls: string[] = [];
    const d = new Proxy({} as Record<string, unknown>, {
      get(_t, prop: string) {
        if (prop === "isPeopleProtected") return () => false;
        if (prop === "isResourcesHidden") return () => hidden.resources === true;
        if (prop === "isStakeholdersHidden") return () => hidden.stakeholders === true;
        if (prop === "then") return undefined;
        return vi.fn(() => { calls.push(prop); return []; });
      },
    }) as unknown as ToolDispatcher;
    return { d, calls };
  }
  const ARGS = { id: 1, firstName: "A", lastName: "B", name: "X", query: "x", taskId: 1, recipient: "A" };

  it("the executor refuses every Resources tool while Resources is hidden, naming Resources, and touches no state", async () => {
    for (const name of RESOURCES_TOOLS) {
      const { d, calls } = hiddenDispatcher({ resources: true });
      await expect(runTool(d, name, ARGS), name).rejects.toThrow(RESOURCES_HIDDEN_TOOL_REFUSAL);
      expect(calls, name).toEqual([]);
    }
    expect(RESOURCES_HIDDEN_TOOL_REFUSAL).toMatch(/Resources/);
    expect(RESOURCES_HIDDEN_TOOL_REFUSAL).not.toMatch(/stakeholder|history|chat search/i);
  });

  it("the executor refuses every stakeholder tool while Stakeholders is hidden, naming Stakeholders", async () => {
    for (const name of STAKEHOLDER_TOOLS) {
      const { d, calls } = hiddenDispatcher({ stakeholders: true });
      const err = await runTool(d, name, ARGS).then(() => null, (e: unknown) => e);
      expect(err, name).toBeInstanceOf(PeopleToolRefusedError);
      expect((err as Error).message, name).toBe(STAKEHOLDERS_HIDDEN_TOOL_REFUSAL);
      expect(calls, name).toEqual([]);
    }
    expect(STAKEHOLDERS_HIDDEN_TOOL_REFUSAL).toMatch(/Stakeholders/);
    expect(STAKEHOLDERS_HIDDEN_TOOL_REFUSAL).not.toMatch(/Resources/);
  });

  it("get_contact_email refuses a stakeholder while Stakeholders is hidden, and serves a task assignee", async () => {
    const hidden = hiddenDispatcher({ stakeholders: true });
    const err = await runTool(hidden.d, "get_contact_email", { entity: "stakeholder", id: 1 }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(PeopleToolRefusedError);
    expect((err as Error).message).toBe(STAKEHOLDERS_HIDDEN_TOOL_REFUSAL);
    expect(hidden.calls).toEqual([]);
    await runTool(hidden.d, "get_contact_email", { entity: "task", id: 1 });
    expect(hidden.calls).toEqual(["getTask"]);
    // CONTROL: Stakeholders shown, the stakeholder's address is read.
    const shown = hiddenDispatcher({});
    await runTool(shown.d, "get_contact_email", { entity: "stakeholder", id: 1 });
    expect(shown.calls).toEqual(["getStakeholderRow"]);
  });

  it("Resources hidden alone does not refuse a stakeholder tool", async () => {
    const { d, calls } = hiddenDispatcher({ resources: true });
    await runTool(d, "list_stakeholders", {});
    expect(calls).toContain("listStakeholders");
  });

  it("Simple mode (both hidden) still serves search, chat search, the inquiry and the escalation", async () => {
    for (const name of NEVER_BY_A_FUNCTION) {
      const { d, calls } = hiddenDispatcher({ resources: true, stakeholders: true });
      const err = await runTool(d, name, ARGS).then(() => null, (e: unknown) => e);
      expect(err instanceof PeopleToolRefusedError, name).toBe(false);
      expect(calls.length, name).toBeGreaterThan(0);
    }
  });

  it("CONTROL: the same dispatcher with both functions shown serves a Resources and a stakeholder tool", async () => {
    const { d, calls } = hiddenDispatcher({});
    await runTool(d, "list_resources", {});
    await runTool(d, "list_stakeholders", {});
    expect(calls).toEqual(expect.arrayContaining(["listResources", "listStakeholders"]));
  });

  it("a non-people tool is still served while both functions are hidden", async () => {
    const { d, calls } = hiddenDispatcher({ resources: true, stakeholders: true });
    await runTool(d, "list_tasks", {});
    expect(calls).toContain("listTasks");
  });
});
