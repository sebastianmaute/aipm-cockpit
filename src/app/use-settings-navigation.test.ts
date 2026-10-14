// Pins useSettingsNavigation (use-settings-navigation.ts, §491): "open
// settings" requests routed by layout. The modern layout navigates to the
// Settings view, with a sectioned request carrying a monotonic nonce; the
// classic layout opens the header popover, whose open state is cleared during
// render when the layout leaves classic. `setActiveTab` is a mock.
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettingsNavigation, type SettingsNavigationDeps } from "./use-settings-navigation";

function makeDeps(over: Partial<SettingsNavigationDeps> = {}): SettingsNavigationDeps {
  return { layout: "modern", setActiveTab: vi.fn(), isPopout: false, ...over };
}

describe("useSettingsNavigation — modern layout", () => {
  it("a sectioned request navigates to Settings and carries the section and a fresh nonce", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    expect(result.current.sectionProps.requestSection).toBeUndefined();

    act(() => result.current.onOpenSettingsSection("ai"));
    expect(deps.setActiveTab).toHaveBeenCalledWith("settings");
    expect(result.current.sectionProps.requestSection).toEqual({ id: "ai", nonce: 1 });
    expect(result.current.classicMenu.settingsMenuOpen).toBe(false);

    act(() => result.current.onOpenSettingsSection("ai"));
    expect(result.current.sectionProps.requestSection).toEqual({ id: "ai", nonce: 2 });
  });

  it("the nonce is never reset: a request after the previous one was consumed is still distinct", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    act(() => result.current.onOpenSettingsSection("jira"));
    act(() => result.current.sectionProps.onSectionConsumed());
    expect(result.current.sectionProps.requestSection).toBeUndefined();
    act(() => result.current.onOpenSettingsSection("jira"));
    expect(result.current.sectionProps.requestSection).toEqual({ id: "jira", nonce: 2 });
  });

  it("the learning deep link targets the Next-actions section", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    act(() => result.current.workspaceNav.onOpenLearningSettings());
    expect(result.current.sectionProps.requestSection).toEqual({ id: "nextActions", nonce: 1 });
    expect(deps.setActiveTab).toHaveBeenCalledWith("settings");
  });

  it("the un-sectioned request navigates to Settings without a section request", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    act(() => result.current.onOpenSettings());
    expect(deps.setActiveTab).toHaveBeenCalledWith("settings");
    expect(result.current.sectionProps.requestSection).toBeUndefined();
    expect(result.current.classicMenu.settingsMenuOpen).toBe(false);
  });
});

describe("useSettingsNavigation — classic layout", () => {
  it("a sectioned request opens the popover instead: no navigation, no section request", () => {
    const deps = makeDeps({ layout: "classic" });
    const { result } = renderHook(() => useSettingsNavigation(deps));
    act(() => result.current.onOpenSettingsSection("storage"));
    expect(result.current.classicMenu.settingsMenuOpen).toBe(true);
    expect(deps.setActiveTab).not.toHaveBeenCalled();
    expect(result.current.sectionProps.requestSection).toBeUndefined();
  });

  it("the un-sectioned request opens the popover too", () => {
    const deps = makeDeps({ layout: "classic" });
    const { result } = renderHook(() => useSettingsNavigation(deps));
    act(() => result.current.onOpenSettings());
    expect(result.current.classicMenu.settingsMenuOpen).toBe(true);
    expect(deps.setActiveTab).not.toHaveBeenCalled();
  });

  it("the popover's own setter opens and closes it, and it stays open across a classic rerender", () => {
    const deps = makeDeps({ layout: "classic" });
    const { result, rerender } = renderHook((d: SettingsNavigationDeps) => useSettingsNavigation(d), { initialProps: deps });
    act(() => result.current.classicMenu.onSettingsMenuOpenChange(true));
    rerender({ ...deps });
    expect(result.current.classicMenu.settingsMenuOpen).toBe(true);
    act(() => result.current.classicMenu.onSettingsMenuOpenChange(false));
    expect(result.current.classicMenu.settingsMenuOpen).toBe(false);
  });

  it("leaving classic clears the open popover, so switching back does not reopen it", () => {
    const deps = makeDeps({ layout: "classic" });
    const { result, rerender } = renderHook((d: SettingsNavigationDeps) => useSettingsNavigation(d), { initialProps: deps });
    act(() => result.current.onOpenSettings());
    expect(result.current.classicMenu.settingsMenuOpen).toBe(true);

    rerender({ ...deps, layout: "modern" });
    expect(result.current.classicMenu.settingsMenuOpen).toBe(false);

    rerender({ ...deps, layout: "classic" });
    expect(result.current.classicMenu.settingsMenuOpen).toBe(false);
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
    expect(result.current.classicMenu.settingsMenuOpen).toBe(false);

    act(() => result.current.onOpenSettingsSection("ai"));
    expect(deps.setActiveTab).toHaveBeenCalledTimes(2);
    expect(result.current.sectionProps.requestSection).toEqual({ id: "ai", nonce: 1 });
    expect(result.current.classicMenu.settingsMenuOpen).toBe(false);
  });

  it("modern → classic: both requests open the popover, and nothing navigates", () => {
    const deps = makeDeps({ layout: "modern" });
    const { result, rerender } = renderHook((d: SettingsNavigationDeps) => useSettingsNavigation(d), { initialProps: deps });
    rerender({ ...deps, layout: "classic" });

    act(() => result.current.onOpenSettings());
    expect(result.current.classicMenu.settingsMenuOpen).toBe(true);
    act(() => result.current.classicMenu.onSettingsMenuOpenChange(false));
    act(() => result.current.onOpenSettingsSection("ai"));
    expect(result.current.classicMenu.settingsMenuOpen).toBe(true);
    expect(result.current.sectionProps.requestSection).toBeUndefined();
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
    expect(result.current.workspaceNav.onOpenLearningSettings).toBe(first.workspaceNav.onOpenLearningSettings);
    expect(result.current.sectionProps.onSectionConsumed).toBe(first.sectionProps.onSectionConsumed);
  });

  it("keeps the consume callback stable even when a request lands", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    const clear = result.current.sectionProps.onSectionConsumed;
    act(() => result.current.onOpenSettingsSection("general"));
    expect(result.current.sectionProps.onSectionConsumed).toBe(clear);
  });
});

