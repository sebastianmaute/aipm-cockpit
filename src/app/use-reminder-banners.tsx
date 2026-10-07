"use client";
// src/app/use-reminder-banners.tsx
//
// §491 step 11 — the Birthday and Jira-token reminder banners, extracted from
// task-manager (move-only). Deps-object hook (AGENTS.md "Extraction
// conventions" 1): called unconditionally, reads live render-scope values, and
// returns `reminderBannersEl`, the two banner mounts as one fragment that
// task-manager's `bannersEl` renders FIRST, where the two banners sat.
//
// It also owns the budget-bucket "ending soon" toast, which fires once per
// change of the set of ending buckets (keyed on their ids, not on the array).
//
// Gates are verbatim from task-manager — popouts (`isPopout`) suppress both
// banners. Coverage-GATED on purpose: the gates are logic, pinned by
// use-reminder-banners.test.tsx.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { type Lang, t } from "./i18n";
import { getBucketReminders } from "./budget-report";
import { getUpcomingBirthdays } from "./birthdays";
import { getJiraTokenAlert } from "./jira-token-status";
import { effectiveLeadDays } from "./notifications-lead";
import { BirthdayBanner, JiraTokenBanner } from "./notifications";
import { useBirthdayAlerts } from "./use-birthday-alerts";
import { useReminderSnooze } from "./use-reminder-snooze";
import type { JiraConfig, Settings } from "./settings-types";
import type { Absence, BudgetBucket, Resource } from "./types";

/** Live render-scope values the reminder banners read each render. */
export interface ReminderBannersDeps {
  hydrated: boolean;
  resources: readonly Resource[];
  absences: readonly Absence[];
  budgets: readonly BudgetBucket[];
  today: string;
  holidaySet: Set<string>;
  /** The project-effective settings — the birthday desktop alert reads its lead days from here. */
  effectiveSettings: Settings;
  /** `effectiveSettings.notifications` as task-manager already derives it. */
  effectiveNotifications: Settings["notifications"];
  /** The GLOBAL `settings.jira` (the token is per device, not per project). */
  jira: JiraConfig;
  isPopout: boolean;
  lang: Lang;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useReminderBanners({
  hydrated, resources, absences, budgets, today, holidaySet,
  effectiveSettings, effectiveNotifications, jira, isPopout, lang, showToast,
}: ReminderBannersDeps): { reminderBannersEl: ReactNode } {
  const { birthdayDismissed, setBirthdayDismissed } = useBirthdayAlerts({
    // Effective so birthday desktop-alert lead days follow a project's
    // notifications override (the hook reads only settings.notifications).
    hydrated, resources, today, settings: effectiveSettings, holidaySet, absences, showToast,
  });

  const birthdaySnooze = useReminderSnooze("birthday");
  const jiraTokenSnooze = useReminderSnooze("jiraToken");
  const [jiraTokenDismissed, setJiraTokenDismissed] = useState(false);
  const jiraTokenAlert = useMemo(
    () => getJiraTokenAlert(jira, today, effectiveNotifications.reminderLeadDays),
    [jira, today, effectiveNotifications.reminderLeadDays],
  );

  const birthdayItems = useMemo(
    () => effectiveNotifications.birthday.enabled
      ? getUpcomingBirthdays(resources, today, effectiveLeadDays(effectiveNotifications, "birthday"), holidaySet, absences)
      : [],
    [resources, effectiveNotifications, today, holidaySet, absences],
  );

  const bucketReminders = useMemo(
    () => getBucketReminders(budgets, effectiveNotifications.reminderLeadDays, today),
    [budgets, effectiveNotifications.reminderLeadDays, today],
  );

  const bucketReminderKey = bucketReminders.map((r) => r.bucket.id).join(",");
  useEffect(() => {
    if (bucketReminders.length > 0) {
      showToast("info", `${bucketReminders.length} ${t(lang, "budgetEndingSoon")}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketReminderKey]);

  const reminderBannersEl = (
    <>
      {!isPopout && !birthdaySnooze.isSnoozed && !birthdayDismissed && birthdayItems.length > 0 && (
        <BirthdayBanner items={birthdayItems} lang={lang} onDismiss={() => setBirthdayDismissed(true)} onSnooze={birthdaySnooze.snooze} />
      )}
      {!isPopout && jiraTokenAlert && !jiraTokenSnooze.isSnoozed && !jiraTokenDismissed && effectiveNotifications.jiraTokenError.enabled && (
        <JiraTokenBanner alert={jiraTokenAlert} lang={lang} onSnooze={jiraTokenSnooze.snooze} onDismiss={() => setJiraTokenDismissed(true)} />
      )}
    </>
  );

  return { reminderBannersEl };
}
