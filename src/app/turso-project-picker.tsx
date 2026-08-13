"use client";

// Picker for loading an existing project from a configured Turso database.
// Fetches the ACTIVE project list on open — no portfolio-mode flip needed
// just to browse — and switches straight into whichever project is clicked
// via commitTursoPortfolioSwitch. Mirrors "Load from file" as a direct,
// self-contained action rather than routing through the general Settings
// File/Turso mode toggle (which has no project picker of its own).
//
// Archived projects are out of scope here — both call sites already have a
// dedicated archived-project restore flow; this picker lists active
// projects only.

import { useEffect, useState } from "react";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { getTursoConfig } from "./turso-config";
import { listProjects } from "./turso-portfolio";
import { commitTursoPortfolioSwitch } from "./portfolio-mode";
import { type Settings } from "./settings-types";
import type { ProjectListEntry } from "./turso-tenant-schema";

export interface TursoProjectPickerProps {
  lang: Lang;
  settings: Settings;
  onClose: () => void;
}

type FetchState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; projects: ProjectListEntry[] };

const TITLE_ID = "turso-project-picker-title";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function TursoProjectPicker({ lang, settings, onClose }: TursoProjectPickerProps) {
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  // No synchronous setState here — the first setState happens inside the
  // .then/.catch, after the fetch's microtask boundary, same shape as
  // task-manager.tsx's refreshTursoProjects (whose setState calls run only
  // after its first `await`). Calling this directly from the mount effect
  // below therefore doesn't trip `react-hooks/set-state-in-effect`; a
  // synchronous "loading" reset belongs to `retry`, which fires from a click
  // handler, not an effect.
  function fetchProjects() {
    const cfg = getTursoConfig(
      settings.integrations?.turso?.databaseUrl,
      settings.integrations?.turso?.authToken,
    );
    listProjects(cfg)
      .then((projects) => setState({ kind: "ready", projects }))
      .catch((err: unknown) =>
        setState({ kind: "error", message: `${t(lang, "tursoPickerError")} ${errorText(err)}` }),
      );
  }

  function retry() {
    setState({ kind: "loading" });
    fetchProjects();
  }

  // Fetch once on mount. The initial state is already "loading", so the
  // effect needs no setState of its own — it only kicks off the fetch whose
  // resolution updates state asynchronously. Deps stay `[]`; it only ever
  // needs to fire once.
  useEffect(() => {
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handlePick(id: string) {
    commitTursoPortfolioSwitch(settings, id);
  }

  return (
    <Modal open onClose={onClose} ariaLabelledby={TITLE_ID} align="center" zIndex={60}>
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[520px] min-w-[360px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader lang={lang} title={t(lang, "tursoPickerTitle")} titleId={TITLE_ID} onClose={onClose} />
        <div className="overflow-y-auto p-6">
          {state.kind === "loading" && (
            <p className="text-sm text-muted-foreground">{t(lang, "tursoPickerLoading")}</p>
          )}
          {state.kind === "error" && (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-ui-pink-strong">{state.message}</p>
              <Button variant="secondary" size="sm" onClick={retry}>
                {t(lang, "tursoPickerRetry")}
              </Button>
            </div>
          )}
          {state.kind === "ready" && state.projects.length === 0 && (
            <EmptyState compact title={t(lang, "tursoPickerEmpty")} />
          )}
          {state.kind === "ready" && state.projects.length > 0 && (
            <ul className="flex flex-col gap-2">
              {state.projects.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{p.meta.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{p.meta.code}</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handlePick(p.id)}
                    aria-label={`${t(lang, "tursoPickerLoad")} – ${p.meta.name}`}
                  >
                    {t(lang, "tursoPickerLoad")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
