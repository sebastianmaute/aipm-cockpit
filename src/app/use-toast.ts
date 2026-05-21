"use client";
import { useCallback, useEffect, useState } from "react";

type Toast = { kind: "info" | "error"; text: string; id: number };

export function useToast(): {
  toast: Toast | null;
  showToast: (kind: "info" | "error", text: string) => void;
} {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast?.id]);

  const showToast = useCallback((kind: "info" | "error", text: string) => {
    setToast({ kind, text, id: Date.now() });
  }, []);

  return { toast, showToast };
}
