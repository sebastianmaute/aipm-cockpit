import type { Role } from "./types";

export type CostBreakdown = { internal: number; external: number; margin: number };

/** Cost for a given capacity (hours) under a role's rates. No role → all zero. */
export function periodCost(capacityHours: number, role: Role | undefined): CostBreakdown {
  if (!role) return { internal: 0, external: 0, margin: 0 };
  const internal = capacityHours * role.internalRate;
  const external = capacityHours * role.externalRate;
  return { internal, external, margin: external - internal };
}

/** The bare currency symbol for a code (e.g. "EUR" → "€", "USD" → "$"). Falls back to the code itself. */
export function currencySymbol(currency: string, locale: string): string {
  try {
    const part = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Format an amount as currency. Falls back to "<rounded> <code>" if Intl rejects the code. */
export function formatCurrency(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}
