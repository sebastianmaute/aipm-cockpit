"use client";

// Shown in an entity editor (task, RAID item, change) whose STORED row was
// deleted by another writer while the editor was open. The editor stays open on
// its draft, but its Notes (and Blockers) button is disabled, since the floating
// window would close at once, and Save cannot bring the row back. Two parts, at
// the owner's choice: a banner at the top of the editor saying so, and a short
// line under the disabled button explaining it, which the button references
// through `aria-describedby` (a disabled button cannot take focus, and its
// `title` hint rarely shows).

import { Banner } from "./banner";
import { t, type Lang } from "./i18n";

/** The editor-level warning. `role="status"` (Banner's default for `warn`),
 *  since the deletion happened elsewhere. ★ A live region inserted already
 *  holding its text is announced UNRELIABLY (often by NVDA with Chrome, often
 *  not by VoiceOver), so do not count on it: the disabled button's description
 *  and the error toast on Save are what reliably reach a screen-reader user. */
export function DeletedElsewhereBanner({ lang }: { lang: Lang }) {
  return (
    <Banner severity="warn" className="sm:col-span-2" data-deleted-elsewhere-banner>
      {t(lang, "editorDeletedElsewhere")}
    </Banner>
  );
}

/** The line under the disabled button(s). `id` is what the button's
 *  `aria-describedby` names; `withBlockers` widens the wording for the task
 *  editor, whose one line explains both its Notes and its Blockers button. */
export function DeletedElsewhereHint({ id, lang, withBlockers = false }: { id: string; lang: Lang; withBlockers?: boolean }) {
  return (
    <p id={id} className="mt-1 text-xs text-muted-foreground">
      {t(lang, withBlockers ? "noteBlockerLogDeletedElsewhere" : "noteLogDeletedElsewhere")}
    </p>
  );
}
