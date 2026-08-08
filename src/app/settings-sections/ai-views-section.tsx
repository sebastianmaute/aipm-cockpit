"use client";

// Read-only disclosure of what the app tells the AI about each view. Renamed
// from ai-view-scope-disclosure.tsx when it became its own rail section: the
// per-view ToggleButton went away (all content is now always visible) and the
// heading now comes from settings-view.tsx's shared <h2>, leaving too little
// here to justify a wrapper file.
//
// The prompt text shown here is ENGLISH even in a German UI, and that is
// correct: the whole system prompt is English (see stableInstructions in
// chat-api.ts). Only the chrome around it is translated.

import { VIEW_AI_SCOPE } from "../view-ai-scope";
import { VIEW_AI_DIGEST } from "../view-ai-digest";
import { FieldHint } from "../field-hint";
import { navLabelKey, type AppView } from "../nav-config";
import { type Settings } from "../settings-types";
import { t, type Lang } from "../i18n";

export function AiViewsSection({ lang, settings }: { lang: Lang; settings: Settings }) {
  const views = Object.keys(VIEW_AI_SCOPE) as AppView[];

  // DECISION A: this lived inside ai-section's `settings.ai.enabled === true`
  // fragment. Promoting it to a rail section must not make it appear while the
  // AI master switch is off.
  // `aiEnableHelp` is the master switch's OWN field help ("Turn on to use …"),
  // which reads as an instruction the user cannot follow: this pane holds no
  // toggle and never named the one that gates it. `aiDisabledSectionHint` says
  // the switch is off and where it lives. Gate behaviour is unchanged.
  if (settings.ai.enabled !== true) {
    return <FieldHint>{t(lang, "aiDisabledSectionHint")}</FieldHint>;
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground">{t(lang, "aiViewScopeIntro")}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {views.map((view) => {
          const scope = VIEW_AI_SCOPE[view];
          return (
            <li key={view} className="rounded-md border border-line bg-surface p-2">
              {/* A real <h3>, not a styled <p>: this list is ~one row per view,
                  so heading navigation is the only practical way through it,
                  and a paragraph puts a screen-reader user on arrow keys. The
                  classes are unchanged — zero visual difference. The rail's
                  shared <h2> is the parent level. */}
              <h3 className="text-sm font-medium text-foreground">{t(lang, navLabelKey(view))}</h3>
              {/* lang="en" on the prompt text: it is ENGLISH by design (see the
                  file header) while the document is lang="de" in the German UI,
                  so without this a German synthesiser reads English through
                  German phonemes (WCAG 3.1.2). The digest line below is
                  TRANSLATED and must stay in the document language. */}
              <div className="mt-1 flex flex-col gap-1 text-xs text-foreground">
                <p lang="en">{scope.purpose}</p>
                {scope.reading && (
                  <p lang="en" className="text-muted-foreground">
                    {scope.reading}
                  </p>
                )}
                {scope.toolHints && scope.toolHints.length > 0 && (
                  <p lang="en" className="text-muted-foreground">
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
