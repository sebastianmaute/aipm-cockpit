"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { ToastAction } from "./use-toast";

type ShowToast = (kind: "info" | "error", text: string) => void;
type ShowToastAction = (kind: "info" | "error", text: string, action: ToastAction) => void;

interface ToastApi {
  showToast: ShowToast;
  showToastAction: ShowToastAction;
}

const noop: ShowToast = () => {};
const noopAction: ShowToastAction = () => {};
const ToastContext = createContext<ToastApi>({ showToast: noop, showToastAction: noopAction });

/** Provides the toast API to descendants. */
export function ToastProvider({ value, children }: { value: ToastApi; children: ReactNode }) {
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** Ambient showToast (back-compat — most callers use only this). */
export function useToastContext(): ShowToast {
  return useContext(ToastContext).showToast;
}

/** Ambient showToastAction (undo capture uses this). */
export function useToastAction(): ShowToastAction {
  return useContext(ToastContext).showToastAction;
}
