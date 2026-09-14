"use client";

// Shared version/highlights body rendered by both the VersionMenu popover (in
// the action menus) and the VersionInfoModal (opened from the sidebar version
// line and the Settings footer). Single source of truth for the "about" panel.

import { XMarkIcon } from "./icons";
import { IconButton } from "./icon-button";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import {
  APP_AUTHOR_URL,
  APP_BUILD_DATE,
  APP_HIGHLIGHT_KEYS,
  APP_LICENSE_URL,
  APP_REPO_URL,
  APP_VERSION_LABEL,
} from "./version";

/** Centered modal wrapping VersionInfo, opened from the sidebar version line
 *  and the Settings footer. Controlled: parent owns the open boolean. Delegates
 *  focus trap / restore, Escape, and backdrop dismissal to the shared Modal. */
export function VersionInfoModal({
  lang,
  open,
  onClose,
}: {
  lang: Lang;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} ariaLabel={t(lang, "version")} align="center" zIndex={50}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          {/* ★ NO help icon: this dialog is already information — it exists to
              state what version you are on, and there is nothing behind it left
              to explain. §424's rule — a dialog declaring nothing is the
              designed answer for progress, confirmations and gates. */}
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(lang, "version")}
          </h3>
          <IconButton onClick={onClose} label={t(lang, "alertModalClose")} title={t(lang, "alertModalClose")}>
            <XMarkIcon aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
        <VersionInfo lang={lang} />
      </div>
    </Modal>
  );
}

export function VersionInfo({ lang }: { lang: Lang }) {
  return (
    <>
      <p className="text-base font-semibold text-ui-dark-blue dark:text-ui-light-grey">
        {t(lang, "appTitle")}
      </p>
      <dl className="mt-2 space-y-1 text-sm">
        <Row term={t(lang, "versionVersion")} value={APP_VERSION_LABEL} />
        <Row term={t(lang, "versionBuild")} value={APP_BUILD_DATE} />
      </dl>

      <p className="mt-3 text-sm text-foreground">{t(lang, "versionPitch")}</p>

      {/* The pitch, not a changelog: a short fixed list of what is unique to the
          app. Release history lives in CHANGELOG.md. */}
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t(lang, "versionHighlightsHeader")}
      </p>
      <ul className="mt-1.5 space-y-1 text-xs text-foreground">
        {APP_HIGHLIGHT_KEYS.map((k) => (
          <li key={k} className="flex gap-2">
            <span aria-hidden className="mt-0.5 text-ui-green-strong">
              •
            </span>
            <span>{t(lang, k)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-muted-foreground">
        <p>
          {t(lang, "versionLicenseLabel")}:{" "}
          <ExternalLink href={APP_LICENSE_URL}>{t(lang, "versionLicenseName")}</ExternalLink>
        </p>
        <p>
          {t(lang, "versionAuthor")} · {t(lang, "versionBuiltWith")}
        </p>
        <p className="flex flex-wrap gap-x-3">
          <ExternalLink href={APP_REPO_URL}>{t(lang, "versionGithubLink")}</ExternalLink>
          <ExternalLink href={APP_AUTHOR_URL}>{t(lang, "versionLinkedInLink")}</ExternalLink>
        </p>
      </div>
    </>
  );
}

/** A link that opens in a new tab. The ↗ is decorative, so the accessible name
 *  is exactly the visible label. */
function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-ui-dark-blue underline-offset-2 hover:underline dark:text-ui-blue"
    >
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {term}
      </dt>
      <dd className="font-mono text-foreground dark:text-ui-light-grey">
        {value}
      </dd>
    </div>
  );
}
