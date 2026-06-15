import { describe, it, expect } from "vitest";
import { buildMailtoUrl, stakeholderEmail } from "./mailto";

describe("buildMailtoUrl", () => {
  it("builds a percent-encoded mailto URL", () => {
    const url = buildMailtoUrl("a b@x.io", "Re: A&B", "Hi\nthere");
    expect(url).toBe("mailto:a%20b%40x.io?subject=Re%3A%20A%26B&body=Hi%0Athere");
  });
});

describe("stakeholderEmail", () => {
  const resources = [{ id: 7, email: "linked@x.io" }] as never;
  it("prefers the stakeholder's own email", () => {
    expect(stakeholderEmail({ email: "direct@x.io", resourceId: 7 }, resources)).toBe("direct@x.io");
  });
  it("falls back to the linked resource email", () => {
    expect(stakeholderEmail({ email: undefined, resourceId: 7 }, resources)).toBe("linked@x.io");
  });
  it("returns undefined when neither has an email", () => {
    expect(stakeholderEmail({ email: undefined, resourceId: null }, resources)).toBeUndefined();
  });
});
