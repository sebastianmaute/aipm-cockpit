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
    // Named separately because it is the literal symptom 283 records, so a
    // reader grepping for the defect finds a block that states it.
    // ★ It is STRICTLY SUBSUMED by the block above — `toBe("Bob Jones")` on the
    //   same input already implies this — so it cannot fail on its own and adds
    //   no coverage. Kept for the name, not for the assertion.
    expect(contactDisplay(cp("Bob Jones", ""))).not.toContain("<>");
  });

  it("keeps a name that is itself empty from inventing content", () => {
    expect(contactDisplay(cp("", ""))).toBe("");
  });
});
