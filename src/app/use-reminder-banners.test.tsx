// §491 step 11 — pins use-reminder-banners.tsx on its own: every gate term of
// the Birthday and Jira-token banners, which inputs each one reads (the
// project-EFFECTIVE notifications, the GLOBAL jira config, the holiday set and
// absences), what useBirthdayAlerts is handed, and the budget-bucket toast
// firing once per change of the ending-bucket key.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { defaultJiraConfig, defaultNotificationsConfig, defaultSettings, type Settings } from "./settings-types";
import { setSnoozedUntil } from "./reminder-snooze";
import type { UseBirthdayAlertsArgs } from "./use-birthday-alerts";
import { useReminderBanners, type ReminderBannersDeps } from "./use-reminder-banners";
import type { Absence, BudgetBucket, Resource } from "./types";

const captured = vi.hoisted(() => ({ args: null as UseBirthdayAlertsArgs | null }));
vi.mock("./use-birthday-alerts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./use-birthday-alerts")>();
  return {
    useBirthdayAlerts: (args: UseBirthdayAlertsArgs) => {
      captured.args = args;
      return orig.useBirthdayAlerts(args);
    },
  };
});

// 2030-01-07 is a Monday. A 01-10 birthday with 3 lead days triggers on 01-07.
const TODAY = "2030-01-07";
const BIRTHDAY_ARIA = "Upcoming birthdays";
const JIRA_ARIA = "Jira token reminder";
const BUCKET_TOAST = "Budget bucket ending soon";

const alice = { id: 1, firstName: "Alice", lastName: "Able", birthday: "01-10" } as Resource;
const notifications: Settings["notifications"] = { ...defaultNotificationsConfig, useGlobalLeadDays: true, reminderLeadDays: 3 };

function bucket(id: number, endDate: string): BudgetBucket {
  return { id, name: `B${id}`, type: "tm", currency: "EUR", startDate: "2029-01-01", endDate, status: "open" } as BudgetBucket;
}

function makeDeps(over: Partial<ReminderBannersDeps> = {}): ReminderBannersDeps {
  return {
    hydrated: false,
    resources: [alice],
    absences: [],
    budgets: [],
    today: TODAY,
    holidaySet: new Set<string>(),
    effectiveSettings: { ...defaultSettings, notifications },
    effectiveNotifications: notifications,
    jira: { ...defaultJiraConfig, enabled: true, tokenInvalidAt: "2030-01-01" },
    isPopout: false,
    lang: "en-US",
    showToast: vi.fn(),
    ...over,
  };
}

function renderBanners(deps: ReminderBannersDeps) {
  const hook = renderHook((d: ReminderBannersDeps) => useReminderBanners(d), { initialProps: deps });
  const view = render(<>{hook.result.current.reminderBannersEl}</>);
  return { hook, view, rerenderView: () => view.rerender(<>{hook.result.current.reminderBannersEl}</>) };
}

const has = (label: string) => screen.queryByLabelText(label) !== null;

afterEach(() => {
  window.localStorage.clear();
  captured.args = null;
});

