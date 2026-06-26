"use client";

import { type Lang, t } from "../i18n";
import { SegmentedControl } from "../segmented-control";
import type { DashboardDensity } from "../dashboard-density";
import type { Settings } from "../settings-types";
import type { Theme } from "../theme";
import { useTheme } from "../use-theme";
import { InfoTooltip } from "../info-tooltip";
import { useCiStyle } from "../use-style";
import type { CiStyle } from "../style-ci";

interface AppearanceSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function AppearanceSection({ lang, settings, onChange }: AppearanceSectionProps) {
  const { theme, setTheme } = useTheme();
  const { style, setStyle } = useCiStyle();
  const isMockup = style === "mockup";
  return (
    <>
      <div className="mb-4">
        <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "styleLabel")}
        </span>
        <SegmentedControl<CiStyle>
          value={style}
          ariaLabel={t(lang, "styleLabel")}
          className="w-full"
          options={[
            { value: "AIPM", label: t(lang, "styleIcc") },
            { value: "mockup", label: t(lang, "styleMockup") },
          ]}
          onChange={setStyle}
        />
      </div>

      <div className="mb-4">
        <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "theme")}
          <InfoTooltip text={t(lang, "themeHint")} />
        </span>
        <SegmentedControl<Theme>
          value={theme}
          ariaLabel={t(lang, "theme")}
          className="w-full"
          disabled={isMockup}
          options={[
            { value: "light", label: t(lang, "themeLight") },
            { value: "dark", label: t(lang, "themeDark") },
            { value: "system", label: t(lang, "themeSystem") },
          ]}
          onChange={setTheme}
        />
        {isMockup && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t(lang, "styleMockupLightOnly")}
          </p>
        )}
      </div>

      <div className="mb-4">
        <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "layout")}
          <InfoTooltip text={t(lang, "layoutTooltip")} />
        </span>
        <SegmentedControl<"modern" | "classic">
          value={settings.layout}
          ariaLabel={t(lang, "layout")}
          className="w-full"
          options={[
            { value: "modern", label: t(lang, "layoutModern") },
            { value: "classic", label: t(lang, "layoutClassic") },
          ]}
          onChange={(v) => onChange({ ...settings, layout: v })}
        />
      </div>

      <div className="mb-4">
        <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "dashboardDensityLabel")}
          <InfoTooltip text={t(lang, "dashboardDensityHint")} />
        </span>
        <SegmentedControl<DashboardDensity>
          value={settings.dashboardDensity ?? "comfortable"}
          ariaLabel={t(lang, "dashboardDensityLabel")}
          className="w-full"
          options={[
            { value: "comfortable", label: t(lang, "dashboardDensityComfortable") },
            { value: "compact", label: t(lang, "dashboardDensityCompact") },
          ]}
          onChange={(v) => onChange({ ...settings, dashboardDensity: v })}
        />
      </div>
    </>
  );
}
