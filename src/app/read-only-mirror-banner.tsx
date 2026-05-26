import { type Lang, t } from "./i18n";

interface ReadOnlyMirrorBannerProps {
  lang: Lang;
}

export function ReadOnlyMirrorBanner({ lang }: ReadOnlyMirrorBannerProps) {
  return (
    <div
      role="status"
      className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
    >
      {t(lang, "popoutReadOnlyBanner")}
    </div>
  );
}
