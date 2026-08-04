"use client";

import { useState } from "react";
import { type Lang, t } from "../i18n";
import { SegmentedControl } from "../segmented-control";
import type { DashboardDensity } from "../dashboard-density";
import { type BrandingConfig, type Settings, DEFAULT_FOOTER_SLOGAN } from "../settings-types";
import type { Theme } from "../theme";
import { useTheme } from "../use-theme";
import { InfoTooltip } from "../info-tooltip";
import { FieldHint } from "../field-hint";
import { useColorSchemes } from "../use-color-schemes";
import { Input, Select } from "../form-controls";
import { ColorSchemeEditor } from "../color-scheme-editor";
import { ThemeGallery } from "../theme-gallery";
import { BrandingImageInput } from "../branding-image-input";
import { applySchemeColors, writeActiveSchemeColors } from "../scheme-apply";
import { mergeAppliedBranding, removeScheme } from "../color-schemes";
import { deleteSchemeAsync } from "../color-schemes-store";
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
  // Built-in schemes are Harbor/Meridian/Umber; AIPM + Dashboard ship as importable
  // theme files (Theme gallery below), so they are NOT hardcoded options here.
  const builtinSchemes = store.schemes.filter((s) => s.builtIn);
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
  const [startLogoError, setStartLogoError] = useState<string | null>(null);
  function setBranding(next: BrandingConfig) {
    // Mirrors sanitizeBranding's presence check — every branding field belongs
    // here. Omitting one drops the WHOLE blob when that field is the only thing
    // set, so the upload appears to do nothing and any sibling field goes with it.
    const cleaned =
      next.logo || next.slogan?.trim() || next.footerSlogan?.trim() || next.favicon || next.startLogo
        ? next
        : undefined;
    onChange({ ...settings, branding: cleaned });
  }
  return (
    <>
      <div className="mb-4">
        <label htmlFor="appearance-scheme" className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "schemeAppearanceLabel")}
        </label>
        <Select
          size="xs"
          id="appearance-scheme"
          value={schemeValue}
          onChange={(e) => selectScheme(e.target.value)}
          className="w-full"
        >
          {builtinSchemes.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
          {userSchemes.length > 0 && (
            <optgroup label={t(lang, "schemeUserGroup")}>
              {userSchemes.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
          )}
        </Select>
      </div>

      <div className="mb-4">
        <ColorSchemeEditor
          key={store.activeId ?? "none"}
          lang={lang}
          config={config}
          onApply={(resolved) => { writeActiveSchemeColors(resolved); applySchemeColors(resolved); }}
          onApplyBranding={(b) => setBranding(mergeAppliedBranding(branding, b))}
          onSchemeChange={() => { refresh(); window.dispatchEvent(new Event("aipm-cockpit-scheme-change")); }}
          onClear={() => { writeActiveSchemeColors(null); applySchemeColors(null); }}
        />
        {config ? (
          <p className="mt-2 text-sm text-muted-foreground">{t(lang, "schemeStoredInDb")}</p>
        ) : null}
        <ThemeGallery
          lang={lang}
          config={config}
          schemes={store.schemes}
          onImported={(id) => { refresh(); selectScheme(id); }}
          onRemove={(id) => {
            removeScheme(id);
            void deleteSchemeAsync(config, id);
            refresh();
            window.dispatchEvent(new Event("aipm-cockpit-scheme-change"));
          }}
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
          disabled={pinsLight}
          options={[
            { value: "light", label: t(lang, "themeLight") },
            { value: "dark", label: t(lang, "themeDark") },
            { value: "system", label: t(lang, "themeSystem") },
          ]}
          onChange={setTheme}
        />
        {pinsLight && (
          <FieldHint className="mt-1">
            {t(lang, "styleCustomLightOnly")}
          </FieldHint>
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

      <div className="mb-4">
        <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "showFieldConfigLabel")}
          <InfoTooltip text={t(lang, "showFieldConfigHint")} />
        </span>
        <SegmentedControl<"shown" | "hidden">
          value={settings.showFieldConfig !== false ? "shown" : "hidden"}
          ariaLabel={t(lang, "showFieldConfigLabel")}
          className="w-full"
          options={[
            { value: "shown", label: t(lang, "viewHintsShown") },
            { value: "hidden", label: t(lang, "viewHintsHidden") },
          ]}
          onChange={(v) => onChange({ ...settings, showFieldConfig: v === "shown" })}
        />
      </div>

      <div className="mb-4">
        <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "showSavedViewsLabel")}
          <InfoTooltip text={t(lang, "showSavedViewsHint")} />
        </span>
        <SegmentedControl<"shown" | "hidden">
          value={settings.showSavedViews !== false ? "shown" : "hidden"}
          ariaLabel={t(lang, "showSavedViewsLabel")}
          className="w-full"
          options={[
            { value: "shown", label: t(lang, "viewHintsShown") },
            { value: "hidden", label: t(lang, "viewHintsHidden") },
          ]}
          onChange={(v) => onChange({ ...settings, showSavedViews: v === "shown" })}
        />
      </div>

      {/* GLOBAL branding. The block itself always renders, but its rows split on
          WHO CAN OWN THE FIELD:
          • logo/favicon/app-name/footer are edited HERE only while a BUILT-IN
            scheme is active (built-ins ship empty branding, read-only in the
            editor). A USER scheme OWNS those four (its editor edits them; apply
            replaces via mergeAppliedBranding), so they hide to avoid a dual
            editor — they stay editable, just in the scheme editor instead.
          • startLogo is ALWAYS editable here, because NO scheme can own it:
            mergeAppliedBranding spreads `current` and overwrites only the other
            four, so a scheme can neither set nor clear it and an editor there
            would be a control that appears to work and does nothing. This is its
            ONLY editor — gating it with the other four made the field
            unreachable for anyone running a user scheme. */}
      <div className="mb-4">
        <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "brandingTitle")}
        </span>

        {activeIsBuiltin && (
          <>
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
          </>
        )}

        {/* Start-window logo (shown before any project exists) — see the block
            comment: scheme-independent, so it is NOT gated. */}
        <div className="mb-3">
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
            {t(lang, "brandingStartLogo")}
            <InfoTooltip text={t(lang, "brandingStartLogoHint")} />
          </span>
          <BrandingImageInput
            label={t(lang, "brandingStartLogoChoose")}
            removeLabel={`${t(lang, "remove")} – ${t(lang, "brandingStartLogo")}`}
            value={branding?.startLogo}
            onChange={(startLogo) => { setStartLogoError(null); setBranding({ ...branding, startLogo }); }}
            onRemove={() => { setStartLogoError(null); setBranding({ ...branding, startLogo: undefined }); }}
            error={startLogoError}
            invalidMessage={t(lang, "brandingLogoError")}
            onError={(m) => setStartLogoError(m)}
          />
        </div>

        {activeIsBuiltin && (
          <>
            {/* App name (sidebar subtitle under the logo) */}
            <div className="mb-3">
              <label htmlFor="branding-appname" className="mb-1 block text-xs font-medium text-muted-foreground">
                {t(lang, "brandingAppName")}
              </label>
              <Input
                size="xs"
                id="branding-appname"
                type="text"
                maxLength={60}
                value={branding?.slogan ?? ""}
                placeholder={t(lang, "sidebarBrandSubtitle")}
                onChange={(e) => setBranding({ ...branding, slogan: e.target.value })}
                className="w-full"
              />
            </div>

            {/* Slogan (bottom footer-bar tagline) */}
            <div>
              <label htmlFor="branding-footer-slogan" className="mb-1 block text-xs font-medium text-muted-foreground">
                {t(lang, "brandingFooterSlogan")}
              </label>
              <Input
                size="xs"
                id="branding-footer-slogan"
                type="text"
                maxLength={120}
                value={branding?.footerSlogan ?? ""}
                placeholder={DEFAULT_FOOTER_SLOGAN}
                onChange={(e) => setBranding({ ...branding, footerSlogan: e.target.value })}
                className="w-full"
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}
