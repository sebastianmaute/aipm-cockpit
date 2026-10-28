import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiConsentDialog } from "./ai-consent-dialog";
import { resolveAiPolicy } from "./ai-policy";
import { t } from "./i18n";
import { AI_DESTINATION_KEYS, aiDataPathsFor } from "./ai-disclosure";
import { setAiDeploymentState } from "./ai-deployment";
import { DIRECT_AI_STATUS } from "../test/ai-status-fetch";

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
    expect(screen.getByText(t("en-US", "aiDataChatLabel"))).toBeInTheDocument();
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
    expect(screen.getByText(t("en-US", "aiDataChatLabel"))).toBeInTheDocument();
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

  it.each(["interactive", "background"] as const)("the %s dialog lists exactly its own rows of AI_DATA_PATHS, label and data", (level) => {
    render(
      <AiConsentDialog lang="en-US" level={level} policy={resolveAiPolicy({})} onAccept={vi.fn()} onCancel={vi.fn()} />,
    );
    const own = aiDataPathsFor(level);
    const other = aiDataPathsFor(level === "interactive" ? "background" : "interactive");
    expect(own.length).toBeGreaterThan(0);
    for (const row of own) {
      expect(screen.getByText(t("en-US", row.labelKey))).toBeInTheDocument();
      expect(screen.getAllByText(t("en-US", row.dataKey)).length).toBeGreaterThan(0);
    }
    for (const row of other) expect(screen.queryByText(t("en-US", row.labelKey))).toBeNull();
    const rendered = [...document.querySelectorAll("[data-ai-data-path]")].map((el) => el.getAttribute("data-ai-data-path"));
    expect(rendered).toEqual(own.map((row) => row.id));
  });

  it("the background dialog leads into its data rows separately from its runner list", () => {
    render(
      <AiConsentDialog lang="en-US" level="background" policy={resolveAiPolicy({})} onAccept={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(t("en-US", "aiConsentBackgroundIntro"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "aiConsentBackgroundDataIntro"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "aiConsentDataIntro"))).toBeNull();
    // The key bullet is kept at both levels.
    expect(screen.getByText(t("en-US", "aiConsentBullet2"))).toBeInTheDocument();
  });

  it("the interactive dialog opens with the consent line and its own lead-in", () => {
    renderDialog({});
    expect(screen.getByText(t("en-US", "aiConsentNotAccepted"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "aiConsentDataIntro"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "aiConsentBackgroundDataIntro"))).toBeNull();
  });

  it("names its close button with the dialog title", () => {
    renderDialog({});
    expect(
      screen.getByRole("button", { name: `${t("en-US", "alertModalClose")} – ${t("en-US", "aiConsentTitle")}` }),
    ).toBeInTheDocument();
  });
});

describe("AiConsentDialog — where the data goes follows the deployment's AI route", () => {
  afterEach(() => setAiDeploymentState(DIRECT_AI_STATUS));
  const renderLevel = (level: "interactive" | "background") =>
    render(<AiConsentDialog lang="en-US" level={level} policy={resolveAiPolicy({})} onAccept={vi.fn()} onCancel={vi.fn()} />);

  it.each(["interactive", "background"] as const)("direct: the %s dialog says directly from this browser (control)", (level) => {
    renderLevel(level);
    expect(screen.getByText(t("en-US", AI_DESTINATION_KEYS.direct[level]))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "aiConsentBullet2"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "aiConsentBullet3"))).toBeInTheDocument();
    expect(document.body.textContent).toContain("directly from this browser");
  });

  it.each(["interactive", "background"] as const)("gateway: the %s dialog names the gateway route and no direct call", (level) => {
    setAiDeploymentState({ off: false, route: "gateway", invalid: false });
    renderLevel(level);
    expect(screen.getByText(t("en-US", AI_DESTINATION_KEYS.gateway[level]))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", AI_DESTINATION_KEYS.gateway.keySecurity))).toBeInTheDocument();
    // The gateway and its provider are named as recipients, in place of the direct bullet.
    expect(screen.getByText(t("en-US", "aiConsentBullet3Gateway"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "aiConsentBullet3"))).toBeNull();
    expect(screen.queryByText(t("en-US", AI_DESTINATION_KEYS.direct[level]))).toBeNull();
    expect(document.body.textContent).not.toContain("directly from this browser");
    expect(document.body.textContent).not.toContain("api.anthropic.com");
  });
});