describe("useReminderBanners — birthday banner", () => {
  it("shows for an upcoming birthday outside a popout", () => {
    renderBanners(makeDeps());
    expect(has(BIRTHDAY_ARIA)).toBe(true);
  });

  it("is suppressed in a popout (both banners)", () => {
    renderBanners(makeDeps({ isPopout: true }));
    expect(has(BIRTHDAY_ARIA)).toBe(false);
    expect(has(JIRA_ARIA)).toBe(false);
  });

  it("is suppressed while snoozed", () => {
    setSnoozedUntil("birthday", Date.now() + 60_000);
    renderBanners(makeDeps());
    expect(has(BIRTHDAY_ARIA)).toBe(false);
    expect(has(JIRA_ARIA)).toBe(true);
  });

  it("is suppressed when there are no upcoming birthdays", () => {
    renderBanners(makeDeps({ resources: [{ ...alice, birthday: "06-01" }] }));
    expect(has(BIRTHDAY_ARIA)).toBe(false);
  });

  it("reads the birthday channel from the EFFECTIVE notifications", () => {
    const off = { ...notifications, birthday: { enabled: false } };
    renderBanners(makeDeps({ effectiveNotifications: off }));
    expect(has(BIRTHDAY_ARIA)).toBe(false);
  });

  it("reads the lead days from the EFFECTIVE notifications", () => {
    const short = { ...notifications, reminderLeadDays: 2 };
    renderBanners(makeDeps({ effectiveNotifications: short }));
    expect(has(BIRTHDAY_ARIA)).toBe(false);
  });

  it("passes the holiday set through (a holiday on the trigger day brings it forward)", () => {
    const short = { ...notifications, reminderLeadDays: 2 }; // trigger 01-08, not yet
    renderBanners(makeDeps({ effectiveNotifications: short, holidaySet: new Set(["2030-01-08"]) }));
    expect(has(BIRTHDAY_ARIA)).toBe(true);
  });

  it("passes the absences through (an absence on the trigger day brings it forward)", () => {
    const short = { ...notifications, reminderLeadDays: 2 };
    const away: Absence = { id: 1, assignee: "Alice Able", startDate: "2030-01-08", endDate: "2030-01-08", type: "vacation" };
    renderBanners(makeDeps({ effectiveNotifications: short, absences: [away] }));
    expect(has(BIRTHDAY_ARIA)).toBe(true);
  });

  it("Dismiss hides the birthday banner only", () => {
    const { hook, rerenderView } = renderBanners(makeDeps());
    const dismiss = screen.getByLabelText(BIRTHDAY_ARIA).querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]');
    expect(dismiss).not.toBeNull();
    act(() => { dismiss!.click(); });
    hook.rerender(makeDeps());
    rerenderView();
    expect(has(BIRTHDAY_ARIA)).toBe(false);
    expect(has(JIRA_ARIA)).toBe(true);
  });

  it("hands useBirthdayAlerts the effective settings and the live inputs", () => {
    const deps = makeDeps({ hydrated: true });
    renderBanners(deps);
    const a = captured.args!;
    expect(a.settings).toBe(deps.effectiveSettings);
    expect(a.hydrated).toBe(true);
    expect(a.resources).toBe(deps.resources);
    expect(a.today).toBe(TODAY);
    expect(a.holidaySet).toBe(deps.holidaySet);
    expect(a.absences).toBe(deps.absences);
    expect(a.showToast).toBe(deps.showToast);
  });
});

describe("useReminderBanners — Jira token banner", () => {
  it("shows for an invalid token outside a popout", () => {
    renderBanners(makeDeps());
    expect(has(JIRA_ARIA)).toBe(true);
  });

  it("is suppressed when there is no alert (Jira disabled)", () => {
    renderBanners(makeDeps({ jira: { ...defaultJiraConfig, enabled: false, tokenInvalidAt: "2030-01-01" } }));
    expect(has(JIRA_ARIA)).toBe(false);
  });

  it("is suppressed when the jiraTokenError channel is off", () => {
    renderBanners(makeDeps({ effectiveNotifications: { ...notifications, jiraTokenError: { enabled: false } } }));
    expect(has(JIRA_ARIA)).toBe(false);
    expect(has(BIRTHDAY_ARIA)).toBe(true);
  });

  it("is suppressed while snoozed", () => {
    setSnoozedUntil("jiraToken", Date.now() + 60_000);
    renderBanners(makeDeps());
    expect(has(JIRA_ARIA)).toBe(false);
    expect(has(BIRTHDAY_ARIA)).toBe(true);
  });

  it("uses the effective reminder lead days for an expiring token", () => {
    const jira = { ...defaultJiraConfig, enabled: true, tokenExpiresAt: "2030-01-12" }; // 5 days left
    renderBanners(makeDeps({ jira }));
    expect(has(JIRA_ARIA)).toBe(false);
  });

  it("shows an expiring token inside the lead days", () => {
    const jira = { ...defaultJiraConfig, enabled: true, tokenExpiresAt: "2030-01-12" };
    renderBanners(makeDeps({ jira, effectiveNotifications: { ...notifications, reminderLeadDays: 7 } }));
    expect(has(JIRA_ARIA)).toBe(true);
  });

  it("Dismiss hides the Jira banner only", () => {
    const { hook, rerenderView } = renderBanners(makeDeps());
    const dismiss = screen.getByLabelText(JIRA_ARIA).querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]');
    expect(dismiss).not.toBeNull();
    act(() => { dismiss!.click(); });
    hook.rerender(makeDeps());
    rerenderView();
    expect(has(JIRA_ARIA)).toBe(false);
    expect(has(BIRTHDAY_ARIA)).toBe(true);
  });
});

