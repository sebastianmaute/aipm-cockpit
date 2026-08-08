import { LABEL_MAX, sanitizeText } from "./sanitize";

/** A single transformation a sanitizer applied to user input, or null if none. */
export type Adjustment =
  | { kind: "truncated"; max: number; removed: number }
  | { kind: "clamped"; bound: "min" | "max"; to: number }
  | { kind: "stripped"; chars: string[] }
  | null;

export interface Report<T> {
  value: T;
  adjustment: Adjustment;
}

/** Cap a string to `max`, reporting how many characters were removed. */
export function describeTextCap(raw: string, max: number): Report<string> {
  if (typeof raw !== "string" || raw.length <= max) {
    return { value: typeof raw === "string" ? raw : "", adjustment: null };
  }
  return {
    value: raw.slice(0, max),
    adjustment: { kind: "truncated", max, removed: raw.length - max },
  };
}

/** Parse + clamp a numeric string. Empty -> undefined (a blank cell is valid). */
export function describeClamp(
  raw: string,
  opts: { min?: number; max?: number; round?: number },
): Report<number | undefined> {
  const trimmed = (typeof raw === "string" ? raw : "").trim();
  if (trimmed === "") return { value: undefined, adjustment: null };
  const round = (n: number) =>
    opts.round != null ? Math.round(n * 10 ** opts.round) / 10 ** opts.round : n;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    const to = round(opts.min ?? 0);
    return { value: to, adjustment: { kind: "clamped", bound: "min", to } };
  }
  if (opts.min != null && num < opts.min) {
    const to = round(opts.min);
    return { value: to, adjustment: { kind: "clamped", bound: "min", to } };
  }
  if (opts.max != null && num > opts.max) {
    const to = round(opts.max);
    return { value: to, adjustment: { kind: "clamped", bound: "max", to } };
  }
  return { value: round(num), adjustment: null };
}

const LABEL_SEPARATORS = /[|,\r\n\t]/g;

/** Mirror sanitizeLabel: collapse separators to a space, trim, cap. Report stripped chars. */
export function describeLabelStrip(raw: string): Report<string> {
  if (typeof raw !== "string") return { value: "", adjustment: null };
  const matches = raw.match(LABEL_SEPARATORS);
  // ★★ Caps via `sanitizeText` (hence `clipText`), NOT a raw `.slice` — see
  // `sanitizeLabel`, which this mirrors by contract. A bare slice split a
  // surrogate pair at the cap boundary (§22) and would make the two disagree.
  const value = sanitizeText(raw.replace(/[|,\r\n\t]+/g, " "), LABEL_MAX);
  if (!matches) return { value, adjustment: null };
  const label = (c: string) =>
    c === "\r" ? "\\r" : c === "\n" ? "\\n" : c === "\t" ? "\\t" : c;
  const chars = [...new Set(matches.map(label))];
  return { value, adjustment: { kind: "stripped", chars } };
}
