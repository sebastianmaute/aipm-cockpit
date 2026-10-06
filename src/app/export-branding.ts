// What an exported Word file's branded header and footer show (§512 b): the
// project name, the sidebar logo, and the translated "Page X of Y" label.
//
// ★ The logo is read from the persisted settings at export time, not threaded
// in as a prop. Branding is per-device and lives in localStorage, and
// `useSettings` is per-instance with no same-page sync, so a component-level
// copy can be a stale one; the persisted value is the current one by the
// time a user clicks Export, since the settings effect writes on every change.
import { t, type Lang } from "./i18n";
import type { DocxBranding } from "./ooxml-docx-header-footer";
import { SETTINGS_KEY } from "./use-settings";
import type { Workspace } from "./workspace";

/** The sidebar logo's data URL, or undefined when none is set or storage cannot be read. */
export function readExportBrandLogo(): string | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return undefined;
    const logo = (JSON.parse(raw) as { branding?: { logo?: unknown } })?.branding?.logo;
    return typeof logo === "string" && logo.startsWith("data:image/") ? logo : undefined;
  } catch {
    return undefined;
  }
}

export function docxBrandingFor(ws: Workspace, lang: Lang, logo: string | undefined = readExportBrandLogo()): DocxBranding {
  return { projectName: ws.project?.name ?? "", logo, pageLabel: t(lang, "exportDocxPageOf") };
}
