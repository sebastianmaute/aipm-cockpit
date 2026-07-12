"use client";

import { useState, type ChangeEvent } from "react";
import { type Lang, t } from "../i18n";
import { SegmentedControl } from "../segmented-control";
import type { DashboardDensity } from "../dashboard-density";
import { type BrandingConfig, type Settings } from "../settings-types";
import type { Theme } from "../theme";
import { useTheme } from "../use-theme";
import { InfoTooltip } from "../info-tooltip";
import { useColorSchemes } from "../use-color-schemes";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "../interaction-styles";
import { ColorSchemeEditor } from "../color-scheme-editor";
import { applySchemeColors, writeActiveSchemeColors } from "../scheme-apply";
import { mergeAppliedBranding } from "../color-schemes";

const BRANDING_LOGO_MAX_BYTES = 512 * 1024;
const BRANDING_LOGO_FILE_RE = /^data:image\/(png|jpeg|webp|gif);base64,/i;

interface AppearanceSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function AppearanceSection({ lang, settings, onChange }: AppearanceSectionProps) {
  const { theme, setTheme } = useTheme();
  const { store, activeSupportsDark, refresh, selectScheme } = useColorSchemes();
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

  const branding = settings.branding;
  const [logoError, setLogoError] = useState<string | null>(null);
  const [faviconError, setFaviconError] = useState<string | null>(null);
  function setBranding(next: BrandingConfig) {
    const cleaned =
      next.logo || next.slogan?.trim() || next.footerSlogan?.trim() || next.favicon ? next : undefined;
    onChange({ ...settings, branding: cleaned });
  }
  function onFaviconFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > BRANDING_LOGO_MAX_BYTES) {
      setFaviconError(t(lang, "brandingLogoError"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (BRANDING_LOGO_FILE_RE.test(url)) {
        setFaviconError(null);
        setBranding({ ...branding, favicon: url });
      } else {
        setFaviconError(t(lang, "brandingLogoError"));
      }
    };
    reader.readAsDataURL(file);
  }
  function onLogoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after a remove
    if (!file) return;
    if (file.size > BRANDING_LOGO_MAX_BYTES) {
      setLogoError(t(lang, "brandingLogoError"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (BRANDING_LOGO_FILE_RE.test(url)) {
        setLogoError(null);
        setBranding({ ...branding, logo: url });
      } else {
        setLogoError(t(lang, "brandingLogoError"));
      }
    };
    reader.readAsDataURL(file);
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
          onApply={(resolved) => { writeActiveSchemeColors(resolved); applySchemeColors(resolved); }}
          onApplyBranding={(b) => setBranding(mergeAppliedBranding(branding, b))}
          onSchemeChange={() => { refresh(); window.dispatchEvent(new Event("lop-scheme-change")); }}
          onClear={() => { writeActiveSchemeColors(null); applySchemeColors(null); }}
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
          <div className="flex flex-wrap items-center gap-2">
            {branding?.logo && (
              <span className="inline-flex items-center rounded border border-line bg-AIPM-dark-blue px-2 py-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={branding.logo} alt="" className="max-h-6 w-auto max-w-[160px] object-contain" />
              </span>
            )}
            <label className={`cursor-pointer rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}>
              {t(lang, "brandingLogoChoose")}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                onChange={onLogoFile}
              />
            </label>
            {branding?.logo && (
              <button
                type="button"
                onClick={() => { setLogoError(null); setBranding({ ...branding, logo: undefined }); }}
                className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground ${INTERACTIVE}`}
              >
                {t(lang, "brandingLogoRemove")}
              </button>
            )}
          </div>
          {logoError && <p className="mt-1 text-xs text-AIPM-pink-strong">{logoError}</p>}
        </div>

        {/* Favicon (browser tab icon) */}
        <div className="mb-3">
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
            {t(lang, "brandingFavicon")}
            <InfoTooltip text={t(lang, "brandingFaviconHint")} />
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {branding?.favicon && (
              <span className="inline-flex items-center rounded border border-line bg-surface px-2 py-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={branding.favicon} alt="" className="h-5 w-5 object-contain" />
              </span>
            )}
            <label className={`cursor-pointer rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}>
              {t(lang, "brandingFaviconChoose")}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                onChange={onFaviconFile}
              />
            </label>
            {branding?.favicon && (
              <button
                type="button"
                onClick={() => { setFaviconError(null); setBranding({ ...branding, favicon: undefined }); }}
                className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground ${INTERACTIVE}`}
              >
                {t(lang, "brandingLogoRemove")}
              </button>
            )}
          </div>
          {faviconError && <p className="mt-1 text-xs text-AIPM-pink-strong">{faviconError}</p>}
        </div>

        {/* App name + footer slogan are OWNED by the active scheme (the scheme
            editor edits them; apply replaces via mergeAppliedBranding), so they
            are not edited here — Phase 2 is always scheme-driven. */}
      </div>
    </>
  );
}