describe("useReminderBanners — budget-bucket toast", () => {
  const bucketToasts = (fn: ReturnType<typeof vi.fn>) =>
    fn.mock.calls.filter((c: unknown[]) => String(c[1]).includes(BUCKET_TOAST)).map((c: unknown[]) => [c[0], c[1]]);

  it("does not fire when no bucket is ending", () => {
    const showToast = vi.fn();
    renderHook(() => useReminderBanners(makeDeps({ showToast, budgets: [bucket(1, "2030-06-01")] })));
    expect(bucketToasts(showToast)).toEqual([]);
  });

  it("fires once per change of the ending-bucket key, with the count", () => {
    const showToast = vi.fn();
    const budgets = [bucket(1, "2030-01-09"), bucket(2, "2030-06-01")];
    const { rerender } = renderHook((d: ReminderBannersDeps) => useReminderBanners(d), {
      initialProps: makeDeps({ showToast, budgets }),
    });
    expect(bucketToasts(showToast)).toEqual([["info", `1 ${BUCKET_TOAST}`]]);

    // Same key (new array, same ending ids) — no second toast.
    rerender(makeDeps({ showToast, budgets: [...budgets] }));
    expect(bucketToasts(showToast)).toHaveLength(1);

    // A second bucket starts ending — the key changes, the toast fires again.
    rerender(makeDeps({ showToast, budgets: [bucket(1, "2030-01-09"), bucket(2, "2030-01-08")] }));
    expect(bucketToasts(showToast)).toEqual([["info", `1 ${BUCKET_TOAST}`], ["info", `2 ${BUCKET_TOAST}`]]);
  });

  it("reads the lead days from the effective notifications", () => {
    const showToast = vi.fn();
    renderHook(() => useReminderBanners(makeDeps({
      showToast,
      budgets: [bucket(1, "2030-01-12")], // 5 days left
      effectiveNotifications: { ...notifications, reminderLeadDays: 7 },
    })));
    expect(bucketToasts(showToast)).toEqual([["info", `1 ${BUCKET_TOAST}`]]);
  });

  it("uses today to decide what is ending", () => {
    const showToast = vi.fn();
    renderHook(() => useReminderBanners(makeDeps({ showToast, budgets: [bucket(1, "2030-01-09")], today: "2029-06-01" })));
    expect(bucketToasts(showToast)).toEqual([]);
  });

  it("translates the toast in the current language", async () => {
    const { loadI18n } = await import("./i18n");
    await loadI18n("de");
    const showToast = vi.fn();
    renderHook(() => useReminderBanners(makeDeps({ showToast, lang: "de", budgets: [bucket(1, "2030-01-09")] })));
    const texts = showToast.mock.calls.map((c: unknown[]) => String(c[1]));
    expect(texts.some((s) => s.startsWith("1 ") && !s.includes(BUCKET_TOAST))).toBe(true);
  });
});
