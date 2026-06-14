// src/app/settings-sections/ai-usage-panel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { AiUsagePanel } from "./ai-usage-panel";
import { AiUsageProvider } from "../ai-usage-context";
import { defaultAiConfig } from "../settings-types";
import { t } from "../i18n";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "../settings-types";

// AiUsagePanel reads from AiUsageContext via useAiUsageContext().
// Wrap with the real AiUsageProvider seeded with zero usage (clean localStorage).
function wrapper({ children }: { children: ReactNode }) {
  return (
    <AiUsageProvider lang="en-US" ai={defaultAiConfig} showToast={vi.fn()}>
      {children}
    </AiUsageProvider>
  );
}

describe("AiUsagePanel", () => {
  it("renders session and weekly usage bar labels", () => {
    render(
      <AiUsagePanel
        lang="en-US"
        sessionCap={DEFAULT_SESSION_TOKEN_CAP}
        weeklyCap={DEFAULT_WEEKLY_TOKEN_CAP}
      />,
      { wrapper },
    );
    expect(screen.getByText(t("en-US", "aiUsageSession"))).toBeTruthy();
    expect(screen.getByText(t("en-US", "aiUsageWeek"))).toBeTruthy();
  });

  it("progressbar aria-valuemax reflects sessionCap prop", () => {
    render(
      <AiUsagePanel
        lang="en-US"
        sessionCap={10_000}
        weeklyCap={DEFAULT_WEEKLY_TOKEN_CAP}
      />,
      { wrapper },
    );
    // The aria-valuemax attribute is always a raw integer — locale-independent.
    const bars = screen.getAllByRole("progressbar");
    const maxValues = bars.map((b) => Number(b.getAttribute("aria-valuemax")));
    expect(maxValues).toContain(10_000);
  });

  it("renders two progressbar roles — one per usage scope", () => {
    render(
      <AiUsagePanel
        lang="en-US"
        sessionCap={DEFAULT_SESSION_TOKEN_CAP}
        weeklyCap={DEFAULT_WEEKLY_TOKEN_CAP}
      />,
      { wrapper },
    );
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
  });

  it("progressbar aria-valuemax reflects the passed cap props", () => {
    render(
      <AiUsagePanel
        lang="en-US"
        sessionCap={5_000}
        weeklyCap={50_000}
      />,
      { wrapper },
    );
    const bars = screen.getAllByRole("progressbar");
    const maxValues = bars.map((b) => Number(b.getAttribute("aria-valuemax")));
    expect(maxValues).toContain(5_000);
    expect(maxValues).toContain(50_000);
  });
});
