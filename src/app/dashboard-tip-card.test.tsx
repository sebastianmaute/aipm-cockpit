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
    // ★ The dismiss sits beside the text "Next" button and must keep reading as its
    // pair, so it takes IconButton's `bordered` variant. `border-line` appears in no
    // other variant (`dangerBordered` uses `border-ui-pink/50`; `ghost`/`danger` have
    // no border at all), so the bare-glyph default fails here. NOT `bg-surface` — that
    // is a substring of ghost's own `hover:bg-surface-muted` and would pass either way.
    expect(
      screen.getByRole("button", { name: t("en-US", "dashboardTipDismiss") }).className,
    ).toMatch(/\bborder-line\b/);
  });

  it("hides the tip when the global Show-tips setting is off", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showViewHints: false }));
    render(<DashboardTipCard lang="en-US" dc={dc} />);
    await waitFor(() =>
      expect(screen.queryByText(t("en-US", "dashboardTipLabel"))).toBeNull(),
    );
  });
});
