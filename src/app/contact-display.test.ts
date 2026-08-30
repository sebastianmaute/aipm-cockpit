import { describe, expect, it } from "vitest";
import { contactDisplay } from "./contact-display";

const cp = (name: string, email: string) => ({ name, email });

describe("contactDisplay", () => {
  it("joins the address in angle brackets when there is one", () => {
    expect(contactDisplay(cp("Bob Jones", "bob@example.com"))).toBe("Bob Jones <bob@example.com>");
  });

  it("emits no angle brackets at all when the address is empty", () => {
    expect(contactDisplay(cp("Bob Jones", ""))).toBe("Bob Jones");
  });

  it("does not emit an empty angle-bracket pair", () => {
    // The literal defect 283 records. Kept apart from the block above so a
    // regression that produced "Bob Jones <> " (trailing space, no brackets)
    // still fails exactly one of the two.
    expect(contactDisplay(cp("Bob Jones", ""))).not.toContain("<>");
  });

  it("keeps a name that is itself empty from inventing content", () => {
    expect(contactDisplay(cp("", ""))).toBe("");
  });
});
