// src/app/action-hero-card.tsx
"use client";
import { type Lang, t } from "./i18n";
import type { ActionGroup } from "./next-actions/group";
import { ActionReasons } from "./action-reasons";
import { ActionPrimaryCta, ActionOverflowMenu, useActionCaps, type ActionHandlers } from "./action-cta-controls";
import { TIER_RAG } from "./next-actions/action-cta";
import { InfoTooltip } from "./info-tooltip";
import { rowLabel } from "./row-tokens";

interface ActionHeroCardProps extends ActionHandlers {
  lang: Lang;
  group: ActionGroup;
  expertMode?: boolean;
  /** Occurrence-qualified row name from the panel. A per-item component cannot
   *  disambiguate itself — it has no sibling visibility — so the map is built
   *  by whoever renders the list and threaded down (§324).
   *  ★★ It comes from the SAME map the rows use: the hero is `groups[0]`,
   *  de-duped from its tier list, so hero and rows are ONE naming population.
   *  ★★★ SPLITTING THAT MAP IS THE DANGER, AND NOT BECAUSE EACH HALF WOULD
   *  NUMBER FROM 1 — an earlier revision of this line said exactly that and it
   *  is false: `buildRowTokens` numbers only when a name REPEATS inside the map
   *  it was handed, so a one-member half emits a BARE token, never "(1)". The
   *  full argument lives at the map itself in `actions-panel.tsx`; read it
   *  there rather than restating it here. */
  rowToken: string;
}

export function ActionHeroCard(props: ActionHeroCardProps) {
  const { lang, group, expertMode, rowToken } = props;
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
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        <span aria-hidden>⚑</span>
        {t(lang, "actionHeroEyebrow")}
        {expertMode && (
          <span className="ml-1 font-normal normal-case tracking-normal">
            {/* ★ See the matching comment in `action-row.tsx`: the tooltip text
                  interpolates only the SCORE, which the hero and a row can tie
                  on, so it is not a disambiguator (§324). */}
            <InfoTooltip
              text={t(lang, "actionScoreTooltip", action.score)}
              label={rowLabel(t(lang, "actionScoreTooltip", action.score), rowToken)}
            />
          </span>
        )}
      </div>
      <h3 className="mt-1 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">{why}</p>
      <ActionReasons lang={lang} action={action} extraReasons={group.extra} rowToken={rowToken} />
      {action.learning?.moved && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {action.learning.moved === "up" ? t(lang, "learningSurfacedHint") : t(lang, "learningDemotedHint")}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ActionPrimaryCta lang={lang} action={action} caps={caps} handlers={props} rowToken={rowToken} prominent />
        <ActionOverflowMenu lang={lang} action={action} caps={caps} handlers={props} rowToken={rowToken} />
      </div>
    </section>
  );
}
