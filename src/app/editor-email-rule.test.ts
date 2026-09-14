import { describe, expect, it } from "vitest";
import {
  emailFlagDescribedBy,
  emailFlagVisible,
  emailRefusalMessage,
  joinDescribedBy,
  linkedResourceEmail,
} from "./editor-email-rule";
import { t } from "./i18n";
import type { Resource } from "./types";

const EN = "en-US" as const;

function makeResource(over: Partial<Resource> = {}): Resource {
  return {
    id: 1,
    firstName: "Ada",
    lastName: "L",
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    ...over,
  };
}

describe("linkedResourceEmail", () => {
  const resources = [makeResource({ id: 7, email: "ada@x.com" })];

  it("returns the linked resource's stored email", () => {
    expect(linkedResourceEmail(resources, 7)).toBe("ada@x.com");
  });

  it("returns undefined for a null id", () => {
    expect(linkedResourceEmail(resources, null)).toBeUndefined();
  });

  it("returns undefined for an undefined id", () => {
    expect(linkedResourceEmail(resources, undefined)).toBeUndefined();
  });

  it("returns undefined when the id resolves to nothing", () => {
    expect(linkedResourceEmail(resources, 999)).toBeUndefined();
  });
});

describe("emailRefusalMessage", () => {
  it("returns null for a write-safe value", () => {
    expect(emailRefusalMessage(EN, "a@b.co", undefined)).toBeNull();
  });

  it("returns null for a blank value", () => {
    expect(emailRefusalMessage(EN, "", "old@x.com")).toBeNull();
  });

  it("returns the invalid-format message", () => {
    expect(emailRefusalMessage(EN, "nope", undefined)).toBe(t(EN, "errorInvalidEmail"));
  });

  it("returns the delimiter message", () => {
    expect(emailRefusalMessage(EN, "a,b@x.com", undefined)).toBe(t(EN, "errorEmailDelimiter"));
  });

  it("exempts an unchanged value against `stored`, even when unsafe", () => {
    expect(emailRefusalMessage(EN, "a,b@x.com", "a,b@x.com")).toBeNull();
  });

  it("exempts a value that matches a copy source", () => {
    expect(emailRefusalMessage(EN, "a,b@x.com", "old@x.com", ["a,b@x.com"])).toBeNull();
  });

  it("refuses a changed value even with an unrelated copy source present", () => {
    expect(emailRefusalMessage(EN, "a,b@x.com", "old@x.com", ["someone-else@x.com"])).toBe(
      t(EN, "errorEmailDelimiter"),
    );
  });
});

describe("emailFlagVisible", () => {
  it("is false for a clean value", () => {
    expect(emailFlagVisible(EN, "a@b.co", null)).toBe(false);
  });

  it("is false for a blank value", () => {
    expect(emailFlagVisible(EN, undefined, null)).toBe(false);
  });

  it("is true for an unsafe value with no banner error", () => {
    expect(emailFlagVisible(EN, "a,b@x.com", null)).toBe(true);
  });

  // IMPORTANT 1 ruling: an UNRELATED banner error never hides the flag.
  it("stays true while the banner shows an unrelated error", () => {
    expect(emailFlagVisible(EN, "a,b@x.com", t(EN, "raidErrorTitleRequired"))).toBe(true);
  });

  // The flag steps aside ONLY when the banner shows this exact same refusal.
  it("is false while the banner shows the identical refusal message", () => {
    expect(emailFlagVisible(EN, "a,b@x.com", t(EN, "errorEmailDelimiter"))).toBe(false);
  });

  it("distinguishes the invalid-format message from the delimiter one", () => {
    // Banner shows the DELIMITER text but the field is INVALID-format unsafe —
    // different reasons, so the flag must still show.
    expect(emailFlagVisible(EN, "nope", t(EN, "errorEmailDelimiter"))).toBe(true);
  });
});

describe("emailFlagDescribedBy", () => {
  it("returns the id when the flag is visible", () => {
    expect(emailFlagDescribedBy("x-error", EN, "a,b@x.com", null)).toBe("x-error");
  });

  it("returns undefined when the flag steps aside for the same banner message", () => {
    expect(emailFlagDescribedBy("x-error", EN, "a,b@x.com", t(EN, "errorEmailDelimiter"))).toBeUndefined();
  });

  it("returns undefined for a clean value", () => {
    expect(emailFlagDescribedBy("x-error", EN, "a@b.co", null)).toBeUndefined();
  });
});

describe("joinDescribedBy", () => {
  it("joins multiple ids with a space", () => {
    expect(joinDescribedBy("a-counter", "a-error")).toBe("a-counter a-error");
  });

  it("drops falsy entries", () => {
    expect(joinDescribedBy("a-counter", undefined)).toBe("a-counter");
  });

  it("returns undefined when nothing remains", () => {
    expect(joinDescribedBy(undefined, undefined)).toBeUndefined();
  });
});
