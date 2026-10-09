// src/app/action-chips.tsx
"use client";
import { type Lang, t } from "./i18n";
import type { AppView } from "./nav-config";
import type { SuggestedAction } from "./next-actions/types";
import { TIER_RAG } from "./next-actions/action-cta";
import { Dot } from "./dot";
import { buildRowTokens } from "./row-tokens";
import { Button } from "./button";

const MAX_CHIPS = 3;

/** Open-CTA actions targeting `view` (used by the data-view strip + report cards). */
export function chipsForView(actions: readonly SuggestedAction[], view: AppView): SuggestedAction[] {
  return actions.filter((a) =>
    a.cta.kind === "open"
      ? a.cta.view === view
      : a.cta.kind === "open-tasks-for" && view === "open-points",
  );
}

/** `chipsForView` for a strip rendered ON `view` itself (the workspace strip).
 *
 *  ★★ Only chips that DO something there. An `open` that names no item — `id: 0`
 *  (budget, the change-pending summary, schedule) or a string id (project-meta,
 *  which `executeActionCta` turns into a bare tab switch) — navigates to where
 *  the user already is: a button that does nothing. Panels read `id 0` as "no
 *  item" (`change-panel.tsx` returns on it). Those actions still reach the user
 *  through Next actions and the Dashboard.
 *  ★ NOT for the report cards: there the strip sits on Reports and the CTA opens
 *  the SOURCE view, so an item-less chip is a real navigation and must stay. */
export function chipsActionableOnView(actions: readonly SuggestedAction[], view: AppView): SuggestedAction[] {
  return chipsForView(actions, view).filter((a) =>
    a.cta.kind !== "open" || (typeof a.cta.id === "number" && a.cta.id > 0),
  );
}

interface ActionChipsProps {
  lang: Lang;
  actions: readonly SuggestedAction[];
  onOpen: (action: SuggestedAction) => void;
  onShowMore: () => void;
  className?: string;
}

export function ActionChips({ lang, actions, onOpen, onShowMore, className }: ActionChipsProps) {
  const ranked = actions.filter((a) => a.tier === "now" || a.tier === "soon");
  if (ranked.length === 0) return null;
  const shown = ranked.slice(0, MAX_CHIPS);
  const extra = ranked.length - shown.length;
  // §669 — two actions about entities sharing a name read alike, so each chip is
  // named by a row token. Bare, not memoised: at most MAX_CHIPS rows, and
  // `shown` is a fresh array every render, so a memo would never hit.
  const titleOf = (a: SuggestedAction) => t(lang, a.title.key, ...(a.title.params ?? []));
  const tokens = buildRowTokens(shown.map((a) => ({ id: a.id, name: titleOf(a) })));
  return (
    <div
      role="group"
      aria-label={t(lang, "actionChipsLabel")}
      // ★ p-0.5 is room for the chips' 2px FOCUS_RING: the strip sits at the top
      // edge of an overflow-hidden card, which otherwise shaved the ring off the
      // top and left of a focused chip.
      className={`flex flex-wrap items-center gap-1.5 p-0.5 ${className ?? ""}`}
    >
      {shown.map((action) => (
        <Button
          key={action.id}
          variant="secondary"
          size="xs"
          onClick={() => onOpen(action)}
          aria-label={tokens.get(action.id) ?? titleOf(action)}
          title={t(lang, action.why.key, ...(action.why.params ?? []))}
          className="inline-flex items-center gap-1.5"
        >
          <Dot color={TIER_RAG[action.tier as "now" | "soon"].dot} size="xs" />
          <span className="max-w-[16rem] truncate">
            {titleOf(action)}
          </span>
        </Button>
      ))}
      {extra > 0 && (
        <Button variant="secondary" size="xs" onClick={onShowMore}>
          {t(lang, "actionChipsMore", extra)}
        </Button>
      )}
    </div>
  );
}
