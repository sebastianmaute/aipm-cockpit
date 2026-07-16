"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TranslationKey } from "./i18n";

/** Auto-dismiss delay for a toast (ms). Hover/focus pauses it. */
export const TOAST_DURATION_MS = 7000;

export type ToastAction = { labelKey: TranslationKey; run: () => void };
export type ToastKind = "info" | "error" | "success";
export type Toast = { kind: ToastKind; text: string; id: number; action?: ToastAction };

export function useToast(): {
  toast: Toast | null;
  showToast: (kind: ToastKind, text: string) => void;
  showToastAction: (kind: ToastKind, text: string, action: ToastAction) => void;
  pause: () => void;
  resume: () => void;
} {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);

  const clear = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const arm = useCallback(() => {
    clear();
    if (!pausedRef.current) timerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  useEffect(() => {
    if (toast) arm();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on toast.id so a new toast restarts the timer
  }, [toast?.id]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    clear();
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    arm();
  }, [arm]);

  const showToast = useCallback((kind: ToastKind, text: string) => {
    pausedRef.current = false;
    setToast({ kind, text, id: Date.now() });
  }, []);

  const showToastAction = useCallback((kind: ToastKind, text: string, action: ToastAction) => {
    pausedRef.current = false;
    setToast({ kind, text, id: Date.now(), action });
  }, []);

  return { toast, showToast, showToastAction, pause, resume };
}
