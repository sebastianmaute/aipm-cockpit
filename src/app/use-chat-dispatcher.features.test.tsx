// §779 — Claude's `update_settings { enabledModules }` must switch the PROJECT's functions, the slice the
// panels' `onCommitFeatures` writes and Edit project reads (`Workspace.features`), not only the settings
// mirror the navigation reads. Writing only the mirror left the two disagreeing: Edit project then showed
// the saved list, and saving it reverted Claude's change; the next project load overwrote it as well.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useWorkspace } from "./workspace-context";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";
import type { Settings } from "./settings-types";
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

  it("a read-only window (a popout) refuses and writes nothing", () => {
    const { hook, setSettings } = renderWithWorkspace(true);
    expect(() => hook.result.current.dispatcher.updateSettings({ enabledModules: LEAN })).toThrow();
    expect(hook.result.current.ws.features).toBeUndefined();
    expect(setSettings).not.toHaveBeenCalled();
  });
});
