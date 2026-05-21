"use client";
import { useEffect, useState } from "react";
import { holidaysForCountries } from "./holidays";

interface UseHolidaySetArgs {
  holidayCountries: string[];
}

export function useHolidaySet({ holidayCountries }: UseHolidaySetArgs): {
  holidaySet: Set<string>;
} {
  const [holidaySet, setHolidaySet] = useState<Set<string>>(
    () => new Set<string>(),
  );

  useEffect(() => {
    let cancelled = false;
    void holidaysForCountries(holidayCountries).then((set) => {
      if (!cancelled) setHolidaySet(set);
    });
    return () => {
      cancelled = true;
    };
  }, [holidayCountries]);

  return { holidaySet };
}
