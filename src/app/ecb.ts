import { SUPPORTED_CURRENCIES, type FxRates } from "./types";

/**
 * Parse the ECB euro foreign-exchange daily reference XML into an EUR-base
 * FxRates table. Keeps only SUPPORTED_CURRENCIES; always sets EUR = 1.
 * Returns null when the date or rate cube can't be found. Pure (regex-based,
 * no DOM) so it runs in both Node (route) and tests.
 */
export function parseEcbDailyXml(xml: string, fetchedAt: string): FxRates | null {
  const timeMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/);
  if (!timeMatch) return null;
  const date = timeMatch[1];
  const rates: Record<string, number> = { EUR: 1 };
  const supported = new Set<string>(SUPPORTED_CURRENCIES);
  const re = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(xml))) {
    found = true;
    const code = m[1];
    const rate = Number(m[2]);
    if (supported.has(code) && Number.isFinite(rate) && rate > 0) rates[code] = rate;
  }
  if (!found) return null;
  return { base: "EUR", date, fetchedAt, rates };
}
