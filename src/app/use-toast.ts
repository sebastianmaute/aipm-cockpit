"use client";
import { useCallback, useEffect, useState } from "react";
import type { TranslationKey } from "./i18n";

export type ToastAction = { labelKey: TranslationKey; run: () => void };
type Toast = { kind: "info" | "error"; text: string; id: number; action?: ToastAction };

export function useToast(): {
  toast: Toast | null;
  showToast: (kind: "info" | "error", text: string) => void;
  showToastAction: (kind: "info" | "error", text: string, action: ToastAction) => void;
} {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on toast.id so a new toast restarts the timer
  }, [toast?.id]);

  const showToast = useCallback((kind: "info" | "error", text: string) => {
    setToast({ kind, text, id: Date.now() });
  }, []);

  const showToastAction = useCallback(
    (kind: "info" | "error", text: string, action: ToastAction) => {
      setToast({ kind, text, id: Date.now(), action });
    },
    [],
  );

  return { toast, showToast, showToastAction };
}
