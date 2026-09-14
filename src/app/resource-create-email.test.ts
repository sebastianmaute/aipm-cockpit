import { describe, expect, it } from "vitest";
import { creatableResourceEmail } from "./resource-create-email";
import { editorEmailRefusalMessage, linkedResourceEmail } from "./editor-email-rule";
import { EMAIL_MAX } from "./sanitize";
import { t } from "./i18n";
import type { Resource } from "./types";

describe("creatableResourceEmail", () => {
  it("keeps a write-safe email, trimmed", () => {
    expect(creatableResourceEmail(" bob@x.com ")).toBe("bob@x.com");
  });

  it("drops a delimiter-bearing or malformed email, and a blank one", () => {
    expect(creatableResourceEmail("a,b@x.com")).toBeUndefined();
    expect(creatableResourceEmail("a;b@x.com")).toBeUndefined();
    expect(creatableResourceEmail("nope")).toBeUndefined();
    expect(creatableResourceEmail("   ")).toBeUndefined();
  });

  it("judges the capped value that would be stored", () => {
    const long = `a@b.${"c".repeat(EMAIL_MAX)}`;
    expect(creatableResourceEmail(long)).toBe(long.slice(0, EMAIL_MAX));
  });

  it("a resource created without the unsafe email is no copy source, so the host editor still refuses it", () => {
    const bob: Resource = { id: 5, firstName: "Bob", lastName: "", email: creatableResourceEmail("a,b@x.com"), roleId: null, utilizationMode: "percent", utilization: {} };
    expect(editorEmailRefusalMessage("en-US", "a,b@x.com", undefined, [linkedResourceEmail([bob], 5)])).toBe(t("en-US", "errorEmailDelimiter"));
    // Positive control: had the unsafe value been stored, the copy exemption would pass it.
    const laundered: Resource = { ...bob, email: "a,b@x.com" };
    expect(editorEmailRefusalMessage("en-US", "a,b@x.com", undefined, [linkedResourceEmail([laundered], 5)])).toBeNull();
  });
});
