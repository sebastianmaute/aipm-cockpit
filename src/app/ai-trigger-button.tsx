"use client";
import { type ReactNode } from "react";
import { StopIcon } from "@heroicons/react/24/outline";
import { Button } from "./button";
import { t, type Lang, type TranslationKey } from "./i18n";

/**
 * The shared trigger for every AI feature that can be stopped mid-flight.
 *
 * ★ While busy, the VISIBLE label and the ACCESSIBLE NAME both become "Stop"
 *   and the click aborts. A control whose visible text names something other
 *   than what a click does is WCAG 2.5.3 (F96) — which is why this never shows
 *   a progress label like "Asking Claude…" on the button itself. Put progress
 *   text beside the button if a surface needs it.
 *
 * Purely presentational: the caller's own busy flag and cancel function drive
 * it, so the five features that already own an AbortController keep it.
 */
export function AiTriggerButton({
  lang,
  busy,
  onRun,
  onCancel,
  idleLabelKey,
  idleIcon,
  disabled,
  className,
}: {
  lang: Lang;
  busy: boolean;
  onRun: () => void;
  onCancel: () => void;
  idleLabelKey: TranslationKey;
  idleIcon?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const label = busy ? t(lang, "aiStop") : t(lang, idleLabelKey);
  return (
    <Button
      variant="secondary"
      size="xs"
      onClick={busy ? onCancel : onRun}
      aria-label={label}
      title={label}
      // ★ A real `disabled` attribute, never an `aria-disabled` lookalike —
      //   the lookalike still fires onClick, which here would start a billed
      //   AI call from a control the surface had switched off.
      disabled={disabled}
      // `Button` carries no layout of its own, so the icon+label pair needs the
      // repo's standard inline-flex row; the caller's className still wins by
      // being appended after it.
      className={`inline-flex items-center gap-1${className ? ` ${className}` : ""}`}
    >
      {busy ? <StopIcon aria-hidden="true" className="h-4 w-4" /> : idleIcon}
      <span>{label}</span>
    </Button>
  );
}
