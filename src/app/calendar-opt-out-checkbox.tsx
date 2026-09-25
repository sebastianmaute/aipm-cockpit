// §486 — per-item Outlook sync switch. `checked` means "syncs"; unticking sets
// the item's calendarOptOut, ticking clears it. The name carries the item title
// so two open modals never share an accessible name, and it starts with the
// visible caption (WCAG 2.5.3 label-in-name).
import { useId } from "react";
import { Checkbox } from "./form-controls";
import { type Lang, t } from "./i18n";

export interface CalendarOptOutCheckboxProps {
  lang: Lang;
  /** True while the item syncs, i.e. `!item.calendarOptOut`. */
  checked: boolean;
  /** The item's title or name; a blank one (a new, untitled item) names the
   *  control by its caption alone rather than ending the name in a dash. */
  itemTitle: string;
  onChange: (syncs: boolean) => void;
}

export function CalendarOptOutCheckbox({ lang, checked, itemTitle, onChange }: CalendarOptOutCheckboxProps) {
  const hintId = useId();
  const title = itemTitle.trim();
  return (
    <div className="text-xs">
      <label className="flex items-center gap-2">
        <Checkbox
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={title ? t(lang, "calendarOptOutLabel", title) : t(lang, "calendarOptOutCaption")}
          aria-describedby={hintId}
        />
        <span>{t(lang, "calendarOptOutCaption")}</span>
      </label>
      <p id={hintId} className="mt-1 text-muted-foreground">{t(lang, "calendarOptOutHint")}</p>
    </div>
  );
}
