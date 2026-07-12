import { describe, it, expect, beforeEach } from "vitest";
import { localLearningStore } from "./learning-store-local";

beforeEach(() => localStorage.clear());

describe("localLearningStore", () => {
  it("round-trips a snapshot", async () => {
    const store = localLearningStore();
    await store.save({ state: { k: { acted: 2, snoozed: 1, dismissed: 0, lastAt: 5 } }, overrides: { k: "surface" } });
    expect(await store.load()).toEqual({ state: { k: { acted: 2, snoozed: 1, dismissed: 0, lastAt: 5 } }, overrides: { k: "surface" } });
  });
  it("returns empty on missing/malformed data", async () => {
    expect(await localLearningStore().load()).toEqual({ state: {}, overrides: {} });
    localStorage.setItem("aipm-cockpit:action-learning", "{not json");
    expect(await localLearningStore().load()).toEqual({ state: {}, overrides: {} });
  });
});
