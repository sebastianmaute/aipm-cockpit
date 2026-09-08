// src/app/settings-sections/ai-usage-panel.test.tsx
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { AiUsagePanel } from "./ai-usage-panel";
import { AiUsageProvider, useAiUsageContext } from "../ai-usage-context";
import { defaultAiConfig } from "../settings-types";
import { t, loadI18n, type Lang } from "../i18n";
import type { Usage } from "../ai-usage";
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

// Records ONE Usage sample into the provider on mount (a ref guard keeps it
// firing once even under StrictMode's double-invoke) before its children
// render, so the panel below reads an already-populated sessionUsage.
function Seed({ usage, children }: { usage: Usage; children: ReactNode }) {
  const { record } = useAiUsageContext();
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    record(usage);
  }, [record, usage]);
  return <>{children}</>;
}

// tokenMultiplier pinned to 1 so the seeded Usage lands in sessionUsage
// unscaled — the default multiplier (5) would otherwise inflate every field.
function seededWrapper(lang: Lang, usage: Usage) {
  const ai = { ...defaultAiConfig, tokenMultiplier: 1 };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AiUsageProvider lang={lang} ai={ai} showToast={vi.fn()}>
        <Seed usage={usage}>{children}</Seed>
      </AiUsageProvider>
    );
  };
}

const CACHE_USAGE: Usage = { input: 1000, output: 100, cacheWrite: 500, cacheRead: 9000 };

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

  it("shows the session cache breakdown and hit rate", () => {
    render(
      <AiUsagePanel lang="en-US" sessionCap={100_000} weeklyCap={500_000} />,
      { wrapper: seededWrapper("en-US", CACHE_USAGE) },
    );
    // ★ The panel formats every figure via `.toLocaleString(localeFor(lang))`
    //   (explicit locale, not the runtime default) so the grouping separator
    //   is pinned to what "en-US" always produces, regardless of the host
    //   machine's own ICU default locale — verified this repo's dev machine
    //   resolves Intl's UNQUALIFIED default to "de-DE" ("9.000", dot
    //   grouping), which would silently break a bare `.toLocaleString()`.
    expect(screen.getByText(/9,000/)).toBeInTheDocument();
    // 9000 / (9000 + 1000 + 500) = 85.71...% → rounds to 86%.
    expect(screen.getByText(/86%/)).toBeInTheDocument();
    // ★ Pins the FOLLOW-UP fix: UsageBar's own `used`/`cap` figures now take
    //   the same `locale` prop as the breakdown below it, rather than calling
    //   bare `.toLocaleString()` (host-default locale). Session total is
    //   1000+100+500+9000=10600; sessionCap=100000 (11%), weeklyCap=500000 (2%).
    expect(screen.getByText(/10,600 \/ 100,000/)).toBeInTheDocument();
    expect(screen.getByText(/10,600 \/ 500,000/)).toBeInTheDocument();
  });

  describe("in German", () => {
    beforeAll(async () => {
      await loadI18n("de");
    });

    it("renders the German cache-breakdown and hit-rate strings", () => {
      render(
        <AiUsagePanel lang="de" sessionCap={100_000} weeklyCap={500_000} />,
        { wrapper: seededWrapper("de", CACHE_USAGE) },
      );
      expect(screen.getByText(t("de", "aiUsageUncachedInput"))).toBeInTheDocument();
      expect(screen.getByText(t("de", "aiUsageCacheRead"))).toBeInTheDocument();
      expect(screen.getByText(t("de", "aiUsageCacheWrite"))).toBeInTheDocument();
      // German grouping uses "." — 9000 renders as "9.000" under "de-DE".
      expect(screen.getByText(/9\.000/)).toBeInTheDocument();
      expect(screen.getByText(/86 %/)).toBeInTheDocument();
      // ★ Same follow-up pin as the "en-US" test above, in the German
      //   direction: the bar figures must use dot grouping under "de".
      expect(screen.getByText(/10\.600 \/ 100\.000/)).toBeInTheDocument();
      expect(screen.getByText(/10\.600 \/ 500\.000/)).toBeInTheDocument();
    });
  });
});
