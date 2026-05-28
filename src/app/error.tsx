"use client";

// Per-segment error boundary. Catches uncaught render errors in `page.tsx`
// and its descendants (every dynamic panel, every modal). Without this, a
// single render crash anywhere in the tree blanks the whole app.
//
// Intentionally English-only: the German dictionary is lazy-loaded via
// loadI18n("de"); if i18n.ts itself is what crashed, calling t() from the
// error path would make things worse. Document `lang="en"` already.
//
// Next 16 file-convention reference:
//   node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md

import { useEffect } from "react";

interface ErrorPageProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

export default function ErrorPage({ error, unstable_retry }: ErrorPageProps) {
  useEffect(() => {
    // Surface to the browser console so users reporting bugs can include it.
    // No external telemetry — keep error-path side effects minimal.
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex min-h-[60vh] items-center justify-center p-8"
    >
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 text-center">
        <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-foreground">
          An unexpected error interrupted this view. Your saved tasks are
          unaffected — they live in browser storage and the next load will
          pick them back up.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-foreground/70">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:bg-AIPM-dark-blue/90 focus:outline-none focus:ring-2 focus:ring-AIPM-green focus:ring-offset-2"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-AIPM-green focus:ring-offset-2 dark:text-AIPM-light-grey"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
