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
    // ★★ TWO assertions, proving two DIFFERENT things — neither one alone is enough.
    //
    // `cursor-pointer` proves the CONVERSION: it comes from IconButton's BASE_CLASS
    // and the hand-rolled original did not have it (`git show
    // f6e85d55:src/app/dashboard-tip-card.tsx` — the dismiss was
    // `rounded-md border border-line bg-surface px-2 py-0.5 text-xs
    // text-muted-foreground hover:bg-surface-muted ${INTERACTIVE}`, and INTERACTIVE
    // is transition/focus-ring/press only). Unlike `p-1` it is size- and
    // variant-independent, so it does not re-break if this ever moves to `md`.
    //
    // `border-line` proves the VARIANT: it appears in no other variant
    // (`dangerBordered` uses `border-ui-pink/50`; `ghost`/`danger` have no border at
    // all), so the bare-glyph `ghost` default fails here. It does NOT prove the
    // conversion — the pre-change button carried `border-line` too, so on its own it
    // passes identically before and after. NOT `bg-surface` either: that is a prefix
    // of ghost's own `hover:bg-surface-muted` and would pass under any variant.
    //
    // ★ `(^|\s)…(\s|$)`, never `\b` — `-` is a non-word character, so `\bborder-line\b`
    // also matches inside a hypothetical `border-line-strong`.
    const dismissClass = screen.getByRole("button", {
      name: t("en-US", "dashboardTipDismiss"),
    }).className;
    expect(dismissClass).toMatch(/(^|\s)cursor-pointer(\s|$)/);
    expect(dismissClass).toMatch(/(^|\s)border-line(\s|$)/);
  });

  it("hides the tip when the global Show-tips setting is off", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showViewHints: false }));
    render(<DashboardTipCard lang="en-US" dc={dc} />);
    await waitFor(() =>
      expect(screen.queryByText(t("en-US", "dashboardTipLabel"))).toBeNull(),
    );
  });
});
