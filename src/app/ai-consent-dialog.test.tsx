import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiConsentDialog } from "./ai-consent-dialog";
import { resolveAiPolicy } from "./ai-policy";
import { t } from "./i18n";

// The organisation policy block reads `resolveAiPolicy` (ai-policy.ts): owner + link, or no block at all.
function renderDialog(
  policy: { policyOrgName?: string; policyUrl?: string },
  handlers: { onAccept?: () => void; onCancel?: () => void } = {},
) {
  return render(
    <AiConsentDialog
      lang="en-US"
      level="interactive"
      policy={resolveAiPolicy(policy)}
      onAccept={handlers.onAccept ?? vi.fn()}
      onCancel={handlers.onCancel ?? vi.fn()}
    />,
  );
}

describe("AiConsentDialog", () => {
  it("is a named modal dialog showing the disclosure bullets", () => {
    renderDialog({});
    expect(screen.getByRole("dialog", { name: t("en-US", "aiConsentTitle") })).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "aiConsentBullet1"))).toBeInTheDocument();
  });

  it("with a configured policy, Accept stays disabled until the policy checkbox is ticked", () => {
    const onAccept = vi.fn();
    renderDialog({ policyOrgName: "Acme GmbH", policyUrl: "https://acme.example/ai-policy" }, { onAccept });
    const accept = screen.getByRole("button", { name: t("en-US", "aiConsentAccept") });
    expect(accept).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(accept).not.toBeDisabled();
    fireEvent.click(accept);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("names the configured policy owner in the bullet, the link and the checkbox, and links the configured URL", () => {
    renderDialog({ policyOrgName: "Acme GmbH", policyUrl: "https://acme.example/ai-policy" });
    expect(screen.getByText(t("en-US", "aiConsentBullet6", "Acme GmbH"))).toBeInTheDocument();
    const link = screen.getByRole("link", { name: new RegExp(t("en-US", "aiConsentPolicyLink", "Acme GmbH")) });
    expect(link).toHaveAttribute("href", "https://acme.example/ai-policy");
    expect(screen.getByText(t("en-US", "aiConsentPolicyCheckbox", "Acme GmbH"))).toBeInTheDocument();
  });

  it("with no policy link, drops the policy block and enables Accept on its own", () => {
    renderDialog({ policyUrl: "" });
    // Positive control: the rest of the dialog rendered.
    expect(screen.getByText(t("en-US", "aiConsentBullet1"))).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: new RegExp(t("en-US", "aiConsentPolicyLink", "").trim()) })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: t("en-US", "aiConsentAccept") })).not.toBeDisabled();
  });

  it("uses neutral wording when the owner is cleared", () => {
    renderDialog({ policyOrgName: "", policyUrl: "https://acme.example/ai-policy" });
    expect(
      screen.getByText(t("en-US", "aiConsentPolicyCheckbox", t("en-US", "aiPolicyOwnerFallback"))),
    ).toBeInTheDocument();
  });

  it("never renders an unsafe link as an href", () => {
    renderDialog({ policyUrl: "javascript:alert(1)" });
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("lets a deployment environment value override Settings", () => {
    vi.stubEnv("NEXT_PUBLIC_AI_POLICY_ORG", "Globex");
    vi.stubEnv("NEXT_PUBLIC_AI_POLICY_URL", "https://globex.example/policy");
    try {
      renderDialog({ policyOrgName: "Acme GmbH", policyUrl: "https://acme.example/ai-policy" });
      expect(screen.getByRole("link", { name: /Globex/ })).toHaveAttribute("href", "https://globex.example/policy");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("Cancel and Escape both cancel without accepting", () => {
    const onAccept = vi.fn();
    const onCancel = vi.fn();
    renderDialog({}, { onAccept, onCancel });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("names its close button with the dialog title", () => {
    renderDialog({});
    expect(
      screen.getByRole("button", { name: `${t("en-US", "alertModalClose")} – ${t("en-US", "aiConsentTitle")}` }),
    ).toBeInTheDocument();
  });
});
