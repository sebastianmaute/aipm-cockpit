import { beforeEach, describe, expect, it } from "vitest";
import {
  TIMELOG_PICKER_MAX_PROJECTS,
  clearPickerScope,
  loadPickerScope,
  savePickerScope,
} from "./timelog-picker-store";

const KEY = "aipm-cockpit:timelog-picker";

describe("timelog-picker-store", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips a scope for a project", () => {
    savePickerScope("p1", { customerId: 7, projectIds: [1, 2] });
    expect(loadPickerScope("p1")).toEqual({ customerId: 7, projectIds: [1, 2] });
  });

  it("keeps projects isolated from each other", () => {
    savePickerScope("p1", { customerId: 7, projectIds: [1] });
    savePickerScope("p2", { customerId: 9, projectIds: [2] });
    expect(loadPickerScope("p1").customerId).toBe(7);
    expect(loadPickerScope("p2").customerId).toBe(9);
  });

  it("returns an empty scope for an unknown project", () => {
    expect(loadPickerScope("nope")).toEqual({});
  });

  it("does not leak the internal ordering field to callers", () => {
    savePickerScope("p1", { customerId: 7 });
    expect("seq" in loadPickerScope("p1")).toBe(false);
  });

  it("falls back to an empty scope on malformed JSON", () => {
    window.localStorage.setItem(KEY, "{ not json");
    expect(loadPickerScope("p1")).toEqual({});
  });

  it("drops entries whose shape is wrong, keeping valid siblings", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ bad: { customerId: "seven" }, good: { customerId: 7 } }),
    );
    expect(loadPickerScope("bad")).toEqual({});
    expect(loadPickerScope("good").customerId).toBe(7);
  });

  it("rejects a projectIds array containing non-numbers", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ p1: { projectIds: [1, "2"] } }));
    expect(loadPickerScope("p1")).toEqual({});
  });

  it("caps stored projects, evicting the least-recently-saved", () => {
    for (let i = 0; i < TIMELOG_PICKER_MAX_PROJECTS + 5; i++) {
      savePickerScope(`p${i}`, { customerId: i });
    }
    // p0..p4 evicted; p5 onward retained.
    expect(loadPickerScope("p0")).toEqual({});
    expect(loadPickerScope("p4")).toEqual({});
    expect(loadPickerScope("p5").customerId).toBe(5);
    expect(loadPickerScope(`p${TIMELOG_PICKER_MAX_PROJECTS + 4}`).customerId).toBe(
      TIMELOG_PICKER_MAX_PROJECTS + 4,
    );
  });

  it("re-saving an old project keeps it alive through eviction", () => {
    savePickerScope("keepme", { customerId: 1 });
    for (let i = 0; i < TIMELOG_PICKER_MAX_PROJECTS - 1; i++) {
      savePickerScope(`p${i}`, { customerId: i });
    }
    savePickerScope("keepme", { customerId: 2 }); // touch → newest
    savePickerScope("overflow", { customerId: 99 });
    expect(loadPickerScope("keepme").customerId).toBe(2);
  });

  it("clears every stored scope", () => {
    savePickerScope("p1", { customerId: 7 });
    clearPickerScope();
    expect(loadPickerScope("p1")).toEqual({});
  });
});
