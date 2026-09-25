"use client";

// Shared version/highlights body rendered by both the VersionMenu popover (in
// the action menus) and the VersionInfoModal (opened from the sidebar version
// line, the Settings footer, and — desktop only — the Help → Version menu
// item via use-desktop-version-request.ts). Single source of truth for the
// "about" panel.

import { XMarkIcon } from "./icons";
import { IconButton } from "./icon-button";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { isDesktopShellUserAgent } from "./desktop-shell";
import {
  APP_AUTHOR_URL,
  APP_BUILD_DATE,
  APP_HIGHLIGHT_KEYS,
  APP_LICENSE_URL,
  APP_RELEASES_URL,
  APP_REPO_URL,
  APP_SPONSOR_URL,
  APP_VERSION_LABEL,
} from "./version";

/** Centered modal wrapping VersionInfo, opened from the sidebar version line,
 *  the Settings footer, and (desktop only) the Help → Version menu item via
 *  `useDesktopVersionRequest`. Controlled: parent owns the open boolean.
 *  Delegates focus trap / restore, Escape, and backdrop dismissal to the
 *  shared Modal. */
export function VersionInfoModal({
  lang,
  open,
  onClose,
  logPath,
}: {
  lang: Lang;
  open: boolean;
  onClose: () => void;
  /** The desktop app's launch-log path, forwarded from the main process
   *  through `useDesktopVersionRequest`. Absent for every other caller
   *  (sidebar / Settings footer), and for the desktop caller until the
   *  first request has actually landed. */
  logPath?: string;
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
        <VersionInfo lang={lang} logPath={logPath} />
      </div>
    </Modal>
  );
}

export function VersionInfo({ lang, logPath }: { lang: Lang; logPath?: string }) {
  // ★ FIX ROUND 1 (M5): CORRECTED. This used to say VersionInfo "only ever
  // mounts once its enclosing Modal's open becomes true" — true of
  // VersionInfoModal, but not the only parent: VersionMenu (version-menu.tsx,
  // the classic header's info-icon popover) renders THIS component directly
  // inside a PopoverPanel, whose own `open` state also starts `false`. The
  // CONCLUSION still holds for both: PopoverPanel returns `null` while closed
  // (popover-panel.tsx's early `if (!open || ...) return null`), the same
  // shape as Modal's `if (!open) return null` — so VersionInfo never renders
  // during SSR either way, and a plain render-time `navigator` read (not the
  // useSyncExternalStore dance PrintButton in task-manager-ui.tsx needs) is
  // safe under BOTH parents. `typeof navigator` guards the same test file
  // rendering VersionInfo directly, with no parent at all.
  const isDesktop =
    typeof navigator !== "undefined" && isDesktopShellUserAgent(navigator.userAgent);
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
          <ExternalLink href={APP_SPONSOR_URL}>{t(lang, "versionSponsorLink")}</ExternalLink>
        </p>
      </div>

      {/* Desktop-only: the packaged app's former native Version dialog said
       *  this (log path, "updates are manual", a Releases link) in English
       *  only, from a separate surface that could drift from this one. Help →
       *  Version now opens THIS modal instead (see
       *  use-desktop-version-request.ts), so the same three facts are said
       *  here, in the app's own language, reusing the file's existing Row /
       *  ExternalLink / paragraph styles rather than a second set of controls. */}
      {isDesktop && (
        <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-muted-foreground">
          {logPath && (
            <dl>
              <Row term={t(lang, "versionLogPathLabel")} value={logPath} />
            </dl>
          )}
          <p>{t(lang, "versionUpdatesManual")}</p>
          <p>
            <ExternalLink href={APP_RELEASES_URL}>{t(lang, "versionReleasesLink")}</ExternalLink>
          </p>
        </div>
      )}
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
