import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AiPolicyFields } from "./ai-policy-fields";
import { defaultAiConfig } from "../settings-types";
import { DEFAULT_AI_POLICY_ORG, DEFAULT_AI_POLICY_URL } from "../ai-policy";
import { loadI18n, t } from "../i18n";

const orgBox = () => screen.getByRole("textbox", { name: t("en-US", "aiPolicyOrgLabel") });
// type="url" inputs are still role textbox.
const urlBox = () => screen.getByRole("textbox", { name: t("en-US", "aiPolicyUrlLabel") });

describe("AiPolicyFields", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("shows the built-in owner and link when nothing is set", () => {
    render(<AiPolicyFields lang="en-US" ai={defaultAiConfig} onChange={vi.fn()} />);
    expect(orgBox()).toHaveValue(DEFAULT_AI_POLICY_ORG);
    expect(urlBox()).toHaveValue(DEFAULT_AI_POLICY_URL);
  });

  it("reports each edit as its own field", () => {
    const onChange = vi.fn();
    render(<AiPolicyFields lang="en-US" ai={defaultAiConfig} onChange={onChange} />);
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

  it("shows an empty link, not the built-in one, once the owner is someone else", () => {
    // The built-in link is Acme's page; the consent screen offers it only
    // for the built-in owner, and the field must show what the screen will use.
    render(<AiPolicyFields lang="en-US" ai={{ ...defaultAiConfig, policyOrgName: "Acme GmbH" }} onChange={vi.fn()} />);
    expect(urlBox()).toHaveValue("");
  });

  it("says so when the deployment's link was rejected", () => {
    vi.stubEnv("NEXT_PUBLIC_AI_POLICY_URL", "http://intranet/policy");
    render(<AiPolicyFields lang="en-US" ai={defaultAiConfig} onChange={vi.fn()} />);
    expect(screen.getByText(t("en-US", "aiPolicyUrlEnvRejected"))).toBeInTheDocument();
    expect(urlBox()).toBeInTheDocument(); // still editable: the rejected value does not win
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
      expect(de, key).not.toContain("Acme");
    }
  });
});
