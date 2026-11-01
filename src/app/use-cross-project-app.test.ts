import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Resource, ResourcePlan } from "./types";
import type { TursoConfig } from "./turso-config";
import type { Workspace } from "./workspace";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadI18n, t } from "./i18n";

vi.mock("./person-links-store", () => ({
  loadPersonLinks: vi.fn(async () => []),
  savePersonLink: vi.fn(async () => undefined),
  deletePersonLink: vi.fn(async () => undefined),
  deletePersonLinksFor: vi.fn(async () => undefined),
}));
vi.mock("./turso-backend", () => ({ TursoBackend: class {} }));

import { deletePersonLinksFor, savePersonLink } from "./person-links-store";
import { useCrossProjectApp, useForgetPeopleBridge, type CrossProjectAppDeps } from "./use-cross-project-app";

const CONFIG = { httpUrl: "https://x.turso.io", authToken: "t" } as TursoConfig;
const PLAN: ResourcePlan = { startDate: "2026-11-02", endDate: "2026-11-29", granularity: "week", currency: "EUR" };
const res = (id: number, firstName: string, lastName: string): Resource => ({ id, firstName, lastName }) as Resource;
const TURSO_PROJECTS = [
  { id: "p-here", meta: { name: "Here" } },
  { id: "p-b", meta: { name: "B" } },
];
const HERE = [res(1, "Ann", "Lee")];

function setup() {
  const showToast = vi.fn();
  const load = vi.fn(async () => ({ resources: [res(10, "Ann", "Lee")], absences: [], tasks: [], plan: PLAN }) as unknown as Workspace);
  const deps: CrossProjectAppDeps = {
    tursoConfig: CONFIG, portfolioMode: "turso", tursoProjects: TURSO_PROJECTS, currentProjectId: "p-here",
    resources: HERE, plan: PLAN, workdayHours: 8, holidaySet: new Set(), loadPending: false,
    getScopeEpoch: () => 0, storageKind: "turso", lang: "en-US", showToast, load,
  };
  return { showToast, deps, hook: renderHook((p: CrossProjectAppDeps) => useCrossProjectApp(p), { initialProps: deps }) };
}

beforeEach(() => {
  vi.mocked(savePersonLink).mockReset().mockResolvedValue(undefined);
  vi.mocked(deletePersonLinksFor).mockReset().mockResolvedValue(undefined);
});

describe("useCrossProjectApp (§785)", () => {
  test("a failed Confirm shows the user a toast", async () => {
    const { hook, showToast } = setup();
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    vi.mocked(savePersonLink).mockRejectedValueOnce(new Error("db down"));
    const rel = hook.result.current.matches.get(1)!.suggestions[0];
    await act(async () => { await hook.result.current.confirm(1, rel); });
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "allocElsewhereWriteFailed"));
  });

  test("a successful write shows no toast", async () => {
    const { hook, showToast } = setup();
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    const rel = hook.result.current.matches.get(1)!.suggestions[0];
    await act(async () => { await hook.result.current.confirm(1, rel); });
    expect(showToast).not.toHaveBeenCalled();
  });

  test("the project list is mapped once: the result keeps its identity across a re-render that changes nothing", async () => {
    const { hook, deps } = setup();
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    const first = hook.result.current;
    hook.rerender({ ...deps });
    expect(hook.result.current).toBe(first);
  });
});

describe("useCrossProjectApp — forgetting a deleted person (§788)", () => {
  test("a failed sweep says the person was deleted but the name could not be removed, never the save-your-answer text", async () => {
    const { hook, showToast } = setup();
    vi.mocked(deletePersonLinksFor).mockRejectedValueOnce(new Error("db down"));
    await act(async () => { await hook.result.current.forgetPeople([1]); });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "allocElsewhereForgetFailed"));
    // It offers a way forward, in both languages: Undo, then delete again.
    await loadI18n("de");
    expect(t("en-US", "allocElsewhereForgetFailed")).toMatch(/Undo/);
    expect(t("de", "allocElsewhereForgetFailed")).toMatch(/Rückgängig/);
    expect(showToast).not.toHaveBeenCalledWith("error", t("en-US", "allocElsewhereWriteFailed"));
  });

  test("the bridge forwards a delete from a hook built earlier, and drops it once this hook is gone", async () => {
    const bridge = renderHook(() => useForgetPeopleBridge());
    const { deps } = setup();
    const withBridge = renderHook((p: CrossProjectAppDeps) => useCrossProjectApp({ ...p, forgetBridge: bridge.result.current }), { initialProps: deps });
    await act(async () => { bridge.result.current.notify([1]); });
    expect(deletePersonLinksFor).toHaveBeenCalledWith(CONFIG, "p-here", [1]);
    withBridge.unmount();
    vi.mocked(deletePersonLinksFor).mockClear();
    await act(async () => { bridge.result.current.notify([1]); });
    expect(deletePersonLinksFor).not.toHaveBeenCalled();
  });

  // The call sites no behavioural test above can reach: dropping one in task-manager is invisible to them.
  test.each([
    ["task-manager.tsx", "useResourcePlanner({", /onResourcesDeleted: forgetBridge\.notify/],
    ["task-manager.tsx", "useCrossProjectApp({", /forgetBridge/],
    ["task-manager.tsx", "useCrossProjectApp({", /storageKind: settings\.storageConfig\.kind/],
    ["task-manager.tsx", "useChatDispatcherWiring({", /isLoadHeld: \(\) => isSwapInFlight\(\) \|\| loadPendingRef\.current/],
    ["use-chat-dispatcher-wiring.ts", "useChatDispatcher({", /^\s*isLoadHeld,\s*$/m],
    ["workspace-section.tsx", "<ResourceDirectory", /sharesAnswers=/],
    ["task-manager.tsx", "useChatDispatcherWiring({", /onResourcesDeleted: crossProject\.forgetPeople/],
    ["use-chat-dispatcher-wiring.ts", "useChatDispatcher({", /^\s*onResourcesDeleted,\s*$/m],
    ["use-resource-planner.ts", "useResourceDirectory({", /onResourcesDeleted: args\.onResourcesDeleted/],
  ])("%s hands the delete report on at %s", (file, opener, pattern) => {
    const src = readFileSync(join(__dirname, file), "utf8");
    const start = src.indexOf(opener);
    expect(start, `${opener} not found in ${file}`).toBeGreaterThan(-1);
    // A one-line call is read to the end of its line; a multi-line one to its closing `});`.
    const eol = src.indexOf("\n", start);
    const oneLine = /\}\);\s*(\/\/.*)?$/.test(src.slice(start, eol));
    const call = oneLine ? src.slice(start, eol) : src.slice(start, src.indexOf("\n  });", start));
    expect(call).toMatch(pattern);
  });

  test("the bridge keeps one identity across renders", () => {
    const bridge = renderHook(() => useForgetPeopleBridge());
    const first = bridge.result.current;
    bridge.rerender();
    expect(bridge.result.current).toBe(first);
  });
});
