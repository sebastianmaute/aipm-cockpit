// §779 — Claude's `update_settings { enabledModules }` must switch the PROJECT's functions, the slice the
// panels' `onCommitFeatures` writes and Edit project reads (`Workspace.features`), not only the settings
// mirror the navigation reads. Writing only the mirror left the two disagreeing: Edit project then showed
// the saved list, and saving it reverted Claude's change; the next project load overwrote it as well.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useWorkspace } from "./workspace-context";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";
import { defaultSettings, resolveNextActionsConfig, type Settings } from "./settings-types";
import { dispatcherWrapper, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";

const LEAN: FeatureModuleId[] = ["dashboard", "milestones", "raid"];

function renderWithWorkspace(isReadOnly = false) {
  const setSettings = vi.fn();
  const logActivityAs = vi.fn();
  const hook = renderHook(
    () => ({
      dispatcher: useChatDispatcher(makeDispatcherArgs({ setSettings, logActivityAs, isReadOnly })),
      ws: useWorkspace(),
    }),
    { wrapper: dispatcherWrapper() },
  );
  /** What the navigation reads: the settings mirror after every functional update the tool queued. */
  const mirror = (start: Settings) =>
    setSettings.mock.calls.reduce((s, [u]) => (typeof u === "function" ? (u as (p: Settings) => Settings)(s) : (u as Settings)), start);
  return { hook, setSettings, logActivityAs, mirror };
}

describe("useChatDispatcher — update_settings { enabledModules } writes the project's functions (§779)", () => {
  // Mutation: dropping the `setFeatures` call in `updateSettings` turns this red (the workspace keeps
  // its unset value while the mirror moves).
  it("the project's saved functions and the navigation's mirror agree after the call", () => {
    const { hook, mirror } = renderWithWorkspace();
    expect(hook.result.current.ws.features).toBeUndefined();
    let applied: Record<string, unknown> = {};
    act(() => { applied = hook.result.current.dispatcher.updateSettings({ enabledModules: LEAN }); });
    expect(applied).toEqual({ enabledModules: LEAN });
    expect(hook.result.current.ws.features).toEqual(LEAN);
    const start = { features: [...ALL_MODULE_IDS] } as unknown as Settings;
    expect(mirror(start).features).toEqual(LEAN);
  });

  it("logs one settings.updated row, as before", () => {
    const { hook, logActivityAs } = renderWithWorkspace();
    act(() => { hook.result.current.dispatcher.updateSettings({ enabledModules: LEAN }); });
    expect(logActivityAs).toHaveBeenCalledTimes(1);
    expect(logActivityAs).toHaveBeenCalledWith("ai", "settings.updated");
  });

  it("a patch without enabledModules leaves the project's functions alone", () => {
    const { hook } = renderWithWorkspace();
    act(() => { hook.result.current.ws.setFeatures(LEAN); });
    act(() => { hook.result.current.dispatcher.updateSettings({ showViewHints: false }); });
    expect(hook.result.current.ws.features).toEqual(LEAN);
  });

  // Mutation: removing the refusal in `computeSettingsPatch` turns this red (a different error, or with
  // both refusals gone a sanitised [] that switches every function off).
  it("a non-array enabledModules is refused and writes nothing", () => {
    const { hook, setSettings, logActivityAs } = renderWithWorkspace();
    act(() => { hook.result.current.ws.setFeatures(LEAN); });
    expect(() => hook.result.current.dispatcher.updateSettings({ enabledModules: "raid" })).toThrow(
      "enabledModules must be a list of module ids",
    );
    expect(hook.result.current.ws.features).toEqual(LEAN);
    expect(setSettings).not.toHaveBeenCalled();
    expect(logActivityAs).not.toHaveBeenCalled();
  });

  it("a read-only window (a popout) refuses and writes nothing", () => {
    const { hook, setSettings } = renderWithWorkspace(true);
    expect(() => hook.result.current.dispatcher.updateSettings({ enabledModules: LEAN })).toThrow();
    expect(hook.result.current.ws.features).toBeUndefined();
    expect(setSettings).not.toHaveBeenCalled();
  });
});

describe("useChatDispatcher — previewSettings (§779)", () => {
  // Mutation: computing the preview against `defaultSettings` instead of `settingsRef.current` turns
  // this red (5, the default, instead of the user's 9). The card's "Also sets" line reads this.
  it("reports what updateSettings would apply, against the live settings, and writes nothing", () => {
    const setSettings = vi.fn();
    const logActivityAs = vi.fn();
    const settings: Settings = {
      ...defaultSettings,
      nextActions: { ...resolveNextActionsConfig(undefined), scopePendingRed: 9 },
    };
    const { result } = renderHook(
      () => useChatDispatcher(makeDispatcherArgs({ settings, setSettings, logActivityAs })),
      { wrapper: dispatcherWrapper() },
    );
    const preview = result.current.previewSettings({ nextActionsWeights: { scopePendingRed: "junk" }, showViewHints: false });
    expect(preview).toEqual({ showViewHints: false, nextActionsWeights: { scopePendingRed: 9 } });
    expect(setSettings).not.toHaveBeenCalled();
    expect(logActivityAs).not.toHaveBeenCalled();
  });
});

describe("useChatDispatcher — get_app_state reports the project's saved functions (§779)", () => {
  // Mutation: reading `settingsRef.current.features` (the mirror) again turns this red: the fixture's
  // mirror is `defaultSettings`, every function on, while the project saved LEAN.
  it("enabledModules and mode come from Workspace.features, not the settings mirror", () => {
    const { hook } = renderWithWorkspace();
    act(() => { hook.result.current.ws.setFeatures(LEAN); });
    const snap = hook.result.current.dispatcher.getSnapshot();
    expect(snap.enabledModules).toEqual(LEAN);
    expect(snap.mode).toBe("modular");
  });

  it("a project with no saved list reports every function on", () => {
    const { hook } = renderWithWorkspace();
    expect(hook.result.current.dispatcher.getSnapshot().enabledModules).toEqual([...ALL_MODULE_IDS]);
  });

  // Mutation: dropping the synchronous ref write in `updateSettings` turns this red (the snapshot read in
  // the same tick still sees the old list).
  it("a get_app_state right after the write, in the same tick, sees the new list", () => {
    const { hook } = renderWithWorkspace();
    let snap: ReturnType<typeof hook.result.current.dispatcher.getSnapshot> | undefined;
    act(() => {
      hook.result.current.dispatcher.updateSettings({ enabledModules: LEAN });
      snap = hook.result.current.dispatcher.getSnapshot();
    });
    expect(snap?.enabledModules).toEqual(LEAN);
  });
});
