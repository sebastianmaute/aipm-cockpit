import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTour } from "./use-tour";
import { TOUR_STEPS, visibleSteps, findTour } from "./app-tour";
import { ALL_MODULE_IDS } from "./feature-modules";

const FEATURES = ["dashboard", "milestones", "resources", "raid", "changes", "stakeholders", "budget"] as const;
const base = { features: [...FEATURES] };

describe("useTour", () => {
  it("useTour drops Turso-only steps on file", () => {
    const mk = (storageKind: string) => renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, completedTours: undefined, features: [...ALL_MODULE_IDS], storageKind, setSettings: vi.fn() }));
    const file = mk("file");
    const turso = mk("turso");
    const count = (r: typeof file) => r.result.current.catalogTours.find((t) => t.id === "reporting")!.stepCount;
    expect(count(turso) - count(file)).toBe(2);
  });
  it("start() under turso yields two more steps than under file", () => {
    const mk = (storageKind: string) => renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, completedTours: undefined, features: [...ALL_MODULE_IDS], storageKind, setSettings: vi.fn() }));
    const file = mk("file");
    const turso = mk("turso");
    act(() => { file.result.current.start("reporting"); });
    act(() => { turso.result.current.start("reporting"); });
    expect(turso.result.current.steps.length - file.result.current.steps.length).toBe(2);
  });
  it("auto-launches getting-started once in modern, non-popout, unseen", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: false, completedTours: undefined, ...base, setSettings }));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.index).toBe(0);
    expect(result.current.steps.length).toBe(TOUR_STEPS.length);
  });
  it("does NOT auto-launch in classic / popout / when seen / before hydration", () => {
    const setSettings = vi.fn();
    for (const args of [
      { layout: "classic" as const, isPopout: false, hydrated: true, tourSeen: false },
      { layout: "modern" as const, isPopout: true, hydrated: true, tourSeen: false },
      { layout: "modern" as const, isPopout: false, hydrated: true, tourSeen: true },
      { layout: "modern" as const, isPopout: false, hydrated: false, tourSeen: false },
    ]) {
      const { result } = renderHook(() => useTour({ ...args, completedTours: undefined, ...base, setSettings }));
      expect(result.current.isOpen).toBe(false);
    }
  });
  it("start(id) activates a themed tour at index 0", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, completedTours: undefined, ...base, setSettings }));
    act(() => { result.current.start("raid"); });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.index).toBe(0);
    expect(result.current.steps.length).toBe(findTour("raid")!.steps.length);
    expect(result.current.activeTourTitleKey).toBe("tourRaidTitle");
  });
  it("done appends the active tour id to completedTours and sets tourSeen", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, completedTours: ["raid"], ...base, setSettings }));
    act(() => { result.current.start("reporting"); });
    act(() => { result.current.done(); });
    expect(result.current.isOpen).toBe(false);
    const updater = setSettings.mock.calls.at(-1)![0];
    const out = updater({ tourSeen: false, completedTours: ["raid"] });
    expect(out.tourSeen).toBe(true);
    expect(out.completedTours).toEqual(["raid", "reporting"]);
  });
  it("skip sets tourSeen only (no completion badge)", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: false, completedTours: undefined, ...base, setSettings }));
    act(() => { result.current.skip(); });
    const updater = setSettings.mock.calls.at(-1)![0];
    const out = updater({ tourSeen: false, completedTours: ["raid"] });
    expect(out.tourSeen).toBe(true);
    expect(out.completedTours).toEqual(["raid"]); // unchanged
  });
  it("catalogTours lists tours with >=1 visible step; completedTours passes through", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, completedTours: ["ai"], ...base, setSettings }));
    expect(result.current.catalogTours.map((t) => t.id)).toEqual(["getting-started", "working-faster", "raid", "reporting", "planning", "stakeholders", "resources", "budget-changes", "documents", "ai", "help-yourself"]);
    expect(result.current.completedTours).toEqual(["ai"]);
  });
  it("catalogTours drops a tour gated to 0 visible steps", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, completedTours: undefined, features: [], setSettings }));
    // raid deep-links only a module-gated view -> dropped. reporting and ai keep their
    // core-view steps (reports, chat, settings) so they survive; getting-started
    // survives on its no-view "welcome" step plus core views.
    expect(result.current.catalogTours.some((t) => t.id === "raid")).toBe(false);
    expect(result.current.catalogTours.some((t) => t.id === "getting-started")).toBe(true);
  });
  it("next/back clamp within the visible steps", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, completedTours: undefined, ...base, setSettings }));
    act(() => { result.current.start(); });
    act(() => { result.current.back(); });
    expect(result.current.index).toBe(0);
    const last = visibleSteps(TOUR_STEPS, [...FEATURES]).length - 1;
    for (let k = 0; k < 50; k++) act(() => { result.current.next(); });
    expect(result.current.index).toBe(last);
  });
});
