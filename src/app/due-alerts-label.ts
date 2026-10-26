import { t, tPlural, type Lang } from "./i18n";

/**
 * The accessible name of the top bar's bell, shared by both top bars
 * (`TopBar` and the classic `AppHeader`).
 *
 * ★★ WCAG 2.5.3 (label in name): while the pink count badge shows, its number
 * is VISIBLE text of the bell button — `aria-hidden` takes it out of the
 * accessibility tree but not off the screen, and 2.5.3 compares what is on
 * screen. The plain name did not contain "3", so axe 4.14's
 * label-content-name-mismatch failed every scan that rendered the badge. With
 * no badge the bell shows no text and keeps its plain name.
 * ★ The count is the Next actions in the "Now" tier (`nowCount`,
 * `use-next-actions.ts`), and the bell opens the Next actions view — so the
 * suffix names ACTIONS, never "urgent notifications" it does not count, and
 * the base name is "Open next actions" (§783; it read "Show due-date
 * notifications" until 1.20.0, which described something the bell never did).
 * The `showDueAlerts*` key names are kept; only their text changed.
 */
export function dueAlertsLabel(lang: Lang, count: number): string {
  return count > 0 ? tPlural(lang, "showDueAlertsCount", count, count) : t(lang, "showDueAlerts");
}
