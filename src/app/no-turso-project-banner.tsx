import { type Lang, t } from "./i18n";

interface NoTursoProjectBannerProps {
  lang: Lang;
}

/** §753 — the Turso portfolio has no project chosen, so every save is skipped (§751); say so while it lasts. */
export function NoTursoProjectBanner({ lang }: NoTursoProjectBannerProps) {
  return (
    <div
      role="alert"
      className="mb-3 rounded-md border border-ui-purple/40 bg-ui-purple/10 px-3 py-2 text-sm text-ui-purple-strong"
    >
      {t(lang, "noTursoProjectBanner")}
    </div>
  );
}
