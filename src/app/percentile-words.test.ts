import { describe, it, expect } from "vitest";
import { percentileWord } from "./percentile-words";
import { t } from "./i18n";

describe("percentileWord", () => {
  it("maps each percentile to its plain-word i18n key", () => {
    expect(percentileWord(50)).toBe("simEvenOdds");
    expect(percentileWord(80)).toBe("simSafeToCommit");
    expect(percentileWord(95)).toBe("simCautious");
  });

  it("resolves to the agreed English words", () => {
    expect(t("en-US", percentileWord(50))).toBe("Even odds");
    expect(t("en-US", percentileWord(80))).toBe("Safe to commit");
    expect(t("en-US", percentileWord(95))).toBe("Cautious");
  });
});
