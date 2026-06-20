"use client";

// Ephemeral session display timezone: an in-memory override over TZ-1's effective
// zone. NOT persisted — resets on reload. Provided above all views (+ popouts) by
// task-manager; the top-bar switcher sets the override; timestamp panels read it.
import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface DisplayTimezoneValue {
  displayTz: string;
  effectiveTz: string;
  isOverridden: boolean;
  setDisplayOverride: (tz: string | undefined) => void;
  resetDisplayTz: () => void;
}

const Ctx = createContext<DisplayTimezoneValue | null>(null);

export function DisplayTimezoneProvider({ effectiveTz, children }: { effectiveTz: string; children: React.ReactNode }) {
  const [override, setOverride] = useState<string | undefined>(undefined);
  const setDisplayOverride = useCallback((tz: string | undefined) => setOverride(tz), []);
  const resetDisplayTz = useCallback(() => setOverride(undefined), []);
  const value = useMemo<DisplayTimezoneValue>(() => ({
    displayTz: override ?? effectiveTz,
    effectiveTz,
    isOverridden: override !== undefined,
    setDisplayOverride,
    resetDisplayTz,
  }), [override, effectiveTz, setDisplayOverride, resetDisplayTz]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDisplayTimezone(): DisplayTimezoneValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDisplayTimezone must be used within DisplayTimezoneProvider");
  return v;
}
