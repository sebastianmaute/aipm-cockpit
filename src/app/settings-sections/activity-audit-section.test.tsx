import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../confirm-dialog";
import { t } from "../i18n";
import type { ActivityAuditDownloader } from "../activity-audit-download";
import { ActivityAuditSection } from "./activity-audit-section";

// open-followups §510 — the internal activity-log download in Settings.

function renderSection(audit: ActivityAuditDownloader) {
  render(
    <ConfirmProvider lang="en-US">
      <ActivityAuditSection lang="en-US" audit={audit} />
    </ConfirmProvider>,
  );
}

const trigger = () => screen.getByRole("button", { name: t("en-US", "activityAuditDownload") });
const confirmAction = () => screen.findByRole("button", { name: t("en-US", "activityAuditConfirmAction") });

describe("ActivityAuditSection", () => {
  it("says the file is internal, not access control, and what it covers — before any click", () => {
    renderSection({ scope: "portfolio", download: vi.fn() });
    expect(screen.getByRole("heading", { name: t("en-US", "activityAuditTitle") })).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "activityAuditIntro"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "activityAuditScopePortfolio"))).toBeInTheDocument();
  });

  it("names the current-project scope when there is no portfolio", () => {
    renderSection({ scope: "current", download: vi.fn() });
    expect(screen.getByText(t("en-US", "activityAuditScopeCurrent"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "activityAuditScopePortfolio"))).toBeNull();
  });

  it("downloads only after the confirm, and reports it", async () => {
    const download = vi.fn(async () => true);
    renderSection({ scope: "current", download });
    fireEvent.click(trigger());
    expect(download).not.toHaveBeenCalled();
    fireEvent.click(await confirmAction());
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(t("en-US", "activityAuditDone"))).toBeInTheDocument();
  });

  it("downloads nothing when the confirm is cancelled", async () => {
    const download = vi.fn(async () => true);
    renderSection({ scope: "current", download });
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByRole("button", { name: t("en-US", "cancel") }));
    await waitFor(() => expect(screen.queryByRole("button", { name: t("en-US", "activityAuditConfirmAction") })).toBeNull());
    expect(download).not.toHaveBeenCalled();
  });

  it.each([
    ["the browser refuses the download", vi.fn(async () => false)],
    ["the portfolio read fails", vi.fn(async () => { throw new Error("turso down"); })],
  ])("reports a failure when %s", async (_label, download) => {
    renderSection({ scope: "portfolio", download });
    fireEvent.click(trigger());
    fireEvent.click(await confirmAction());
    expect(await screen.findByText(t("en-US", "activityAuditFailed"))).toBeInTheDocument();
    expect(trigger()).not.toBeDisabled();
  });
});
