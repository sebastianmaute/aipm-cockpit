import { describe, it, expect, vi } from "vitest";
import { buildMailtoUrl, stakeholderEmail, resolveDraftRecipient } from "./mailto";

describe("buildMailtoUrl", () => {
  it("builds a percent-encoded mailto URL", () => {
    const url = buildMailtoUrl("a b@x.io", "Re: A&B", "Hi\nthere");
    expect(url).toBe("mailto:a%20b%40x.io?subject=Re%3A%20A%26B&body=Hi%0Athere");
  });

  it("encodes carriage return in body", () => {
    const url = buildMailtoUrl("x@x.io", "S", "line1\r\nline2");
    expect(url).toContain("%0D");
  });

  it("encodes + in email address", () => {
    const url = buildMailtoUrl("a+b@x.io", "S", "B");
    expect(url).toContain("a%2Bb%40x.io");
  });

  it("double-encodes a literal %0A in subject", () => {
    const url = buildMailtoUrl("x@x.io", "line%0Abreak", "B");
    expect(url).toContain("%250A");
  });

  it("encodes umlaut in body", () => {
    const url = buildMailtoUrl("x@x.io", "S", "schön");
    expect(url).toContain("%C3%B6");
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

describe("resolveDraftRecipient", () => {
  const isValid = (e: string) => /.+@.+\..+/.test(e);
  const resources = [{ id: 7, email: "linked@x.io" }] as never;

  it("returns direct email without calling prompt", () => {
    const prompt = vi.fn(() => null);
    expect(resolveDraftRecipient({ email: "direct@x.io", resourceId: 7 }, resources, prompt, isValid)).toBe("direct@x.io");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("returns resource email without calling prompt when no direct email", () => {
    const prompt = vi.fn(() => null);
    expect(resolveDraftRecipient({ email: undefined, resourceId: 7 }, resources, prompt, isValid)).toBe("linked@x.io");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("prompts and returns a valid email when no email exists", () => {
    const prompt = vi.fn(() => "new@example.com");
    expect(resolveDraftRecipient({ email: undefined, resourceId: null }, [], prompt, isValid)).toBe("new@example.com");
  });

  it("returns null when prompt is cancelled (null)", () => {
    const prompt = vi.fn(() => null);
    expect(resolveDraftRecipient({ email: undefined, resourceId: null }, [], prompt, isValid)).toBeNull();
  });

  it("returns null when prompt returns empty string", () => {
    expect(resolveDraftRecipient({ email: undefined, resourceId: null }, [], () => "", isValid)).toBeNull();
  });

  it("returns null when prompt returns whitespace-only string", () => {
    expect(resolveDraftRecipient({ email: undefined, resourceId: null }, [], () => "   ", isValid)).toBeNull();
  });

  it("returns null and calls onInvalid when prompt returns an invalid email", () => {
    const onInvalid = vi.fn();
    const result = resolveDraftRecipient({ email: undefined, resourceId: null }, [], () => "not-an-email", isValid, onInvalid);
    expect(result).toBeNull();
    expect(onInvalid).toHaveBeenCalledTimes(1);
  });
});
