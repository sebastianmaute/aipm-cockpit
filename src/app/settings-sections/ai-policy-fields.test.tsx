import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AiPolicyFields } from "./ai-policy-fields";
import { defaultAiConfig } from "../settings-types";
import { loadI18n, t } from "../i18n";

const orgBox = () => screen.getByRole("textbox", { name: t("en-US", "aiPolicyOrgLabel") });
// type="url" inputs are still role textbox.
const urlBox = () => screen.getByRole("textbox", { name: t("en-US", "aiPolicyUrlLabel") });

describe("AiPolicyFields", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("shows both fields empty when nothing is set — there is no built-in default", () => {
    render(<AiPolicyFields lang="en-US" ai={defaultAiConfig} onChange={vi.fn()} />);
    expect(orgBox()).toHaveValue("");
    expect(urlBox()).toHaveValue("");
  });

  it("reports each edit as its own field", () => {
    const onChange = vi.fn();
    // A non-empty starting link: there is no built-in default, so an empty starting
    // value would make the "clear" fireEvent below a same-value no-op React ignores.
    render(<AiPolicyFields lang="en-US" ai={{ ...defaultAiConfig, policyUrl: "https://acme.example/ai" }} onChange={onChange} />);
    fireEvent.change(orgBox(), { target: { value: "Acme GmbH" } });
    expect(onChange).toHaveBeenLastCalledWith({ policyOrgName: "Acme GmbH" });
    fireEvent.change(urlBox(), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ policyUrl: "" });
  });

  it("flags a link that is not a full https URL", () => {
    render(<AiPolicyFields lang="en-US" ai={{ ...defaultAiConfig, policyUrl: "acme.example/ai" }} onChange={vi.fn()} />);
    expect(urlBox()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(t("en-US", "aiPolicyUrlInvalid"));
  });

  it("does not flag an empty link — that means no policy", () => {
    render(<AiPolicyFields lang="en-US" ai={{ ...defaultAiConfig, policyUrl: "" }} onChange={vi.fn()} />);
    expect(urlBox()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an empty link when an owner is set but no link is stored", () => {
    // There is no built-in link for any owner; the field must show what the
    // consent screen will actually use.
    render(<AiPolicyFields lang="en-US" ai={{ ...defaultAiConfig, policyOrgName: "Acme GmbH" }} onChange={vi.fn()} />);
    expect(urlBox()).toHaveValue("");
  });

  it("says so when the deployment's link was rejected, as the field's description", () => {
    vi.stubEnv("NEXT_PUBLIC_AI_POLICY_URL", "http://intranet/policy");
    render(<AiPolicyFields lang="en-US" ai={defaultAiConfig} onChange={vi.fn()} />);
    expect(urlBox()).toHaveAccessibleDescription(expect.stringContaining(t("en-US", "aiPolicyUrlEnvRejected")));
  });

  // ★★ There is no built-in link, so a never-stored link means the consent screen
  //    shows no policy step. That must be SAID, on the field itself — for any owner.
  it.each([
    ["nothing set", undefined],
    ["cleared", ""],
    ["a custom owner", "Globex GmbH"],
  ])("explains the missing link when the owner is %s", (_label, owner) => {
    render(<AiPolicyFields lang="en-US" ai={{ ...defaultAiConfig, policyOrgName: owner }} onChange={vi.fn()} />);
    expect(urlBox()).toHaveValue("");
    expect(urlBox()).toHaveAccessibleDescription(expect.stringContaining(t("en-US", "aiPolicyUrlNoBuiltin")));
  });

  it("shows no such note once a link is entered", () => {
    render(<AiPolicyFields lang="en-US" ai={{ ...defaultAiConfig, policyOrgName: "Acme", policyUrl: "https://acme.example/p" }} onChange={vi.fn()} />);
    expect(screen.queryByText(t("en-US", "aiPolicyUrlNoBuiltin"))).toBeNull();
  });

  it("replaces a field with a note when the deployment sets it", () => {
    vi.stubEnv("NEXT_PUBLIC_AI_POLICY_URL", "https://globex.example/policy");
    render(<AiPolicyFields lang="en-US" ai={defaultAiConfig} onChange={vi.fn()} />);
    expect(screen.queryByRole("textbox", { name: t("en-US", "aiPolicyUrlLabel") })).toBeNull();
    expect(screen.getByText(t("en-US", "aiPolicyUrlFromEnv"))).toBeInTheDocument();
    // The owner field is not overridden, so it stays editable.
    expect(orgBox()).toBeInTheDocument();
  });
});

describe("AI policy strings in German", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("puts the configured owner into all three consent strings", () => {
    for (const key of ["aiConsentBullet6", "aiConsentPolicyLink", "aiConsentPolicyCheckbox"] as const) {
      const de = t("de", key, "Acme GmbH");
      expect(de, key).toContain("Acme GmbH");
      expect(de, key).not.toBe(t("en-US", key, "Acme GmbH"));
    }
  });
});
