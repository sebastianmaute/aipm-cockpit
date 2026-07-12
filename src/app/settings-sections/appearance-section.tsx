"use client";

import { useState } from "react";
import { type Lang, t } from "../i18n";
import { SegmentedControl } from "../segmented-control";
import type { DashboardDensity } from "../dashboard-density";
import { type BrandingConfig, type Settings, DEFAULT_FOOTER_SLOGAN } from "../settings-types";
import type { Theme } from "../theme";
import { useTheme } from "../use-theme";
import { InfoTooltip } from "../info-tooltip";
import { useColorSchemes } from "../use-color-schemes";
import { FOCUS_RING, TRANSITION } from "../interaction-styles";
import { ColorSchemeEditor } from "../color-scheme-editor";
import { BrandingImageInput } from "../branding-image-input";
import { applySchemeColors, writeActiveSchemeColors } from "../scheme-apply";
import { mergeAppliedBranding } from "../color-schemes";
import { getTursoConfig } from "../turso-config";

interface AppearanceSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function AppearanceSection({ lang, settings, onChange }: AppearanceSectionProps) {
  const { theme, setTheme } = useTheme();
  const config = getTursoConfig(
    settings.integrations?.turso?.databaseUrl,
    settings.integrations?.turso?.authToken,
  );
  const { store, activeSupportsDark, refresh, selectScheme } = useColorSchemes({ config });
  // Phase 2: the style axis is the constant "custom" — the ACTIVE SCHEME drives
  // the look. A dark-capable active scheme honours the theme; mockup + a
  // light-only user scheme pin light (mirrors effectiveDark → !supportsDark).
  const pinsLight = !activeSupportsDark;
  const isMockupActive = store.activeId === "mockup";
  // AIPM + Mockup are now built-in schemes rendered under friendly labels below,
  // so exclude them from the generic built-in loop (which would duplicate them).
  const builtinSchemes = store.schemes.filter((s) => s.builtIn && s.id !== "AIPM" && s.id !== "mockup");
  const userSchemes = store.schemes.filter((s) => !s.builtIn);
  const schemeValue = store.activeId ?? "harbor";
  // Gate the global app-name/footer inputs on scheme IDENTITY, matching the editor
  // EXACTLY (which shows its own branding inputs when !isBuiltin). Built-ins are
  // read-only in the editor, so the global inputs cover them; a USER scheme owns
  // its branding via the editor, so the global inputs hide → exactly ONE app-name
  // field in every state. (A content check diverged for a fresh unbranded user
  // scheme → duplicate inputs AND an empty-branding save wiped settings.branding.)
  const activeIsBuiltin = !!store.schemes.find((s) => s.id === store.activeId)?.builtIn;

