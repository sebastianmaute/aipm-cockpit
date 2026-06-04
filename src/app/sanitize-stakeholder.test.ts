import { describe, expect, it } from "vitest";
import { sanitizeStakeholder, encodeRaciMap, decodeRaciMap } from "./sanitize";

describe("encodeRaciMap / decodeRaciMap", () => {
  it("round-trips numeric keys with R/A/C/I values and drops junk", () => {
    expect(encodeRaciMap({ "10": "A", "12": "C" })).toBe("10=A|12=C");
    expect(decodeRaciMap("10=A|12=C")).toEqual({ "10": "A", "12": "C" });
    expect(decodeRaciMap("x=A|12=Z|13=R")).toEqual({ "13": "R" });
    expect(decodeRaciMap("")).toEqual({});
  });
});

describe("sanitizeStakeholder", () => {
  it("requires id>0 and name", () => {
    expect(sanitizeStakeholder({ id: 0, name: "x" })).toBeNull();
    expect(sanitizeStakeholder({ id: 1, name: "" })).toBeNull();
  });
  it("clamps enums to valid values and keeps a valid raci map", () => {
    const s = sanitizeStakeholder({
      id: 2, name: "Sponsor Sam", category: "Bogus", influence: "High",
      interest: "nope", resourceId: "5", raci: { "10": "A", "11": "Q" },
    });
    expect(s).not.toBeNull();
    expect(s!.category).toBe("Other");
    expect(s!.influence).toBe("High");
    expect(s!.interest).toBe("Medium");
    expect(s!.resourceId).toBe(5);
    expect(s!.raci).toEqual({ "10": "A" });
  });
  it("accepts the raci map as an encoded string too", () => {
    const s = sanitizeStakeholder({ id: 3, name: "Vee", raci: "10=R|12=I" });
    expect(s!.raci).toEqual({ "10": "R", "12": "I" });
  });
});
