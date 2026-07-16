"use client";

import { useEffect, type RefObject } from "react";

/** Grows a textarea to fit content (reset height -> read scrollHeight -> set inline height). */
export function useAutogrow(ref: RefObject<HTMLTextAreaElement | null>, value: string): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}
