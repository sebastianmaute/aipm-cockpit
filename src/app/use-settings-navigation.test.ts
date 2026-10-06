// Pins useSettingsNavigation (use-settings-navigation.ts, §491): "open
// settings" requests routed by layout. The modern layout navigates to the
// Settings view, with a sectioned request carrying a monotonic nonce; the
// classic layout opens the header popover, whose open state is cleared during
// render when the layout leaves classic. `setActiveTab` is a mock.
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettingsNavigation, type SettingsNavigationDeps } from "./use-settings-navigation";

function makeDeps(over: Partial<SettingsNavigationDeps> = {}): SettingsNavigationDeps {
  return { layout: "modern", setActiveTab: vi.fn(), ...over };
}

describe("useSettingsNavigation — modern layout", () => {
  it("a sectioned request navigates to Settings and carries the section and a fresh nonce", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    expect(result.current.isClassicLayout).toBe(false);
    expect(result.current.settingsSectionRequest).toBeUndefined();

    act(() => result.current.onOpenSettingsSection("ai"));
    expect(deps.setActiveTab).toHaveBeenCalledWith("settings");
    expect(result.current.settingsSectionRequest).toEqual({ id: "ai", nonce: 1 });
    expect(result.current.classicSettingsOpen).toBe(false);

    act(() => result.current.onOpenSettingsSection("ai"));
    expect(result.current.settingsSectionRequest).toEqual({ id: "ai", nonce: 2 });
  });

  it("the nonce is never reset: a request after the previous one was consumed is still distinct", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    act(() => result.current.onOpenSettingsSection("jira"));
    act(() => result.current.clearSettingsSectionRequest());
    expect(result.current.settingsSectionRequest).toBeUndefined();
    act(() => result.current.onOpenSettingsSection("jira"));
    expect(result.current.settingsSectionRequest).toEqual({ id: "jira", nonce: 2 });
  });

  it("the learning deep link targets the Next-actions section", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    act(() => result.current.onOpenLearningSettings());
    expect(result.current.settingsSectionRequest).toEqual({ id: "nextActions", nonce: 1 });
    expect(deps.setActiveTab).toHaveBeenCalledWith("settings");
  });

  it("the un-sectioned request navigates to Settings without a section request", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    act(() => result.current.onOpenSettings());
    expect(deps.setActiveTab).toHaveBeenCalledWith("settings");
    expect(result.current.settingsSectionRequest).toBeUndefined();
    expect(result.current.classicSettingsOpen).toBe(false);
  });
});

describe("useSettingsNavigation — classic layout", () => {
  it("a sectioned request opens the popover instead: no navigation, no section request", () => {
    const deps = makeDeps({ layout: "classic" });
    const { result } = renderHook(() => useSettingsNavigation(deps));
    expect(result.current.isClassicLayout).toBe(true);
    act(() => result.current.onOpenSettingsSection("storage"));
    expect(result.current.classicSettingsOpen).toBe(true);
    expect(deps.setActiveTab).not.toHaveBeenCalled();
    expect(result.current.settingsSectionRequest).toBeUndefined();
  });

  it("the un-sectioned request opens the popover too", () => {
    const deps = makeDeps({ layout: "classic" });
    const { result } = renderHook(() => useSettingsNavigation(deps));
    act(() => result.current.onOpenSettings());
    expect(result.current.classicSettingsOpen).toBe(true);
    expect(deps.setActiveTab).not.toHaveBeenCalled();
  });

  it("the popover's own setter opens and closes it, and it stays open across a classic rerender", () => {
    const deps = makeDeps({ layout: "classic" });
    const { result, rerender } = renderHook((d: SettingsNavigationDeps) => useSettingsNavigation(d), { initialProps: deps });
    act(() => result.current.setClassicSettingsOpen(true));
    rerender({ ...deps });
    expect(result.current.classicSettingsOpen).toBe(true);
    act(() => result.current.setClassicSettingsOpen(false));
    expect(result.current.classicSettingsOpen).toBe(false);
  });

  it("leaving classic clears the open popover, so switching back does not reopen it", () => {
    const deps = makeDeps({ layout: "classic" });
    const { result, rerender } = renderHook((d: SettingsNavigationDeps) => useSettingsNavigation(d), { initialProps: deps });
    act(() => result.current.onOpenSettings());
    expect(result.current.classicSettingsOpen).toBe(true);

    rerender({ ...deps, layout: "modern" });
    expect(result.current.isClassicLayout).toBe(false);
    expect(result.current.classicSettingsOpen).toBe(false);

    rerender({ ...deps, layout: "classic" });
    expect(result.current.classicSettingsOpen).toBe(false);
  });
});

