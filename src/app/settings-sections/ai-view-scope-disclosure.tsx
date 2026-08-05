"use client";
// Read-only disclosure of what the app tells the AI about each view. Its own
// file to keep ai-section.tsx under the 800-line ratchet (`size:check`
// enforces the real number — don't restate it here, it rots).
//
// The prompt text shown here is ENGLISH even in a German UI, and that is
// correct: the whole system prompt is English (see stableInstructions in
// chat-api.ts). Only the chrome around it is translated.
import { useState } from "react";
import { VIEW_AI_SCOPE } from "../view-ai-scope";
import { VIEW_AI_DIGEST } from "../view-ai-digest";
import { ToggleButton } from "../toggle-button";
import { navLabelKey, type AppView } from "../nav-config";
import { t, type Lang } from "../i18n";

export function AiViewScopeDisclosure({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState<Set<AppView>>(new Set());
  const views = Object.keys(VIEW_AI_SCOPE) as AppView[];

  function toggle(view: AppView) {
    // Immutable update — never mutate the Set in place.
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(view)) next.delete(view);
      else next.add(view);
      return next;
    });
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "aiViewScopeTitle")}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{t(lang, "aiViewScopeIntro")}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {views.map((view) => {
          const scope = VIEW_AI_SCOPE[view];
          const label = t(lang, navLabelKey(view));
          const isOpen = open.has(view);
          const panelId = `ai-view-scope-panel-${view}`;
          return (
            <li key={view} className="rounded-md border border-line bg-surface p-2">
              <ToggleButton
                lang={lang}
                pressed={isOpen}
                onToggle={() => toggle(view)}
                // Row-UNIQUE name. N identical "Show" labels is a WCAG 2.4.6
                // failure the axe gate can pass when one row renders.
                ariaLabel={`${t(lang, "show")} – ${label}`}
                className="w-full justify-between"
                // This reveals static text determined before the click — it
                // changes no state that outlives the click — so it is the
                // WAI-ARIA Disclosure pattern (aria-expanded/aria-controls),
                // not a stateful toggle (aria-pressed).
                variant="disclosure"
                ariaControls={panelId}
              >
                {label}
              </ToggleButton>
              {/* Always mounted + `hidden`-toggled, mirroring action-reasons.tsx:
                  aria-controls must reference an id that stays in the DOM even
                  while collapsed, or the reference dangles. */}
              <div id={panelId} hidden={!isOpen} className="mt-2 flex flex-col gap-1 text-xs text-foreground">
                <p>{scope.purpose}</p>
                {scope.reading && <p className="text-muted-foreground">{scope.reading}</p>}
                {scope.toolHints && scope.toolHints.length > 0 && (
                  <p className="text-muted-foreground">
                    <code>{scope.toolHints.join(", ")}</code>
                  </p>
                )}
                {VIEW_AI_DIGEST[view] && (
                  <p className="text-muted-foreground">{t(lang, "aiViewScopeDigest")}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
