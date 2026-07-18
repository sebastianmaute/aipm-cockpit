"use client";
import { type Lang, t } from "./i18n";
import type { AiAction, AiActionSeverity } from "./action-ai";
import { type Health } from "./health";
import { RagDot } from "./rag-dot";

const SEV_RAG: Record<AiActionSeverity, Health> = { now: "R", soon: "A", monitor: "G" };

const BTN_CLASS =
  "cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium text-ui-dark-blue transition-colors hover:border-ui-dark-blue/40 hover:bg-ui-dark-blue/10 dark:text-ui-light-grey";

interface AiActionRowProps {
  lang: Lang;
  action: AiAction;
  /** Surface decides Open vs Discuss-in-chat via groundEntity; the row just fires. */
  onAct: (action: AiAction) => void;
}

export function AiActionRow({ lang, action, onAct }: AiActionRowProps) {
  // Label: grounded entity → "Open"; otherwise discuss in chat. The surface
  // re-validates the entity id, but the row picks the label from its presence.
  const ctaKey = action.entity ? "actionOpen" : "actionAiDiscuss";
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <RagDot level={SEV_RAG[action.severity]} className="mt-1" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{action.title}</p>
          <p className="text-xs text-muted-foreground">{action.why}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onAct(action)}
        aria-label={`${t(lang, ctaKey)} – ${action.title}`}
        className={`${BTN_CLASS} shrink-0`}
      >
        {t(lang, ctaKey)}
      </button>
    </div>
  );
}