describe("useSettingsNavigation — the handlers follow a deps change", () => {
  // The handlers are memoized, so each must re-read the layout and the setter
  // after a rerender rather than keep the ones it closed over first.
  it("classic → modern: both requests navigate, and no popover opens", () => {
    const deps = makeDeps({ layout: "classic" });
    const { result, rerender } = renderHook((d: SettingsNavigationDeps) => useSettingsNavigation(d), { initialProps: deps });
    rerender({ ...deps, layout: "modern" });

    act(() => result.current.onOpenSettings());
    expect(deps.setActiveTab).toHaveBeenCalledTimes(1);
    expect(deps.setActiveTab).toHaveBeenLastCalledWith("settings");
    expect(result.current.classicSettingsOpen).toBe(false);

    act(() => result.current.onOpenSettingsSection("ai"));
    expect(deps.setActiveTab).toHaveBeenCalledTimes(2);
    expect(result.current.settingsSectionRequest).toEqual({ id: "ai", nonce: 1 });
    expect(result.current.classicSettingsOpen).toBe(false);
  });

  it("modern → classic: both requests open the popover, and nothing navigates", () => {
    const deps = makeDeps({ layout: "modern" });
    const { result, rerender } = renderHook((d: SettingsNavigationDeps) => useSettingsNavigation(d), { initialProps: deps });
    rerender({ ...deps, layout: "classic" });

    act(() => result.current.onOpenSettings());
    expect(result.current.classicSettingsOpen).toBe(true);
    act(() => result.current.setClassicSettingsOpen(false));
    act(() => result.current.onOpenSettingsSection("ai"));
    expect(result.current.classicSettingsOpen).toBe(true);
    expect(result.current.settingsSectionRequest).toBeUndefined();
    expect(deps.setActiveTab).not.toHaveBeenCalled();
  });

  it("a new setActiveTab is the one both requests call", () => {
    const deps = makeDeps();
    const { result, rerender } = renderHook((d: SettingsNavigationDeps) => useSettingsNavigation(d), { initialProps: deps });
    const next = vi.fn();
    rerender({ ...deps, setActiveTab: next });
    act(() => result.current.onOpenSettings());
    act(() => result.current.onOpenSettingsSection("jira"));
    expect(next).toHaveBeenCalledTimes(2);
    expect(deps.setActiveTab).not.toHaveBeenCalled();
  });
});

describe("useSettingsNavigation — identity", () => {
  it("keeps the handlers stable across a rerender with the same deps", () => {
    const deps = makeDeps();
    const { result, rerender } = renderHook((d: SettingsNavigationDeps) => useSettingsNavigation(d), { initialProps: deps });
    const first = result.current;
    rerender({ ...deps });
    expect(result.current.onOpenSettingsSection).toBe(first.onOpenSettingsSection);
    expect(result.current.onOpenSettings).toBe(first.onOpenSettings);
    expect(result.current.onOpenLearningSettings).toBe(first.onOpenLearningSettings);
    expect(result.current.clearSettingsSectionRequest).toBe(first.clearSettingsSectionRequest);
  });

  it("keeps the consume callback stable even when a request lands", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    const clear = result.current.clearSettingsSectionRequest;
    act(() => result.current.onOpenSettingsSection("general"));
    expect(result.current.clearSettingsSectionRequest).toBe(clear);
  });
});
