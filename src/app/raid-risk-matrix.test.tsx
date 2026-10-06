import { beforeAll, describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { RiskMatrix } from "./raid-risk-matrix";
import { loadI18n, t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

describe("RiskMatrix — every cell has its own name (§672)", () => {
  beforeAll(() => loadI18n("de"));

  // The 25 cells show only the product of probability and impact, and that product repeats (2 × 3
  // and 3 × 2 both show 6), so each cell is named by its two coordinates instead. Dropping either
  // coordinate from the name would make cells on one row or column sound alike.

  // Without the German dictionary the de case would silently re-run en-US, so pin that it loaded.
  test("renders real German for the de case", () => {
    expect(t("de", "raidImpact")).not.toBe(t("en-US", "raidImpact"));
  });

  test.each(["en-US", "de"] as const)("names all 25 cells distinctly in %s", (lang) => {
    render(<RiskMatrix lang={lang} probability={3} impact={2} onPick={() => {}} />);
    expectRowUniqueNames({ minControls: 25 });
  });
});
