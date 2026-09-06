"use client";

// Empty-state modal shown on a fresh install when the portfolio registry has
// zero projects.  It is always open (mounted only when projects.length === 0,
// controlled by Task 18) and offers two primary choices:
//
//   • Create project  — reveals the 3-step CreateProjectWizard and calls
//                       onCreate(meta, format, opts) when the wizard finishes.
//   • Load from file  — calls onLoadFromFile immediately.
//
// Non-dismissability: the user MUST pick one of the two actions — there is no
// current project to fall back to.  The shared Modal requires an onClose prop
// (for Escape / backdrop click); we pass a no-op so those gestures do nothing.
// The header is rendered with `hideClose` so there is no dead ✕ control (it
// would be a no-op here and read as a broken affordance).
//
// On a fresh install there is also no Settings UI reachable yet, so the choices
// screen offers a "Backend setup" section: a "Configure database / M365" button
// (opens the shared BackendConfigModal, which wraps IntegrationsSection —
// storage/Turso/M365/Timelog) and a "Run setup wizard" button (the guided
// BackendSetupWizard) before the user creates or loads a project.

import { useId, useMemo, useState } from "react";
import { BackendConfigModal } from "./backend-config-modal";
import { BackendSetupWizard } from "./backend-setup-wizard";
import { TursoProjectPicker } from "./turso-project-picker";
import { getTursoConfig } from "./turso-config";
import { AiSection } from "./settings-sections/ai-section";
import { type Contact } from "./contacts";
import { CreateProjectWizard } from "./create-project-wizard";
import { Button } from "./button";
import { TypeToConfirmDialog } from "./type-to-confirm-dialog";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { type NewProjectOpts } from "./new-project-workspace";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { type Settings } from "./settings-types";
import { ResetSizeButton } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import { type ProjectMeta, type Resource } from "./types";

/** Shipped default for the start window. A path, not a data URL — user overrides
 *  are raster data URLs (SVG uploads stay rejected), but the shipped asset is our
 *  own file and is served same-origin. */
const DEFAULT_START_LOGO = "/ai-pm-cockpit-banner-harbor.svg";

export interface ProjectEmptyStateProps {
  lang: Lang;
  stakeholderNames: string[];
  addressBook: Contact[];
  resources: readonly Resource[];
  /** Current settings (for the backend-config modal opened from the selector). */
  settings: Settings;
  /** Persist edited settings (IntegrationsSection emits a full next value). */
  onChangeSettings: (s: Settings) => void;
  onCreate: (
    meta: ProjectMeta,
    format: "json" | "csv" | "md",
    opts?: NewProjectOpts,
  ) => void;
  /** Load a project from a local file. In Turso mode this switches the portfolio
   *  to file mode (the host reloads); in file mode it just opens the picker. */
  onLoadFromFile: () => void;
  /** Load the bundled demo project (guided-tour entry point). When omitted, the
   *  "Explore a demo project" CTA is not rendered. */
  onLoadDemo?: () => void;
  /** Turso mode: hide the file-format selector in the create view. Defaults to
   *  "file". "Load from file" is offered in BOTH modes (Turso → switches mode). */
  mode?: "file" | "turso";
  /** Turso mode only: archived projects offered for one-click restore (the user
   *  may have archived their last active project and landed here). */
  archivedProjects?: readonly { id: string; name: string }[];
  /** Restore an archived Turso project by id (host reloads into it). */
  onRestore?: (id: string) => void;
  /** Permanently delete an archived Turso project by id (type-to-confirm gated). */
  onDeleteArchived?: (id: string) => void;
}

type View = "choices" | "create";

/** No-op passed to Modal.onClose so Escape/backdrop/X do nothing. */
const noop = () => undefined;

