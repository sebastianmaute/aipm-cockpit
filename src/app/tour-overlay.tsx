"use client";

// Guided-tour overlay (SP-F), modern-shell only. Renders the current step as a
// centered modal, or — for "spotlight" steps — a dimmed overlay with a tooltip
// anchored to a [data-tour-id] element. If the anchor is missing (gated/unmounted
// view), it falls back to a centered modal so it never points at nothing. The
// host (task-manager) owns navigation + state; this is a controlled component.

import { useEffect, useRef, useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import { clampStep, type TourStep } from "./app-tour";
import { Button } from "./button";
import { useFocusTrap } from "./use-focus-trap";

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

  // Gated on a real step: it renders null without one, and an entry that
  // claims Escape while showing nothing would swallow the key.
  //
  // ★★ THIS SURFACE NOW CONTAINS TAB, and `useFocusTrap` is what does it —
  // one hook for the trap AND the stack entry, so the two can never disagree.
  // The hook pushes `kind: "modal"`, which is the honest tag: `kind` means
  // exactly "traps Tab" to `dismissal-stack.ts`, so the tag and the trap
  // arrived in the SAME commit. That pairing is the rule, not a courtesy, and
  // this file is the record of what breaking it in each direction costs.
  // Tagged "modal" WITHOUT a trap (the state that forced this overlay down to
  // "layer"), the tour won `isTopmostOfKind(token,"modal")` from any real
  // `Modal` open at the same time; that Modal stood down and nothing took
  // over, so focus walked out of both into the page behind (WCAG 2.4.3).
  // Trapping WITHOUT the tag is the mirror: a "layer" never takes Tab from a
  // `Modal` above it, so two document listeners would fight in registration
  // order. Move both or neither (§8).
  //
  // ★ `cardRef` is passed as BOTH the container and `initialFocusRef` on
  // purpose: it preserves focusing the CARD rather than its first button,
  // which is what makes AT announce the dialog and its `aria-label`. The
  // per-step re-focus effect below stays — the hook's own effect is not keyed
  // on the step index, so it does not replace it.
  //
  // ★ `onSkip` must stay stable at the CALL SITE (`use-tour.ts` hands down a
  // `useCallback`): the hook's keydown effect has it in its deps, so an
  // unstable identity would re-run the effect and re-focus the card on every
  // parent render.
  useFocusTrap(cardRef, step !== undefined, onSkip, cardRef);

  useEffect(() => {
    cardRef.current?.focus();
  }, [i]);

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
          <Button variant="secondary" size="xs" onClick={onSkip}>
            {t(lang, "tourSkip")}
          </Button>
          <div className="flex items-center gap-2">
            {step.view && (
              <Button variant="secondary" size="xs" onClick={() => onShowMe(step)}>
                {t(lang, "tourShowMe")}
              </Button>
            )}
            {i > 0 && (
              <Button variant="secondary" size="xs" onClick={onBack}>
                {t(lang, "tourBack")}
              </Button>
            )}
            <Button size="xs" onClick={isLast ? onDone : onNext}>
              {t(lang, isLast ? "tourDone" : "tourNext")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
