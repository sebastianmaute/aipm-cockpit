// src/app/operating-guide-store.test.ts
vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn(async () => []) }));
import { runTursoPipeline } from "./turso-pipeline";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadGuides, saveGuide, removeGuide, LOCAL_KEY } from "./operating-guide-store";
import type { OperatingGuide } from "./operating-guide";
import type { TursoConfig } from "./turso-config";

const g: OperatingGuide = {
  id: "a", name: "N", content: "C", enabled: true, priority: 2, scope: {}, builtIn: false,
};

describe("operating-guide-store (localStorage path, config=null)", () => {
  beforeEach(() => localStorage.clear());
  it("returns [] when empty", async () => {
    expect(await loadGuides(null)).toEqual([]);
  });
  it("saves then loads a guide", async () => {
    await saveGuide(null, g);
    const out = await loadGuides(null);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a", priority: 2 });
  });
  it("upsert replaces by id", async () => {
    await saveGuide(null, g);
    await saveGuide(null, { ...g, name: "N2" });
    const out = await loadGuides(null);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("N2");
  });
  it("remove deletes by id", async () => {
    await saveGuide(null, g);
    await removeGuide(null, "a");
    expect(await loadGuides(null)).toEqual([]);
  });
  it("uses the namespaced localStorage key", async () => {
    await saveGuide(null, g);
    expect(localStorage.getItem(LOCAL_KEY)).not.toBeNull();
  });
});

const cfg = { databaseUrl: "libsql://x", authToken: "t" } as unknown as TursoConfig;

describe("operating-guide-store (Turso path, config!=null)", () => {
  beforeEach(() => { (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mockReset(); });

  it("loadGuides runs DDL + SELECT and decodes rows", async () => {
    (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { type: "ok" as const }, // DDL result
      {
        type: "ok" as const,
        response: { type: "resultsOk", result: {
          cols: [{ name: "id" }, { name: "name" }, { name: "content" }, { name: "enabled" },
                 { name: "priority" }, { name: "scope" }, { name: "built_in" }],
          rows: [[{ value: "a" }, { value: "N" }, { value: "C" }, { value: "1" },
                 { value: "5" }, { value: JSON.stringify({ modes: ["advanced"] }) }, { value: "0" }]],
        } },
      },
    ]);
    const out = await loadGuides(cfg);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a", name: "N", priority: 5, enabled: true, builtIn: false });
    expect(out[0].scope).toEqual({ modes: ["advanced"] });
  });

  it("saveGuide issues DDL + an upsert carrying all 9 column args", async () => {
    await saveGuide(cfg, { id: "a", name: "N", content: "C", enabled: true, priority: 2, scope: {}, builtIn: false });
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    const upsert = stmts[stmts.length - 1];
    expect(upsert.sql).toMatch(/INSERT INTO operating_guides/);
    expect(upsert.args).toHaveLength(9);
  });

  it("removeGuide issues DDL + a delete by id", async () => {
    await removeGuide(cfg, "a");
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    const del = stmts[stmts.length - 1];
    expect(del.sql).toMatch(/DELETE FROM operating_guides WHERE id = \?/);
    expect(del.args?.[0]?.value).toBe("a");
  });
});
