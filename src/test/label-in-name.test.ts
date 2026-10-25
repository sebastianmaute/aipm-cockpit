import { describe, expect, it } from "vitest";
import { curateTokens, expectLabelInName, isLabelInName, visibleText } from "./label-in-name";

function el(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild as HTMLElement;
}

describe("label-in-name helper (mirrors axe 4.14 isLabelContainedInName)", () => {
  it("curates to case-folded word tokens, dropping punctuation and parentheticals", () => {
    expect(curateTokens("Priority: High – Stakeholder workshop (2)")).toEqual(["priority", "high", "stakeholder", "workshop"]);
    expect(curateTokens("#1 Design ↑ +3%")).toEqual(["1", "design", "3"]);
  });

  it("is containment of a contiguous token run, not a prefix and not a substring", () => {
    expect(isLabelInName("Type for next link", "Predecessor type for next link")).toBe(true);
    expect(isLabelInName("HIGH", "Priority high – Row")).toBe(true);
    expect(isLabelInName("Complete 45", "Complete – 45")).toBe(true);
    // Every word present, but not as one contiguous run.
    expect(isLabelInName("Complete 45 12", "Complete 45 Complete: 45% 3 12")).toBe(false);
    // A substring of a word is not a word.
    expect(isLabelInName("Stat", "Status – 3 selected")).toBe(false);
  });

  it("joins sibling text with no separator, as axe does", () => {
    const chip = el('<button aria-label="Status – 3 selected"><span>Status</span><span>3</span></button>');
    expect(visibleText(chip)).toBe("Status3");
    expect(() => expectLabelInName(chip)).toThrow(/not contained/);
    const spaced = el('<button aria-label="Status – 3 selected"><span>Status</span> <span>3</span></button>');
    expect(() => expectLabelInName(spaced)).not.toThrow();
  });

  it("counts aria-hidden text as visible but not sr-only text", () => {
    const bell = el('<button aria-label="Notifications"><svg aria-hidden="true"><title>x</title></svg><span aria-hidden="true">3</span></button>');
    expect(visibleText(bell)).toBe("3");
    expect(() => expectLabelInName(bell)).toThrow(/not contained/);
    const sr = el('<button aria-label="Open"><span class="sr-only">hidden words</span>Open</button>');
    expect(visibleText(sr)).toBe("Open");
    expect(() => expectLabelInName(sr)).not.toThrow();
  });

  it("refuses a control with no visible words (vacuous pass)", () => {
    expect(() => expectLabelInName(el('<button aria-label="Close">–</button>'))).toThrow(/no visible words/);
  });
});