describe("useSettingsNavigation — project functions request (§706)", () => {
  it("starts with no request", () => {
    const { result } = renderHook(() => useSettingsNavigation(makeDeps()));
    expect(result.current.workspaceNav.projectFunctionsRequest).toBeNull();
  });

  it("opening switches to the projects view and bumps a monotonic request that survives being consumed", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    act(() => result.current.openProjectFunctions());
    expect(deps.setActiveTab).toHaveBeenCalledWith("projects");
    expect(result.current.workspaceNav.projectFunctionsRequest).toBe(1);
    act(() => result.current.workspaceNav.onProjectFunctionsRequestConsumed());
    expect(result.current.workspaceNav.projectFunctionsRequest).toBeNull();
    act(() => result.current.openProjectFunctions());
    expect(result.current.workspaceNav.projectFunctionsRequest).toBe(2);
  });

  it("a repeat open before the first was consumed is still a distinct value", () => {
    const { result } = renderHook(() => useSettingsNavigation(makeDeps()));
    act(() => result.current.openProjectFunctions());
    act(() => result.current.openProjectFunctions());
    expect(result.current.workspaceNav.projectFunctionsRequest).toBe(2);
  });

  it("works in the classic layout too (it only changes the view)", () => {
    const deps = makeDeps({ layout: "classic" });
    const { result } = renderHook(() => useSettingsNavigation(deps));
    act(() => result.current.openProjectFunctions());
    expect(deps.setActiveTab).toHaveBeenCalledWith("projects");
    expect(result.current.workspaceNav.projectFunctionsRequest).toBe(1);
  });
});

// B9: the bags task-manager spreads at its call sites (it has no line to spare for a destructure
// of eleven names), so each bag's members and the popout gate are pinned here.
describe("useSettingsNavigation — the prop bags task-manager spreads", () => {
  it("workspaceNav carries the section opener, the learning link and the project-functions request", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    const nav = result.current.workspaceNav;
    expect(nav.onOpenSettingsSection).toBe(result.current.onOpenSettingsSection);
    expect(typeof nav.onOpenLearningSettings).toBe("function");
    expect(nav.projectFunctionsRequest).toBeNull();
    act(() => result.current.openProjectFunctions());
    expect(result.current.workspaceNav.projectFunctionsRequest).toBe(1);
    act(() => result.current.workspaceNav.onProjectFunctionsRequestConsumed());
    expect(result.current.workspaceNav.projectFunctionsRequest).toBeNull();
  });

  it("a popout gets no section opener in its bag, yet the plain handler stays callable", () => {
    const deps = makeDeps({ isPopout: true });
    const { result } = renderHook(() => useSettingsNavigation(deps));
    expect(result.current.workspaceNav.onOpenSettingsSection).toBeUndefined();
    act(() => result.current.workspaceNav.onOpenLearningSettings());
    expect(deps.setActiveTab).toHaveBeenCalledWith("settings");
    act(() => result.current.onOpenSettingsSection("ai"));
    expect(deps.setActiveTab).toHaveBeenCalledWith("settings");
  });

  it("classicMenu is open only in the classic layout, and its setter drives it", () => {
    const deps = makeDeps({ layout: "classic" });
    const { result } = renderHook(() => useSettingsNavigation(deps));
    expect(result.current.classicMenu.settingsMenuOpen).toBe(false);
    act(() => result.current.classicMenu.onSettingsMenuOpenChange(true));
    expect(result.current.classicMenu.settingsMenuOpen).toBe(true);
  });

  it("classicMenu reads closed in the modern layout even if something asked it open", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    act(() => result.current.classicMenu.onSettingsMenuOpenChange(true));
    expect(result.current.classicMenu.settingsMenuOpen).toBe(false);
  });

  it("sectionProps hands the request and its consumer to SettingsView", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useSettingsNavigation(deps));
    expect(result.current.sectionProps.requestSection).toBeUndefined();
    act(() => result.current.onOpenSettingsSection("ai"));
    expect(result.current.sectionProps.requestSection).toEqual({ id: "ai", nonce: 1 });
    act(() => result.current.sectionProps.onSectionConsumed());
    expect(result.current.sectionProps.requestSection).toBeUndefined();
  });
});
