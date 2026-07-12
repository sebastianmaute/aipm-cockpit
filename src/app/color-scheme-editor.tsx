"use client";

import { useState, type ChangeEvent } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { CORE_TOKENS, ADVANCED_TOKENS, ICC_SEED, MOCKUP_SEED, resolveSchemeColors } from "./scheme-tokens";
import { checkSchemePairs } from "./scheme-contrast";
import { readActiveSchemeColors, type SchemeColorMap } from "./scheme-apply";
import {
  loadSchemes, addScheme, updateScheme, removeScheme,
  exportScheme, importScheme, type SchemeStore,
} from "./color-schemes";
import { reconcileBuiltins } from "./builtin-schemes";
import type { BrandingConfig } from "./settings-types";

interface ColorSchemeEditorProps {
  lang: Lang;
  /** Live-preview the edited colors (transient; persisted schemes go through the
   *  store + onSchemeChange). */
  onApply: (resolved: SchemeColorMap) => void;
  onApplyBranding?: (b: BrandingConfig) => void;
  /** Called after a store mutation (save/rename/delete/import) so the parent can
   *  refresh its scheme list + re-run the theme-correct apply. */
  onSchemeChange?: () => void;
  /** Drop the applied colors entirely (e.g. when the active scheme is deleted). */
  onClear?: () => void;
}

