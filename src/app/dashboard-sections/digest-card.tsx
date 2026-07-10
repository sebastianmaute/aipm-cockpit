// Presentational Dashboard headline card for the weekly status digest. Same
// slot family as the other dashboard-sections cards; self-hides when no digest.
import { t, type Lang } from "../i18n";
import { INTERACTIVE } from "../interaction-styles";
import { healthDot } from "../health";
import type { DensityClasses } from "../dashboard-density";
import type { DigestModel } from "../digest/digest-model";

export interface DigestCardProps {
  lang: Lang;
  digest: DigestModel | null;
  dc: DensityClasses;
  m365Configured: boolean;
  busy: boolean;
  onGenerate: () => void;
  onEmail: () => void;
}

export function DigestCard({ lang, digest, dc, m365Configured, busy, onGenerate, onEmail }: DigestCardProps) {
  if (!digest) return null;
  const ragLabelKey = digest.rag === "R" ? "healthRed" : digest.rag === "A" ? "healthAmber" : "healthGreen";
  return (
    <div className={`rounded-xl border border-line bg-surface ${dc.cardPad} shadow-[var(--shadow-card)]`}>
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-AIPM-dark-blue">{t(lang, "digestTitle")}</h3>
        <span
          className={`inline-block h-3 w-3 rounded-full ${healthDot[digest.rag]}`}
          role="img"
          aria-label={t(lang, ragLabelKey)}
        />
      </div>
      {digest.narrative ? <p className="mt-2 text-sm text-muted-foreground">{digest.narrative}</p> : null}
      <p className="mt-2 text-sm text-muted-foreground">
        {t(lang, "digestOverdue")}: {digest.overdue.count} · {t(lang, "digestOpenRaid")}: {digest.openRaid.count} ({digest.openRaid.high} {t(lang, "digestHigh")}) · {t(lang, "digestMilestonesDueSoon")}: {digest.milestonesDueSoon.length}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className={`rounded-md border border-line px-3 py-1 text-sm ${INTERACTIVE}`}
        >
          {t(lang, "digestGenerateNow")}
        </button>
        {m365Configured ? (
          <button
            type="button"
            onClick={onEmail}
            disabled={busy}
            className={`rounded-md border border-line px-3 py-1 text-sm ${INTERACTIVE}`}
          >
            {t(lang, "digestEmail")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
