import { describe, expect, it } from "vitest";
import { emailWriteRefusal, findTornEmail, isWriteSafeEmail } from "./sanitize";

describe("isWriteSafeEmail", () => {
  it("accepts a plain address and refuses a malformed or delimiter-bearing one", () => {
    expect(isWriteSafeEmail("ada@example.com")).toBe(true);
    expect(isWriteSafeEmail("  ada@example.com  ")).toBe(true);
    expect(isWriteSafeEmail("ada")).toBe(false);
    expect(isWriteSafeEmail("a,b@x.com")).toBe(false);
    expect(isWriteSafeEmail("a;b@x.com")).toBe(false);
    expect(isWriteSafeEmail("")).toBe(false);
  });
});

describe("emailWriteRefusal — the one scalar rule", () => {
  it("never refuses a blank value (clearing is legal)", () => {
    expect(emailWriteRefusal("", "a,b@x.com")).toBeNull();
    expect(emailWriteRefusal("   ", undefined)).toBeNull();
  });

  it("never refuses an unchanged value, even when the stored value is unsafe", () => {
    expect(emailWriteRefusal("a,b@x.com", "a,b@x.com")).toBeNull();
    expect(emailWriteRefusal(" not-an-email ", "not-an-email")).toBeNull();
  });

  it("refuses a CHANGED malformed value as invalid", () => {
    expect(emailWriteRefusal("nope", "ada@example.com")).toBe("invalid");
    expect(emailWriteRefusal("nope", undefined)).toBe("invalid");
  });

  it("refuses a CHANGED delimiter-bearing value as delimiter, since isValidEmail accepts it", () => {
    expect(emailWriteRefusal("a,b@x.com", undefined)).toBe("delimiter");
    expect(emailWriteRefusal("a;b@x.com", "ada@example.com")).toBe("delimiter");
  });

  it("accepts a changed write-safe value on create and on update", () => {
    expect(emailWriteRefusal("grace@example.com", undefined)).toBeNull();
    expect(emailWriteRefusal("grace@example.com", "ada@example.com")).toBeNull();
  });

  it("exempts a copy of a source's stored email (decision 2) and nothing else", () => {
    expect(emailWriteRefusal("a,b@x.com", "old@x.com", ["a,b@x.com"])).toBeNull();
    expect(emailWriteRefusal(" a,b@x.com ", undefined, [undefined, "a,b@x.com "])).toBeNull();
    expect(emailWriteRefusal("c,d@x.com", "old@x.com", ["a,b@x.com"])).toBe("delimiter");
  });
});

describe("findTornEmail — the list form of the same rule", () => {
  it("refuses a NEW array member that is not write-safe, malformed ones included", () => {
    expect(findTornEmail(["a@x.com", "not-an-email"], undefined)).toBe("not-an-email");
    expect(findTornEmail(["a@x.com", "b,c@x.com"], ["a@x.com"])).toBe("b,c@x.com");
  });

  it("never refuses a member already stored, or a blank member", () => {
    expect(findTornEmail(["not-an-email", ""], ["not-an-email"])).toBeUndefined();
    expect(findTornEmail([" a,b@x.com "], ["a,b@x.com"])).toBeUndefined();
  });

  it("for a STRING, still refuses a contained stored unsafe address", () => {
    expect(findTornEmail("a,b@x.com, c@y.com", ["a,b@x.com"])).toBe("a,b@x.com");
  });

  it("for a STRING, refuses a new split member that is not write-safe", () => {
    expect(findTornEmail("x,y@z.com", undefined)).toBe("x");
    expect(findTornEmail("c@y.com; nope", ["c@y.com"])).toBe("nope");
  });

  it("for a STRING, accepts a delimited list of write-safe addresses", () => {
    expect(findTornEmail("a@x.com, b@y.com", undefined)).toBeUndefined();
    expect(findTornEmail("", ["a,b@x.com"])).toBeUndefined();
  });
});