// The editor authors LIGHT-ONLY user schemes this phase; it edits the active
// scheme's `light` map. Built-in schemes are read-only here (Save as new to
// customise). The parent (Appearance) owns SELECTION; this component is keyed on
// the active id so it re-seeds when the selection changes.
export function ColorSchemeEditor({ lang, onApply, onApplyBranding, onSchemeChange, onClear }: ColorSchemeEditorProps) {
  const [store, setStore] = useState<SchemeStore>(() => reconcileBuiltins(loadSchemes()));
  const active = store.schemes.find((s) => s.id === store.activeId) ?? null;
  const isBuiltin = !!active?.builtIn;
  const [name, setName] = useState(active?.name ?? "");
  // Seed the draft from the active scheme's light map; if none, from the
  // last-applied boot key (so an applied-but-unsaved scheme survives reload).
  const [colors, setColors] = useState<SchemeColorMap>(() => ({
    ...ICC_SEED,
    ...(active ? active.light : readActiveSchemeColors() ?? {}),
  }));
  const [branding, setBranding] = useState<BrandingConfig>(active?.branding ?? {});
  const [importError, setImportError] = useState<string | null>(null);
  const pairs = checkSchemePairs(colors);

  function applyResolved(full: SchemeColorMap, b: BrandingConfig) {
    onApply(resolveSchemeColors(full));
    onApplyBranding?.(b);
  }
  function seed(map: SchemeColorMap) {
    setColors({ ...ICC_SEED, ...map });
  }
  function apply() {
    applyResolved(colors, branding);
    // Persist applied edits to the active USER scheme (built-ins are read-only).
    if (active && !isBuiltin) {
      setStore(updateScheme(active.id, { light: colors, branding }));
      onSchemeChange?.();
    }
  }
  function saveNew() {
    const next = addScheme(name || t(lang, "schemeNamePlaceholder"), colors, branding);
    setStore(next);
    setName(next.schemes[next.schemes.length - 1].name);
    applyResolved(colors, branding); // saving applies the new scheme
    onSchemeChange?.();
  }
  function rename() {
    if (!active || isBuiltin) return;
    setStore(updateScheme(active.id, { name, light: colors, branding }));
    applyResolved(colors, branding);
    onSchemeChange?.();
  }
  function del() {
    if (!active || isBuiltin) return;
    const next = removeScheme(active.id);
    setStore(next);
    setName("");
    setColors({ ...ICC_SEED });
    setBranding({});
    onClear?.();
    onSchemeChange?.();
  }
  function doExport() {
    if (!active) return;
    const blob = new Blob([exportScheme(active)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.name || "scheme"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = importScheme(String(reader.result));
      if (!parsed) { setImportError(t(lang, "schemeImportError")); return; }
      setImportError(null);
      const next = addScheme(parsed.name, parsed.light, parsed.branding);
      setStore(next);
      const s = next.schemes[next.schemes.length - 1];
      const full = { ...ICC_SEED, ...s.light };
      setName(s.name); setColors(full); setBranding(s.branding);
      applyResolved(full, s.branding); // importing applies the imported scheme
      onSchemeChange?.();
    };
    reader.readAsText(file);
  }

  function picker(token: string, labelKey: TranslationKey) {
    const label = t(lang, labelKey);
    return (
      <label key={token} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <input
          type="color"
          aria-label={label}
          value={colors[token] ?? "#000000"}
          onInput={(e) => setColors((p) => ({ ...p, [token]: (e.target as HTMLInputElement).value }))}
          className={`h-7 w-10 cursor-pointer rounded border border-line bg-surface ${FOCUS_RING} ${TRANSITION}`}
        />
      </label>
    );
  }

  const btn = `rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`;

  return (
    <div className="mt-3 rounded-md border border-line bg-surface-muted p-3">
      {isBuiltin && (
        <p className="mb-2 text-xs text-muted-foreground">{t(lang, "schemeBuiltinReadonly")}</p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          aria-label={t(lang, "schemeNamePlaceholder")}
          placeholder={t(lang, "schemeNamePlaceholder")}
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground ${FOCUS_RING} ${TRANSITION}`}
        />
        <button type="button" className={btn} onClick={saveNew}>{t(lang, "schemeNew")}</button>
        <button type="button" className={btn} onClick={rename} disabled={!active || isBuiltin}>{t(lang, "schemeRename")}</button>
        <button type="button" className={btn} onClick={del} disabled={!active || isBuiltin}>{t(lang, "schemeDelete")}</button>
        <button type="button" className={btn} onClick={() => seed(ICC_SEED)}>{t(lang, "schemeNewFromIcc")}</button>
        <button type="button" className={btn} onClick={() => seed(MOCKUP_SEED)}>{t(lang, "schemeNewFromMockup")}</button>
        <button type="button" className={btn} onClick={doExport} disabled={!active}>{t(lang, "schemeExport")}</button>
        <label className={`cursor-pointer ${btn}`}>
          {t(lang, "schemeImport")}
          <input type="file" accept="application/json,.json" className="sr-only" onChange={onImportFile} />
        </label>
      </div>
      {importError && <p className="mb-2 text-xs text-AIPM-pink-strong">{importError}</p>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CORE_TOKENS.map((tk) => picker(tk.token, tk.labelKey as TranslationKey))}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-foreground">{t(lang, "schemeAdvanced")}</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ADVANCED_TOKENS.map((tk) => picker(tk.token, tk.labelKey as TranslationKey))}
        </div>
      </details>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          {t(lang, "brandingAppName")}
          <input
            type="text"
            maxLength={60}
            value={branding.slogan ?? ""}
            onChange={(e) => setBranding((b) => ({ ...b, slogan: e.target.value }))}
            className={`mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          {t(lang, "brandingFooterSlogan")}
          <input
            type="text"
            maxLength={120}
            value={branding.footerSlogan ?? ""}
            onChange={(e) => setBranding((b) => ({ ...b, footerSlogan: e.target.value }))}
            className={`mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`}
          />
        </label>
      </div>

      {pairs.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {pairs.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{t(lang, p.labelKey as TranslationKey)}</span>
              <span className={p.passesAa ? "text-AIPM-green-strong" : "text-AIPM-pink-strong"}>
                {p.ratio}:1 {p.passesAa ? "✓" : `⚠ ${t(lang, "schemeContrastBelowAa")}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={apply}
          className={`rounded-md border border-line bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-AIPM-white ${INTERACTIVE}`}
        >
          {t(lang, "schemeApply")}
        </button>
      </div>
    </div>
  );
}
