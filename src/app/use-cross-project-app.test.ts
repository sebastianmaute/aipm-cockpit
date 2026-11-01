import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Resource, ResourcePlan } from "./types";
import type { TursoConfig } from "./turso-config";
import type { Workspace } from "./workspace";
import { t } from "./i18n";

vi.mock("./person-links-store", () => ({
  loadPersonLinks: vi.fn(async () => []),
  savePersonLink: vi.fn(async () => undefined),
  deletePersonLink: vi.fn(async () => undefined),
}));
vi.mock("./turso-backend", () => ({ TursoBackend: class {} }));

import { savePersonLink } from "./person-links-store";
import { useCrossProjectApp, type CrossProjectAppDeps } from "./use-cross-project-app";

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
    getScopeEpoch: () => 0, lang: "en-US", showToast, load,
  };
  return { showToast, deps, hook: renderHook((p: CrossProjectAppDeps) => useCrossProjectApp(p), { initialProps: deps }) };
}

beforeEach(() => vi.mocked(savePersonLink).mockReset().mockResolvedValue(undefined));

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
