// src/app/operating-guide-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadGuides, saveGuide, removeGuide, LOCAL_KEY } from "./operating-guide-store";
import type { OperatingGuide } from "./operating-guide";

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
