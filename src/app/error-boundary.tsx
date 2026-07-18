// src/app/error-boundary.tsx
"use client";

import { Component, type ReactNode } from "react";
import { t } from "./i18n";
import { quarantineConfig, readPersistedLang } from "./recovery-config";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

/** Top-level boundary: on a THROWN render error it shows a recovery fallback
 *  instead of a white screen. (Silent render loops are not caught — those use
 *  ?safe=1 / /recovery directly.) */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // Surface for diagnostics; the fallback handles user recovery.
    console.error("App crashed (caught by ErrorBoundary)", error);
  }

  private handleReset = (): void => {
    quarantineConfig();
    try {
      window.location.assign("/");
    } catch {
      /* noop */
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    const lang = readPersistedLang();
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface p-8 text-center">
        <h1 className="text-2xl font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, "errorBoundaryTitle")}
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">{t(lang, "errorBoundaryBody")}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href="/recovery"
            className="rounded-md bg-ui-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {t(lang, "errorBoundaryRecover")}
          </a>
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ui-dark-blue hover:bg-surface-muted dark:text-ui-light-grey"
          >
            {t(lang, "errorBoundaryReset")}
          </button>
        </div>
      </div>
    );
  }
}
