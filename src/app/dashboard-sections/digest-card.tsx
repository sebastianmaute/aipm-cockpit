// Presentational Dashboard headline card for the weekly status digest. Same
// slot family as the other dashboard-sections cards; self-hides when no digest.
import { t, type Lang } from "../i18n";
import { Button } from "../button";
import { AiTriggerButton } from "../ai-trigger-button";
import { RagDot } from "../rag-dot";
import type { DensityClasses } from "../dashboard-density";
import type { DigestModel } from "../digest/digest-model";

export interface DigestCardProps {
  lang: Lang;
  digest: DigestModel | null;
  dc: DensityClasses;
  m365Configured: boolean;
  /** Whole generate/send flow in progress — disables Email. */
  busy: boolean;
  /** The billed AI narrative is in flight — Generate turns into Stop (§125). */
  generating: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  onEmail: () => void;
}

export function DigestCard({
  lang,
  digest,
  dc,
  m365Configured,
  busy,
  generating,
  onGenerate,
  onCancel,
  onEmail,
}: DigestCardProps) {
  if (!digest) return null;
  const ragLabelKey = digest.rag === "R" ? "healthRed" : digest.rag === "A" ? "healthAmber" : "healthGreen";
  return (
    <div className={`rounded-xl border border-line bg-surface ${dc.cardPad} shadow-[var(--shadow-card)]`}>
      <div className="flex items-center justify-between">
        {/* Bare text-ui-dark-blue is a near-black navy in the dark schemes, so
            this title measured 1.10-1.31:1 on --surface — an invisible card
            heading, and one the axe gate can never reach: the card self-hides
            until the digest is enabled AND generated, so it renders nothing at
            scan time even though Dashboard is scanned. The dark companion is
            the repo's idiom for this heading colour (see dashboard-top-actions,
            insights-card, note-log-panel, stakeholder-report-panel) and keeps
            light mode byte-identical; --ui-light-grey measures 8.4-10.3:1 on
            the three dark surfaces. */}
        <h3 className="font-medium text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, "digestTitle")}
        </h3>
        <RagDot level={digest.rag} size="lg" label={t(lang, ragLabelKey)} />
      </div>
      {digest.narrative ? <p className="mt-2 text-sm text-muted-foreground">{digest.narrative}</p> : null}
      <p className="mt-2 text-sm text-muted-foreground">
        {t(lang, "digestOverdue")}: {digest.overdue.count} · {t(lang, "digestOpenRaid")}: {digest.openRaid.count} ({digest.openRaid.high} {t(lang, "digestHigh")}) · {t(lang, "digestMilestonesDueSoon")}: {digest.milestonesDueSoon.length}
      </p>
      <div className="mt-3 flex gap-2">
        {/* ★ While the narrative is in flight this reads "Stop" and aborts it
            (§125). Disabled only for the rest of `busy` (the Graph send), where
            a Stop would abort nothing. */}
        <AiTriggerButton
          lang={lang}
          busy={generating}
          onRun={onGenerate}
          onCancel={onCancel}
          idleLabelKey="digestGenerateNow"
          size="sm"
          disabled={busy && !generating}
        />
        {m365Configured ? (
          <Button variant="secondary" size="sm" onClick={onEmail} disabled={busy}>
            {t(lang, "digestEmail")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
