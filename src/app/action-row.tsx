// src/app/action-row.tsx
"use client";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import { ACTION_SOURCE_LABEL } from "./action-source-label";
import { InfoTooltip } from "./info-tooltip";
import { ActionReasons } from "./action-reasons";
import {
  ActionPrimaryCta, ActionOverflowMenu, useActionCaps,
  type ActionHandlers, type AssignOwnerBundle,
} from "./action-cta-controls";
import { TIER_RAG } from "./next-actions/action-cta";

export type { AssignOwnerBundle };

interface ActionRowProps extends ActionHandlers {
  lang: Lang;
  action: SuggestedAction;
  extraReasons?: readonly SuggestedAction[];
  expertMode?: boolean;
}

export function ActionRow(props: ActionRowProps) {
  const { lang, action, extraReasons, expertMode } = props;
  const caps = useActionCaps(props);
  const rag = TIER_RAG[action.tier];
  const title = t(lang, action.title.key, ...(action.title.params ?? []));
  const why = t(lang, action.why.key, ...(action.why.params ?? []));
  const sourceLabel = t(lang, ACTION_SOURCE_LABEL[action.source]);
  return (
    // Mouse convenience only — NOT role=button (nested-interactive a11y). Inner
    // controls are the real keyboard affordances.
    <div
      onClick={() => props.onOpen(action)}
      className={`flex cursor-pointer items-center gap-2 rounded-md border border-line border-l-4 ${rag.stripe} bg-surface px-3 py-1.5 hover:bg-surface-muted`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {expertMode && (
            <span onClick={(e) => e.stopPropagation()} className="shrink-0">
              <InfoTooltip text={t(lang, "actionScoreTooltip", action.score)} />
            </span>
          )}
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          <b className="font-semibold uppercase tracking-wide">{sourceLabel}</b> · {why}
        </span>
        <ActionReasons lang={lang} action={action} extraReasons={extraReasons} />
        {action.learning?.moved && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {action.learning.moved === "up" ? t(lang, "learningSurfacedHint") : t(lang, "learningDemotedHint")}
          </span>
        )}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <ActionPrimaryCta lang={lang} action={action} caps={caps} handlers={props} />
        <ActionOverflowMenu lang={lang} action={action} caps={caps} handlers={props} />
      </div>
    </div>
  );
}
