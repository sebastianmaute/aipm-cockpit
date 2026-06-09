"use client";
import { createContext, useContext, type ReactNode } from "react";

type ShowToast = (kind: "info" | "error", text: string) => void;

const noop: ShowToast = () => {};

const ToastContext = createContext<ShowToast>(noop);

/** Provides `showToast` to descendants (editors fire the save-time adjustment toast through it). */
export function ToastProvider({ value, children }: { value: ShowToast; children: ReactNode }) {
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** Returns the ambient showToast, or a no-op when no provider is mounted (e.g. isolated tests). */
export function useToastContext(): ShowToast {
  return useContext(ToastContext);
}
