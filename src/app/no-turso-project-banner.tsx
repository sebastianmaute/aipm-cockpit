import { Banner } from "./banner";
import { type Lang, t } from "./i18n";

interface NoTursoProjectBannerProps {
  lang: Lang;
}

/** §753 — the Turso portfolio has no project chosen, so every save is skipped (§751); say so while it lasts.
 *  The shared `Banner` (warn: the amber tint on border and background, the text in `text-foreground`), as an
 *  alert since an edit made now is lost. */
export function NoTursoProjectBanner({ lang }: NoTursoProjectBannerProps) {
  return (
    <Banner severity="warn" role="alert" className="mb-3">
      {t(lang, "noTursoProjectBanner")}
    </Banner>
  );
}
