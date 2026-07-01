// src/app/action-hero-card.tsx
"use client";
import { type Lang, t } from "./i18n";
import type { ActionGroup } from "./next-actions/group";
import { ActionReasons } from "./action-reasons";
import { ActionPrimaryCta, ActionOverflowMenu, useActionCaps, type ActionHandlers } from "./action-cta-controls";
import { TIER_RAG } from "./next-actions/action-cta";
import { InfoTooltip } from "./info-tooltip";

interface ActionHeroCardProps extends ActionHandlers {
  lang: Lang;
  group: ActionGroup;
  expertMode?: boolean;
}

export function ActionHeroCard(props: ActionHeroCardProps) {
  const { lang, group, expertMode } = props;
  const action = group.primary;
  const caps = useActionCaps(props);
  const rag = TIER_RAG[group.tier];
  const title = t(lang, action.title.key, ...(action.title.params ?? []));
  const why = t(lang, action.why.key, ...(action.why.params ?? []));
  return (
    <section
      aria-label={t(lang, "actionHeroEyebrow")}
      className={`mb-4 rounded-lg border border-line border-l-4 ${rag.stripe} bg-surface p-4 shadow-[var(--shadow-card)]`}
    >
      <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide ${rag.text}`}>
        <span aria-hidden>⚑</span>
        {t(lang, "actionHeroEyebrow")}
        {expertMode && (
          <span className="ml-1 font-normal normal-case tracking-normal">
            <InfoTooltip text={t(lang, "actionScoreTooltip", action.score)} />
          </span>
        )}
      </div>
      <h3 className="mt-1 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">{why}</p>
      <ActionReasons lang={lang} action={action} extraReasons={group.extra} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ActionPrimaryCta lang={lang} action={action} caps={caps} handlers={props} prominent />
        <ActionOverflowMenu lang={lang} action={action} caps={caps} handlers={props} />
      </div>
    </section>
  );
}
