"use client";
import { type Lang, t } from "./i18n";
import type { AiAction, AiActionSeverity } from "./action-ai";
import { type Health } from "./health";
import { RagDot } from "./rag-dot";
import { rowLabel } from "./row-tokens";

const SEV_RAG: Record<AiActionSeverity, Health> = { now: "R", soon: "A", monitor: "G" };

const BTN_CLASS =
  "cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium text-ui-dark-blue transition-colors hover:border-ui-dark-blue/40 hover:bg-ui-dark-blue/10 dark:text-ui-light-grey";

interface AiActionRowProps {
  lang: Lang;
  action: AiAction;
  /** Occurrence-qualified row name from the list owner. REQUIRED, not optional,
   *  so tsc makes an omission impossible at a future second call site.
   *  ★★ The raw `action.title` is NOT a substitute — it is model-generated free
   *  text and can repeat, which is exactly why `actions-panel.tsx` keys this
   *  list `${a.title}:${i}` (§328). A per-item component cannot disambiguate
   *  itself (no sibling visibility), so the map is built by the list owner. */
  rowToken: string;
  /** Surface decides Open vs Discuss-in-chat via groundEntity; the row just fires. */
  onAct: (action: AiAction) => void;
}

export function AiActionRow({ lang, action, rowToken, onAct }: AiActionRowProps) {
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
        // WCAG 2.4.6 (§328) — verb, then the SECTION, then the token, in that
        // order. The section segment keeps this list from colliding with the
        // group list below it (both are gated independently and render at the
        // same time), while leaving the two token populations independent: fold
        // AI actions into the group map and every group row is renumbered the
        // moment an analysis appears or disappears.
        // ★★ THE TOKEN MUST STAY LAST — `requireCollisionSeed`'s occurrence
        //    regex is END-ANCHORED, so a token anywhere else defeats the
        //    harness silently rather than loudly.
        // ★ The visible text is still `t(lang, ctaKey)` and the name CONTAINS
        //   it, so WCAG 2.5.3 holds — containment, not prefix.
        aria-label={rowLabel(rowLabel(t(lang, ctaKey), t(lang, "actionAiSectionTitle")), rowToken)}
        className={`${BTN_CLASS} shrink-0`}
      >
        {t(lang, ctaKey)}
      </button>
    </div>
  );
}
