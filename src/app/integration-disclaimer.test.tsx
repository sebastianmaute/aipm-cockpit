import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntegrationDisclaimerProvider, useIntegrationDisclaimer } from "./integration-disclaimer";
import { t } from "./i18n";

function Trigger() {
  const { notifyEnable } = useIntegrationDisclaimer();
  return (
    <button type="button" onClick={() => notifyEnable()}>
      enable
    </button>
  );
}

const title = t("en-US", "disclaimerTitle");

describe("IntegrationDisclaimerProvider", () => {
  it("shows the disclaimer the first time a checkbox enables (seen=false)", () => {
    render(
      <IntegrationDisclaimerProvider lang="en-US" seen={false} onAcknowledge={vi.fn()}>
        <Trigger />
      </IntegrationDisclaimerProvider>,
    );
    expect(screen.queryByText(title)).toBeNull();
    fireEvent.click(screen.getByText("enable"));
    expect(screen.getByText(title)).toBeInTheDocument();
  });

  it("acknowledging persists and closes", () => {
    const onAcknowledge = vi.fn();
    render(
      <IntegrationDisclaimerProvider lang="en-US" seen={false} onAcknowledge={onAcknowledge}>
        <Trigger />
      </IntegrationDisclaimerProvider>,
    );
    fireEvent.click(screen.getByText("enable"));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "disclaimerAck") }));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(title)).toBeNull();
  });

  it("never shows again once acknowledged (seen=true)", () => {
    render(
      <IntegrationDisclaimerProvider lang="en-US" seen={true} onAcknowledge={vi.fn()}>
        <Trigger />
      </IntegrationDisclaimerProvider>,
    );
    fireEvent.click(screen.getByText("enable"));
    expect(screen.queryByText(title)).toBeNull();
  });

  it("does not prompt in pop-outs", () => {
    render(
      <IntegrationDisclaimerProvider lang="en-US" seen={false} isPopout onAcknowledge={vi.fn()}>
        <Trigger />
      </IntegrationDisclaimerProvider>,
    );
    fireEvent.click(screen.getByText("enable"));
    expect(screen.queryByText(title)).toBeNull();
  });
});
