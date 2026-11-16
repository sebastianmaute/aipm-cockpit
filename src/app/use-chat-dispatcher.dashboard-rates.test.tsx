// §804 — the rates switch covers the dashboard figures the chat reads: `get_dashboard_snapshot` is built with
// the open project's switch (or the deployment's `ai-rates` lock), read at CALL time. The snapshot builder
// itself is pinned in `ai-dashboard-snapshot.test.ts`; this pins that the dispatcher hands it the live answer.
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const flags = vi.hoisted(() => ({ projectWithholds: false }));
vi.mock("./ai-privacy-context", async () => {
  const base = await import("../test/ai-privacy-unprotected");
  const { isRatesWithheld } = await import("./ai-project-switches");
  // The open project's switch, or (with none) the deployment lock, as the real getter answers.
  const now = () => (flags.projectWithholds ? true : isRatesWithheld(undefined));
  return { ...base, useOpenProjectRatesWithheld: () => now };
});
const built = vi.hoisted(() => ({ opts: [] as unknown[] }));
vi.mock("./ai-dashboard-snapshot", async (orig) => {
  const real = await orig<typeof import("./ai-dashboard-snapshot")>();
  return {
    ...real,
    buildDashboardSnapshot: (...args: unknown[]) => {
      built.opts.push(args[3]);
      return {} as ReturnType<typeof real.buildDashboardSnapshot>;
    },
  };
});
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { setDisabledIntegrations } from "./integration-switches";
import { useChatDispatcher } from "./use-chat-dispatcher";
import type { DashboardModel } from "./dashboard";

afterEach(() => {
  flags.projectWithholds = false;
  built.opts = [];
  setDisabledIntegrations([]);
});

function dispatcher() {
  const args = makeDispatcherArgs({ getDashboardModel: () => ({}) as DashboardModel, getBudgetRollup: () => null });
  return renderHook(() => useChatDispatcher(args), { wrapper: dispatcherWrapperWith({}) }).result.current;
}

describe("get_dashboard_snapshot follows the rates switch (§804)", () => {
  it("CONTROL: with no switch and no lock the rates are sent", () => {
    dispatcher().getDashboardSnapshot();
    expect(built.opts).toEqual([{ ratesWithheld: false }]);
  });

  it("the project's switch, read at call time, withholds them", () => {
    const d = dispatcher();
    flags.projectWithholds = true;
    d.getDashboardSnapshot();
    expect(built.opts).toEqual([{ ratesWithheld: true }]);
  });

  it("the deployment's ai-rates lock withholds them with no project switch", () => {
    const d = dispatcher();
    setDisabledIntegrations(["ai-rates"]);
    d.getDashboardSnapshot();
    expect(built.opts).toEqual([{ ratesWithheld: true }]);
  });
});
