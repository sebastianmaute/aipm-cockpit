"use client";

import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import {
  APP_BUILD_DATE,
  APP_HIGHLIGHT_KEYS,
  APP_REPO_URL,
  APP_VERSION_LABEL,
} from "./version";

export function VersionMenu({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t(lang, "version")}
        aria-expanded={open}
        title={t(lang, "version")}
        className="rounded-md p-2 text-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-muted-foreground dark:hover:text-AIPM-light-grey"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className="h-5 w-5"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h.01a1 1 0 100-2H10V10a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t(lang, "version")}
          className="absolute right-0 top-full z-40 mt-2 max-h-[80vh] w-80 overflow-y-auto rounded-lg border border-line bg-surface p-4"
        >
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(lang, "version")}
          </h3>
          <p className="text-base font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
            {t(lang, "appTitle")}
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            <Row term={t(lang, "versionVersion")} value={APP_VERSION_LABEL} />
            <Row term={t(lang, "versionBuild")} value={APP_BUILD_DATE} />
          </dl>

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(lang, "versionHighlightsHeader")}
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-foreground">
            {APP_HIGHLIGHT_KEYS.map((k) => (
              <li key={k} className="flex gap-2">
                <span aria-hidden className="mt-0.5 text-AIPM-green">
                  •
                </span>
                <span>{t(lang, k)}</span>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-xs text-foreground">
            {t(lang, "versionTechStack")}
          </p>
          <div className="mt-4 border-t border-line pt-3 text-xs italic text-muted-foreground">
            <a
              href={APP_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium not-italic text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
            >
              Acme ↗
            </a>{" "}
            — Identity Excellence Delivered. Globally.
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {term}
      </dt>
      <dd className="font-mono text-foreground dark:text-AIPM-light-grey">
        {value}
      </dd>
    </div>
  );
}
