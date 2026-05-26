import { describe, expect, test } from "vitest";
import { emptyWorkspace, migrateWorkspaceV6, type Workspace } from "./storage";

describe("v6 migration", () => {
  test("emptyWorkspace has budgets [] and fxRates null", () => {
    const ws = emptyWorkspace();
    expect(ws.budgets).toEqual([]);
    expect(ws.fxRates).toBeNull();
  });
  test("migrate adds missing budget fields and is idempotent", () => {
    const legacy = { ...emptyWorkspace() } as Partial<Workspace>;
    delete (legacy as Record<string, unknown>).budgets;
    delete (legacy as Record<string, unknown>).fxRates;
    const once = migrateWorkspaceV6(legacy as Workspace);
    expect(once.budgets).toEqual([]);
    expect(once.fxRates).toBeNull();
    const twice = migrateWorkspaceV6(once);
    expect(twice.budgets).toBe(once.budgets); // unchanged reference
  });
});