export function ProjectEmptyState({
  lang,
  stakeholderNames,
  addressBook,
  resources,
  settings,
  onChangeSettings,
  onCreate,
  onLoadFromFile,
  onLoadDemo,
  mode = "file",
  archivedProjects = [],
  onRestore,
  onDeleteArchived,
}: ProjectEmptyStateProps) {
  const [view, setView] = useState<View>("choices");
  const [configOpen, setConfigOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [tursoPickerOpen, setTursoPickerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const { ref: sizeRef, reset: resetSize } = useResizable("aipm-cockpit:create-modal-size");
  // Archived-row control names (Restore / Delete permanently) already carried
  // the row's own name, so the collision here is CONDITIONAL: it needs two
  // archived projects sharing a display name, which the registry allows by
  // de-duping on id alone (§276's second surface; projects-panel.tsx was fixed
  // for the same defect on its own list, where its archived rows carried no
  // name at all and so collided unconditionally).
  // ProjectRegistryEntry-shaped ids here are strings, so `useRowTokens`
  // (constrained to `{ id: number }`) doesn't fit — call `buildRowTokens`
  // directly and own the memo, mirroring projects-panel.tsx.
  const archivedTokens = useMemo(
    () => buildRowTokens(archivedProjects.map((p) => ({ id: p.id, name: p.name }))),
    [archivedProjects],
  );

  const handleOpenCreate = () => setView("create");

  const handleCreate = (
    meta: ProjectMeta,
    format: "json" | "csv" | "md",
    opts: NewProjectOpts,
  ) => {
    onCreate(meta, format, opts);
  };

  const handleBackToChoices = () => setView("choices");

  const tursoConfigured = !!getTursoConfig(
    settings.integrations?.turso?.databaseUrl,
    settings.integrations?.turso?.authToken,
  );

  // ★★ Id for the Turso button's `aria-describedby` target. Minted with `useId`
  // rather than a literal so a second mount of this component in one tree
  // cannot point both buttons at whichever node the document happened to hold
  // first (mirrors projects-panel.tsx, which renders TWO of these).
  const loadFromTursoHintId = useId();
  // One source, consumed by BOTH the wrapper's `title` (the sighted mouse
  // user's tooltip) and the `sr-only` description node, so they cannot drift.
  const loadFromTursoHint = tursoConfigured
    ? t(lang, "projectLoadFromTursoHint")
    : t(lang, "projectTursoNotConfigured");

  const titleKey = view === "create" ? "projectsNew" : "projectsEmptyTitle";
  const TITLE_ID = "project-empty-state-title";
  const startLogo = settings.branding?.startLogo;

  return (
    <Modal
      open
      onClose={noop}
      ariaLabelledby={TITLE_ID}
      align="center"
      backdropClassName="bg-ui-dark-blue/60"
      zIndex={50}
    >
      <div
        ref={sizeRef}
        data-modal-panel
        className="relative flex max-h-[90vh] min-h-[420px] w-[960px] min-w-[360px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, titleKey)}
          titleId={TITLE_ID}
          // The create (wizard) view can be closed via the ✕ — it returns to the
          // choices screen. The choices screen itself has no project to fall back
          // to, so it stays non-dismissable (no ✕) and shows the brand logo.
          onClose={view === "create" ? handleBackToChoices : noop}
          hideClose={view === "choices"}
          headerExtra={<ResetSizeButton onClick={resetSize} lang={lang} />}
          logo={
            view === "choices" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={startLogo || DEFAULT_START_LOGO}
                alt={settings.branding?.slogan ?? t(lang, "appTitle")}
                // ONE sizing for both branches now: the old split gave the default
                // a bare `h-7 w-auto` and only a custom upload a capped box, which
                // stops making sense once the default IS a user-replaceable banner.
                // ★★★ `h-12` IS A DEFINITE HEIGHT AND MUST STAY ONE. This shipped
                // once as `max-h-12 w-auto` — all constraints, no definite size —
                // and the header COLLAPSED: the default banner carries a viewBox
                // but NO width/height attributes, so it has no intrinsic size
                // (`naturalWidth` reports the 300×70 default object size, not the
                // real 1200×280), and with nothing definite to derive from Chrome
                // sized it against the sibling heading's line box — img 128×29.9,
                // `<h2>` 0px wide, "No projects yet" invisible. `e2e/smoke.spec.ts`
                // caught it; nothing in the unit suite or the axe gate can, since
                // jsdom has no layout and the axe seed has a project. A CUSTOM
                // upload is a raster and always has intrinsic dimensions, so only
                // the DEFAULT — i.e. every fresh install — was broken.
                // With the height definite, `w-auto` derives ~206px from the 1200×280
                // ratio; `max-w-[280px]` engages only above 280/48 ≈ 5.8:1 (an upload
                // WIDER than this banner, never a squarer one) and `object-contain`
                // keeps it undistorted when it does. `shrink-0` keeps the logo whole
                // and lets the `truncate` heading absorb a narrow window instead.
                className="h-12 w-auto max-w-[280px] shrink-0 object-contain"
              />
            ) : undefined
          }
        />

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {view === "choices" ? (
            <div className="flex flex-col gap-6">
              <p className="text-sm text-muted-foreground">
                {t(lang, "projectsEmptyTitle")}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button variant="primary" onClick={handleOpenCreate}>
                  {t(lang, "projectsEmptyCreate")}
                </Button>
                {/* Load from file is offered in BOTH modes. In Turso mode the host
                    handler switches the portfolio to file mode and reloads. */}
                <Button variant="secondary" onClick={onLoadFromFile}>
                  {t(lang, "projectsEmptyLoad")}
                </Button>
                {/* Load an existing project from a configured Turso database —
                    file mode only (Turso mode already lists archived projects
                    and has its own picker via the mode selector). */}
                {mode === "file" && (
                  // ★★ The hint rides this WRAPPER, not the Button. A `disabled`
                  // button dispatches no mouse events, so a `title` on it never
                  // surfaces — the explanation of why it is disabled would be
                  // unreachable on the control it explains. Rendering disabled
                  // rather than hiding is deliberate: a hidden button never
                  // teaches the user the capability exists. `aria-disabled` is
                  // NOT a substitute — it still fires onClick.
                  //
                  // ★★★ THE WRAPPER ONLY WORKS BECAUSE OF
                  // `disabled:pointer-events-none` ON THE BUTTON. The span has
                  // ZERO uncovered hit area (its only child is the button), and
                  // a disabled button is still hit-testable by default — so
                  // whether the pointer ever reaches the title-bearing span is
                  // left to each browser's own title lookup. Dropping the button
                  // out of hit-testing makes it fall through deterministically.
                  // ★ CONSEQUENCE: an element with no pointer events cannot
                  // style a cursor either, so `button.tsx`'s
                  // `disabled:cursor-not-allowed` goes INERT here — the wrapper
                  // carries the cursor instead, gated on the same condition.
                  // Both changes are made HERE, never in the shared primitive,
                  // which every other disabled button rides.
                  // ★ Nothing in the unit suite can verify the reachability
                  // itself: jsdom has no layout and renders no native tooltips.
                  // The tests pin the CLASSES and the `aria-describedby` wiring
                  // only; the hover behaviour is owed a browser eye-verify.
                  //
                  // ★★ And `title` is mouse-hover-only — a disabled button is
                  // not focusable, so there is no keyboard route to it at all,
                  // and it is unreachable on touch. `aria-describedby` IS
                  // exposed on a disabled control and OUTRANKS `title` as the
                  // accessible description, so the sr-only node below is what
                  // actually reaches AT. The `title` stays for the sighted
                  // mouse user.
                  <span
                    className={`inline-flex${tursoConfigured ? "" : " cursor-not-allowed"}`}
                    title={loadFromTursoHint}
                  >
                    <Button
                      variant="secondary"
                      disabled={!tursoConfigured}
                      onClick={() => setTursoPickerOpen(true)}
                      aria-describedby={loadFromTursoHintId}
                      className="disabled:pointer-events-none"
                    >
                      {t(lang, "projectLoadFromTurso")}
                    </Button>
                    <span id={loadFromTursoHintId} className="sr-only">
                      {loadFromTursoHint}
                    </span>
                  </span>
                )}
                {/* Explore a demo project — guided-tour entry point. Rendered
                    only when a demo-load handler is wired (empty-state only). */}
                {onLoadDemo && (
                  <Button variant="secondary" onClick={onLoadDemo}>
                    {t(lang, "tourLoadDemo")}
                  </Button>
                )}
              </div>

              {/* Restore an archived project — Turso mode only, when archived
                  projects exist (e.g. the user just archived their last active
                  one and would otherwise be stuck on this screen). */}
              {mode === "turso" && onRestore && archivedProjects.length > 0 && (
                <div className="border-t border-line pt-4">
                  <h3 className="mb-2 text-sm font-semibold text-foreground">
                    {t(lang, "projectsArchived")}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {archivedProjects.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate text-foreground">{p.name}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => onRestore(p.id)}
                            aria-label={rowLabel(
                              t(lang, "projectsRestore"),
                              archivedTokens.get(p.id) ?? p.name,
                            )}
                          >
                            {t(lang, "projectsRestore")}
                          </Button>
                          {onDeleteArchived && (
                            <Button
                              variant="destructive"
                              onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                              aria-label={rowLabel(
                                t(lang, "projectsDeletePermanently"),
                                archivedTokens.get(p.id) ?? p.name,
                              )}
                            >
                              {t(lang, "delete")}
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Backend setup — configure storage / integrations before there
                  is any project to fall back to. */}
              <div className="border-t border-line pt-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  {t(lang, "backendSetup")}
                </h3>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setConfigOpen(true)}
                    title={t(lang, "emptyStateConfigDbM365Tip")}
                  >
                    {t(lang, "emptyStateConfigDbM365")}
                  </Button>
                  <Button variant="secondary" onClick={() => setWizardOpen(true)}>
                    {t(lang, "setupWizardRun")}
                  </Button>
                  <Button variant="secondary" onClick={() => setAiConfigOpen(true)}>
                    {t(lang, "emptyStateConfigAi")}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <CreateProjectWizard
              lang={lang}
              stakeholderNames={stakeholderNames}
              addressBook={addressBook}
              resources={resources}
              settings={settings}
              onChangeSettings={onChangeSettings}
              onCreate={handleCreate}
              onCancel={handleBackToChoices}
              hideFormat={mode === "turso"}
            />
          )}
        </div>

      </div>

      {configOpen && (
        <BackendConfigModal
          lang={lang}
          title={t(lang, "emptyStateConfigDbM365")}
          settings={settings}
          onChangeSettings={onChangeSettings}
          onClose={() => setConfigOpen(false)}
          noCurrentProject
        />
      )}

      {aiConfigOpen && (
        <BackendConfigModal
          lang={lang}
          title={t(lang, "emptyStateConfigAi")}
          settings={settings}
          onChangeSettings={onChangeSettings}
          onClose={() => setAiConfigOpen(false)}
        >
          <AiSection lang={lang} settings={settings} onChange={onChangeSettings} hideUsage />
        </BackendConfigModal>
      )}

      {wizardOpen && (
        <BackendSetupWizard
          lang={lang}
          open
          settings={settings}
          onChangeSettings={onChangeSettings}
          onClose={() => setWizardOpen(false)}
          noCurrentProject
        />
      )}

      {tursoPickerOpen && (
        <TursoProjectPicker
          lang={lang}
          settings={settings}
          onClose={() => setTursoPickerOpen(false)}
        />
      )}

      {deleteTarget && onDeleteArchived && (
        <TypeToConfirmDialog
          lang={lang}
          title={t(lang, "projectsHardDeleteTitle")}
          message={t(lang, "projectsHardDeleteMessage")}
          confirmValue={deleteTarget.name}
          confirmLabel={t(lang, "projectsDeletePermanently")}
          onConfirm={() => {
            onDeleteArchived(deleteTarget.id);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </Modal>
  );
}
