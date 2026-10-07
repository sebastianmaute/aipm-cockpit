// §491 step 11 — pins the `useReminderBanners` CALL SITE in task-manager.tsx.
// use-reminder-banners.test.tsx hands the hook its deps by hand, and no other
// task-manager test renders a reminder banner or the bucket toast, so only a
// mounted TaskManager can show which values reach it. Each field is pinned by
// identity against the hook or helper it comes from (pass-through mocks capture
// both sides), or by the value a seeded setting gives it.
//
// ★ The helpers are called by other components too, in an order that varies
// under load, so each capture is a SET of everything the source returned and the
// assertion is membership. A value made up at the call site is in none of them.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import type { ReminderBannersDeps } from "./use-reminder-banners";

const seen = vi.hoisted(() => ({
  deps: [] as unknown[],
  resources: new Set<unknown>(),
  absences: new Set<unknown>(),
  budgets: new Set<unknown>(),
  showToast: new Set<unknown>(),
  holidaySet: new Set<unknown>(),
  effective: new Set<unknown>(),
  today: new Set<unknown>(),
  isPopout: null as unknown,
}));

vi.mock("./use-reminder-banners", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-reminder-banners")>();
  return {
    ...mod,
    useReminderBanners: (deps: ReminderBannersDeps) => {
      seen.deps.push(deps);
      return mod.useReminderBanners(deps);
    },
  };
});
vi.mock("./workspace-context", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./workspace-context")>();
  return {
    ...mod,
    useWorkspace: () => {
      const ws = mod.useWorkspace();
      seen.resources.add(ws.resources);
      seen.absences.add(ws.absences);
      seen.budgets.add(ws.budgets);
      return ws;
    },
  };
});
vi.mock("./use-toast", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-toast")>();
  return {
    ...mod,
    useToast: () => {
      const r = mod.useToast();
      seen.showToast.add(r.showToast);
      return r;
    },
  };
});
vi.mock("./use-holiday-set", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-holiday-set")>();
  return {
    ...mod,
    useHolidaySet: (...a: Parameters<typeof mod.useHolidaySet>) => {
      const r = mod.useHolidaySet(...a);
      seen.holidaySet.add(r.holidaySet);
      return r;
    },
  };
});
vi.mock("./settings-effective", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./settings-effective")>();
  return {
    ...mod,
    resolveEffectiveSettings: (...a: Parameters<typeof mod.resolveEffectiveSettings>) => {
      // A fresh notifications object, as a project override would give, so the
      // effective value is distinguishable from the device `settings.notifications`.
      const base = mod.resolveEffectiveSettings(...a);
      const r = { ...base, notifications: { ...base.notifications } };
      seen.effective.add(r);
      return r;
    },
  };
});
vi.mock("./timezone", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./timezone")>();
  return {
    ...mod,
    createProjectClock: (...a: Parameters<typeof mod.createProjectClock>) => {
      const r = mod.createProjectClock(...a);
      seen.today.add(r.today);
      return r;
    },
  };
});
vi.mock("./workspace-tab-context", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./workspace-tab-context")>();
  return {
    ...mod,
    useWorkspaceTab: () => {
      const r = mod.useWorkspaceTab();
      seen.isPopout = r.isPopout;
      return r;
    },
  };
});

import TaskManager from "./task-manager";

function last(): ReminderBannersDeps {
  const d = seen.deps.at(-1) as ReminderBannersDeps | undefined;
  if (!d) throw new Error("useReminderBanners was not called");
  return d;
}

beforeEach(() => {
  __resetMintStateForTests();
  window.localStorage.clear();
  seen.deps = [];
  for (const k of ["resources", "absences", "budgets", "showToast", "holidaySet", "effective", "today"] as const) seen[k].clear();
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
  // German, and a Jira config with a marker, so lang and jira each carry a
  // value a hard-coded one would not.
  window.localStorage.setItem(
    "aipm-cockpit:settings",
    JSON.stringify({ language: "de", jira: { enabled: true, projectKey: "MARK", tokenExpiresAt: "2099-01-01" } }),
  );
});

describe("task-manager → useReminderBanners call site", () => {
  it("hands the hook the live workspace, clock, holidays, settings and toast", async () => {
    render(<TaskManager />);
    // Heavy mount; wait for hydrated settings rather than the first render's defaults.
    await vi.waitFor(() => {
      expect(last().hydrated).toBe(true);
      expect(last().lang).toBe("de");
    }, { timeout: 30000 });
    const d = last();
    // The three slices are distinct arrays, so a swap between them is visible.
    expect(new Set([d.resources, d.absences, d.budgets]).size).toBe(3);
    expect(seen.resources.has(d.resources)).toBe(true);
    expect(seen.absences.has(d.absences)).toBe(true);
    expect(seen.budgets.has(d.budgets)).toBe(true);
    expect(seen.today.has(d.today)).toBe(true);
    expect(seen.holidaySet.has(d.holidaySet)).toBe(true);
    expect(seen.effective.has(d.effectiveSettings)).toBe(true);
    expect(d.effectiveSettings.language).toBe("de");
    expect(d.effectiveNotifications).toBe(d.effectiveSettings.notifications);
    expect(d.jira.projectKey).toBe("MARK");
    expect(d.isPopout).toBe(false);
    expect(d.isPopout).toBe(seen.isPopout);
    expect(seen.showToast.has(d.showToast)).toBe(true);
    // The first render runs before settings hydrate, so `hydrated` is live, not constant.
    expect((seen.deps[0] as ReminderBannersDeps).hydrated).toBe(false);
  }, 45000);
});
