import { t, type Lang } from "./i18n";

/**
 * The accessible name of the top bar's bell, shared by both top bars
 * (`TopBar` and the classic `AppHeader`).
 *
 * ★★ WCAG 2.5.3 (label in name): while the pink count badge shows, its number
 * is VISIBLE text of the bell button — `aria-hidden` takes it out of the
 * accessibility tree but not off the screen, and 2.5.3 compares what is on
 * screen. "Show due-date notifications" did not contain "3", so axe 4.14's
 * label-content-name-mismatch failed every scan that rendered the badge. With
 * no badge the bell shows no text and keeps its plain name.
 */
export function dueAlertsLabel(lang: Lang, count: number): string {
  return count > 0 ? t(lang, "showDueAlertsCount", count) : t(lang, "showDueAlerts");
}
