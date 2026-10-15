/** The percentiles the simulation surfaces, in plain words. Pure and i18n-free:
 *  returns the i18n KEY, the caller translates. */
export type SimPercentile = 50 | 80 | 95;

export function percentileWord(p: SimPercentile): "simEvenOdds" | "simSafeToCommit" | "simCautious" {
  switch (p) {
    case 50:
      return "simEvenOdds";
    case 80:
      return "simSafeToCommit";
    case 95:
      return "simCautious";
  }
}