  const branding = settings.branding;
  const [logoError, setLogoError] = useState<string | null>(null);
  const [faviconError, setFaviconError] = useState<string | null>(null);
  function setBranding(next: BrandingConfig) {
    const cleaned =
      next.logo || next.slogan?.trim() || next.footerSlogan?.trim() || next.favicon ? next : undefined;
    onChange({ ...settings, branding: cleaned });
  }
  return (
    <>
      <div className="mb-4">
        <label htmlFor="appearance-scheme" className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "schemeAppearanceLabel")}
        </label>
        <select
          id="appearance-scheme"
          value={schemeValue}
          onChange={(e) => selectScheme(e.target.value)}
          className={`w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`}
        >
          {builtinSchemes.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
          <option value="AIPM">{t(lang, "styleIcc")}</option>
          <option value="mockup">{t(lang, "styleMockup")}</option>
          {userSchemes.length > 0 && (
            <optgroup label={t(lang, "schemeUserGroup")}>
              {userSchemes.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="mb-4">
        <ColorSchemeEditor
          key={store.activeId ?? "none"}
          lang={lang}
          config={config}
          onApply={(resolved) => { writeActiveSchemeColors(resolved); applySchemeColors(resolved); }}
          onApplyBranding={(b) => setBranding(mergeAppliedBranding(branding, b))}
          onSchemeChange={() => { refresh(); window.dispatchEvent(new Event("lop-scheme-change")); }}
          onClear={() => { writeActiveSchemeColors(null); applySchemeColors(null); }}
        />
        {config ? (
          <p className="mt-2 text-sm text-muted-foreground">{t(lang, "schemeStoredInDb")}</p>
        ) : null}
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
          disabled={pinsLight}
          options={[
            { value: "light", label: t(lang, "themeLight") },
            { value: "dark", label: t(lang, "themeDark") },
            { value: "system", label: t(lang, "themeSystem") },
          ]}
          onChange={setTheme}
        />
        {pinsLight && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t(lang, isMockupActive ? "styleMockupLightOnly" : "styleCustomLightOnly")}
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

      <div className="mb-4">
        <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "showViewHintsLabel")}
          <InfoTooltip text={t(lang, "showViewHintsHint")} />
        </span>
        <SegmentedControl<"shown" | "hidden">
          value={settings.showViewHints !== false ? "shown" : "hidden"}
          ariaLabel={t(lang, "showViewHintsLabel")}
          className="w-full"
          options={[
            { value: "shown", label: t(lang, "viewHintsShown") },
            { value: "hidden", label: t(lang, "viewHintsHidden") },
          ]}
          onChange={(v) => onChange({ ...settings, showViewHints: v === "shown" })}
        />
      </div>

      {/* GLOBAL branding: logo/favicon/app-name/footer edited HERE only while a
          BUILT-IN scheme is active (built-ins ship empty branding, read-only in
          the editor). A USER scheme OWNS all four (its editor edits them; apply
          replaces via mergeAppliedBranding) — the whole block hides then to avoid
          a dual editor. */}
      {activeIsBuiltin && (
        <div className="mb-4">
          <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
            {t(lang, "brandingTitle")}
          </span>

          {/* Logo upload */}
          <div className="mb-3">
            <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              {t(lang, "brandingLogo")}
              <InfoTooltip text={t(lang, "brandingLogoHint")} />
            </span>
            <BrandingImageInput
              label={t(lang, "brandingLogoChoose")}
              removeLabel={`${t(lang, "remove")} – ${t(lang, "brandingLogo")}`}
              value={branding?.logo}
              onChange={(logo) => { setLogoError(null); setBranding({ ...branding, logo }); }}
              onRemove={() => { setLogoError(null); setBranding({ ...branding, logo: undefined }); }}
              error={logoError}
              invalidMessage={t(lang, "brandingLogoError")}
              onError={(m) => setLogoError(m)}
            />
          </div>

          {/* Favicon (browser tab icon) */}
          <div className="mb-3">
            <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              {t(lang, "brandingFavicon")}
              <InfoTooltip text={t(lang, "brandingFaviconHint")} />
            </span>
            <BrandingImageInput
              label={t(lang, "brandingFaviconChoose")}
              removeLabel={`${t(lang, "remove")} – ${t(lang, "brandingFavicon")}`}
              value={branding?.favicon}
              onChange={(favicon) => { setFaviconError(null); setBranding({ ...branding, favicon }); }}
              onRemove={() => { setFaviconError(null); setBranding({ ...branding, favicon: undefined }); }}
              error={faviconError}
              invalidMessage={t(lang, "brandingLogoError")}
              onError={(m) => setFaviconError(m)}
            />
          </div>

          {/* App name (sidebar subtitle under the logo) */}
          <div className="mb-3">
            <label htmlFor="branding-appname" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t(lang, "brandingAppName")}
            </label>
            <input
              id="branding-appname"
              type="text"
              maxLength={60}
              value={branding?.slogan ?? ""}
              placeholder={t(lang, "sidebarBrandSubtitle")}
              onChange={(e) => setBranding({ ...branding, slogan: e.target.value })}
              className={`w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground ${FOCUS_RING} ${TRANSITION}`}
            />
          </div>

          {/* Slogan (bottom footer-bar tagline) */}
          <div>
            <label htmlFor="branding-footer-slogan" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t(lang, "brandingFooterSlogan")}
            </label>
            <input
              id="branding-footer-slogan"
              type="text"
              maxLength={120}
              value={branding?.footerSlogan ?? ""}
              placeholder={DEFAULT_FOOTER_SLOGAN}
              onChange={(e) => setBranding({ ...branding, footerSlogan: e.target.value })}
              className={`w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground ${FOCUS_RING} ${TRANSITION}`}
            />
          </div>
        </div>
      )}
    </>
  );
}
