// `date-holidays` pulls in moment + moment-timezone (~100 KB+ gzipped) for
// its calendar arithmetic. Importing it eagerly would put that cost in
// every initial page load, even for the default user state of "no
// countries selected" (in which case we never need a holiday list at all).
// Instead, hold a lazy reference and load it the first time a non-empty
// `codes` array actually asks for holiday data.
type HolidaysCtor = typeof import("date-holidays").default;
let pendingHolidays: Promise<HolidaysCtor> | null = null;

function loadHolidaysCtor(): Promise<HolidaysCtor> {
  if (!pendingHolidays) {
    pendingHolidays = import("date-holidays").then((mod) => mod.default);
  }
  return pendingHolidays;
}

export type Country = {
  code: string;
  nameEn: string;
  nameDe: string;
};

export const COUNTRIES: Country[] = [
  { code: "DE", nameEn: "Germany", nameDe: "Deutschland" },
  { code: "CH", nameEn: "Switzerland", nameDe: "Schweiz" },
  { code: "AT", nameEn: "Austria", nameDe: "Österreich" },
  { code: "FR", nameEn: "France", nameDe: "Frankreich" },
  { code: "ES", nameEn: "Spain", nameDe: "Spanien" },
  { code: "GB", nameEn: "United Kingdom", nameDe: "Vereinigtes Königreich" },
  { code: "IE", nameEn: "Ireland", nameDe: "Irland" },
  { code: "NO", nameEn: "Norway", nameDe: "Norwegen" },
  { code: "SE", nameEn: "Sweden", nameDe: "Schweden" },
  { code: "DK", nameEn: "Denmark", nameDe: "Dänemark" },
  { code: "BG", nameEn: "Bulgaria", nameDe: "Bulgarien" },
  { code: "IN", nameEn: "India", nameDe: "Indien" },
  { code: "CN", nameEn: "China", nameDe: "China" },
];

const cache = new Map<string, Set<string>>();

async function holidaysForCountry(
  Holidays: HolidaysCtor,
  code: string,
  year: number,
): Promise<string[]> {
  const key = `${code}:${year}`;
  const cached = cache.get(key);
  if (cached) return Array.from(cached);

  const set = new Set<string>();
  try {
    const hd = new Holidays(code);
    const list = hd.getHolidays(year) || [];
    for (const h of list) {
      if (h.type === "public" || h.type === "bank") {
        set.add(h.date.slice(0, 10));
      }
    }
  } catch {
    // unknown country code — leave set empty
  }
  cache.set(key, set);
  return Array.from(set);
}

/**
 * Async because the underlying `date-holidays` library is now lazy-loaded
 * (it transitively bundles moment + moment-timezone). Empty `codes`
 * short-circuits to an empty Set without ever triggering the dynamic
 * import — the bundle win for the default "no holiday countries" state.
 */
export async function holidaysForCountries(
  codes: string[],
  yearsAhead = 1,
): Promise<Set<string>> {
  const set = new Set<string>();
  if (codes.length === 0) return set;
  const Holidays = await loadHolidaysCtor();
  const startYear = new Date().getUTCFullYear();
  const endYear = startYear + yearsAhead;
  for (const code of codes) {
    for (let y = startYear; y <= endYear; y++) {
      for (const d of await holidaysForCountry(Holidays, code, y)) {
        set.add(d);
      }
    }
  }
  return set;
}
