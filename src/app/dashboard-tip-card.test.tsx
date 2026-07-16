import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DashboardTipCard } from "./dashboard-tip-card";
import { densityClasses } from "./dashboard-density";
import { t } from "./i18n";
import { SETTINGS_KEY } from "./use-settings";

const dc = densityClasses("comfortable");

describe("DashboardTipCard tips-umbrella gating", () => {
  beforeEach(() => localStorage.clear());

  it("shows a tip by default (Show tips on)", () => {
    render(<DashboardTipCard lang="en-US" dc={dc} />);
    expect(screen.getByText(t("en-US", "dashboardTipLabel"))).toBeInTheDocument();
  });

  it("hides the tip when the global Show-tips setting is off", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showViewHints: false }));
    render(<DashboardTipCard lang="en-US" dc={dc} />);
    await waitFor(() =>
      expect(screen.queryByText(t("en-US", "dashboardTipLabel"))).toBeNull(),
    );
  });
});
