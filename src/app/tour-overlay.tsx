"use client";

// Guided-tour overlay (SP-F), modern-shell only. Renders the current step as a
// centered modal, or — for "spotlight" steps — a dimmed overlay with a tooltip
// anchored to a [data-tour-id] element. If the anchor is missing (gated/unmounted
// view), it falls back to a centered modal so it never points at nothing. The
// host (task-manager) owns navigation + state; this is a controlled component.

import { useEffect, useRef, useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import { clampStep, type TourStep } from "./app-tour";

export interface TourOverlayProps {
  lang: Lang;
  /** When set, the active tour's title shows as a small label above the step (SP4). */
  tourTitleKey?: TranslationKey;
  steps: readonly TourStep[];
  index: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onDone: () => void;
  onShowMe: (step: TourStep) => void;
}

interface Rect { top: number; left: number; width: number; height: number; }

export function TourOverlay({ lang, tourTitleKey, steps, index, onBack, onNext, onSkip, onDone, onShowMe }: TourOverlayProps) {
  const total = steps.length;
  const i = clampStep(index, total);
  const step = steps[i];
  const isLast = i === total - 1;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);

  useEffect(() => {
    // Measure the anchor in a rAF (an async callback, not a synchronous
    // effect-body setState — the latter trips react-hooks/set-state-in-effect,
    // which CI rejects). rAF also lets the conditionally-mounted view lay out
    // before we read its rect.
    let raf = 0;
    const measure = () => {
      if (step?.kind !== "spotlight" || !step.anchorId) { setAnchorRect(null); return; }
      const el = document.querySelector<HTMLElement>(`[data-tour-id="${step.anchorId}"]`);
      if (!el) { setAnchorRect(null); return; }
      const r = el.getBoundingClientRect();
      setAnchorRect(r.width > 0 || r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onSkip(); }
    }
    document.addEventListener("keydown", onKey);
    cardRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onSkip, i]);

  if (!step) return null;
  const spotlight = step.kind === "spotlight" && anchorRect !== null;

  const cardStyle: React.CSSProperties = spotlight && anchorRect
    ? { position: "fixed", top: Math.min(anchorRect.top + anchorRect.height + 8, window.innerHeight - 180), left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - 360)) }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return (
    <div className="fixed inset-0 z-[60] bg-ui-dark-blue/40" role="presentation">
      {spotlight && anchorRect && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-md ring-2 ring-ui-green"
          style={{ top: anchorRect.top - 4, left: anchorRect.left - 4, width: anchorRect.width + 8, height: anchorRect.height + 8 }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, step.titleKey)}
        tabIndex={-1}
        style={cardStyle}
        className="w-[340px] max-w-[92vw] rounded-lg border border-line bg-surface p-4 focus:outline-none"
      >
        {tourTitleKey && (
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(lang, tourTitleKey)}
          </p>
        )}
        <div className="mb-2 flex items-center gap-1" aria-hidden="true">
          {steps.map((s, k) => (
            <span key={s.id} className={k === i ? "h-1.5 w-3 rounded-full bg-ui-dark-blue" : "h-1.5 w-1.5 rounded-full bg-line"} />
          ))}
        </div>
        <h2 className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{t(lang, step.titleKey)}</h2>
        <p className="mt-1 text-xs leading-relaxed text-foreground">{t(lang, step.bodyKey)}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">{i + 1} / {total}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick={onSkip} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted">
            {t(lang, "tourSkip")}
          </button>
          <div className="flex items-center gap-2">
            {step.view && (
              <button type="button" onClick={() => onShowMe(step)} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ui-dark-blue hover:bg-surface-muted dark:text-ui-light-grey">
                {t(lang, "tourShowMe")}
              </button>
            )}
            {i > 0 && (
              <button type="button" onClick={onBack} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted">
                {t(lang, "tourBack")}
              </button>
            )}
            <button type="button" onClick={isLast ? onDone : onNext} className="rounded-md border border-ui-dark-blue bg-ui-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-ui-dark-blue/90">
              {t(lang, isLast ? "tourDone" : "tourNext")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
