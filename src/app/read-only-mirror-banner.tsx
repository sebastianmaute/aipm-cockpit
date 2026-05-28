import { type Lang, t } from "./i18n";

interface ReadOnlyMirrorBannerProps {
  lang: Lang;
}

export function ReadOnlyMirrorBanner({ lang }: ReadOnlyMirrorBannerProps) {
  return (
    <div
      role="status"
      className="mb-3 rounded-md border border-AIPM-purple/40 bg-AIPM-purple/10 px-3 py-2 text-sm text-AIPM-purple"
    >
      {t(lang, "popoutReadOnlyBanner")}
    </div>
  );
}
