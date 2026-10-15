"use client";

// The project modal host: the Projects panel mounts it for both create and edit (Settings →
// Functions reaches the edit through a request that panel consumes). Extracted so the Modal + panel + header + scroller
// block is not copied per flow — dup:check is blocking, and two copies would drift on chrome,
// sizing and dismissal behaviour.
//
// Presentational: every value and handler is a prop.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { type Contact } from "./contacts";
import { ALL_MODULE_IDS, type FeatureModuleId, sameFeatureSet } from "./feature-modules";
import { Field } from "./form-field";
import { FunctionsPicker } from "./functions-picker";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { MODAL_HELP } from "./help-content";
import { ProjectForm } from "./project-form";
import { ResetSizeButton } from "./task-manager-ui";
import { SimulationSwitch } from "./simulation-switch";
import { useResizable } from "./use-resizable";
import { type ProjectMeta, type Resource } from "./types";

interface ProjectModalShellProps {
  lang: Lang;
  title: string;
  /** localStorage key for the persisted panel size (see `useResizable`). */
  sizeKey: string;
  onClose: () => void;
  children: ReactNode;
}

/** The Modal + resizable panel + ModalHeader + scroller chrome shared by every
 *  project modal — the piece that must never be copy-pasted (dup:check). */
export function ProjectModalShell({ lang, title, sizeKey, onClose, children }: ProjectModalShellProps) {
  const { ref: sizeRef, reset: resetSize } = useResizable(sizeKey);
  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={title}
      align="center"
      backdropClassName="bg-ui-dark-blue/40"
      zIndex={50}
    >
      <div
        ref={sizeRef}
        data-modal-panel
        className="relative flex max-h-[90vh] min-h-[420px] w-[960px] min-w-[360px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={title}
          helpConceptId={MODAL_HELP.projectEdit}
          onClose={onClose}
          headerExtra={<ResetSizeButton onClick={resetSize} lang={lang} />}
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </Modal>
  );
}

interface ProjectEditModalProps {
  lang: Lang;
  /** The project being edited (prefills the form). */
  initial: ProjectMeta;
  /** Suggestions for the key-stakeholder inputs. */
  stakeholderNames: string[];
  /** Address book for the contact picker. */
  addressBook: Contact[];
  /** Registry resources for the link-only contact-person picker. */
  resources: readonly Resource[];
  /** The project's enabled functions (feature modules); seeds the Functions draft. */
  features: readonly FeatureModuleId[];
  /** Scroll the Functions part into view and focus its heading on mount. */
  focusFunctions?: boolean;
  sizeKey: string;
  /** The stored Monte Carlo switch (§502); absent hides the control (held back, or a popout). */
  simulation?: boolean;
  /** `features` is `null` when the functions equal, as a set, the `features` prop seen at open;
   *  `simulation` is `null` when the switch is unchanged since open or not shown. */
  onSubmit: (meta: ProjectMeta, features: FeatureModuleId[] | null, simulation: boolean | null) => void;
  onCancel: () => void;
}

/** The Functions part of Edit project: the shared picker over a LOCAL draft. The
 *  draft is written nowhere until the form is saved. */
function FunctionsSection({
  lang, draft, onChange, focusOnMount,
}: {
  lang: Lang;
  draft: readonly FeatureModuleId[];
  onChange: (next: FeatureModuleId[]) => void;
  focusOnMount: boolean;
}) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Runs before the Modal's own initial-focus frame; that frame leaves focus alone
  // when a control inside the dialog already holds it (modal.tsx), so this wins.
  useEffect(() => {
    if (!focusOnMount) return;
    const heading = headingRef.current;
    heading?.scrollIntoView?.({ block: "start" });
    heading?.focus({ preventScroll: true });
    // Mount-only: the request is a property of how the dialog was opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="text-base font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ui-green">
        {t(lang, "editProjectFunctionsHeading")}
      </h3>
      <FunctionsPicker lang={lang} features={draft} onChange={onChange} />
    </section>
  );
}

/** The shell wrapped around a prefilled `ProjectForm` — the edit flow, mounted
 *  by the Projects panel (`projects-panel.tsx`). */
export function ProjectEditModal({
  lang, initial, stakeholderNames, addressBook, resources, features, focusFunctions, simulation, sizeKey, onSubmit, onCancel,
}: ProjectEditModalProps) {
  // Both drafts compare against the value seen at OPEN, not the live prop: a write elsewhere while the
  // dialog is open (another tab, the AI) must survive a Save that left that part untouched. A draft
  // moved away and back again also counts as untouched, so the outside write wins then too.
  const [featuresAtOpen] = useState<FeatureModuleId[]>(() => [...features]);
  const [draft, setDraft] = useState<FeatureModuleId[]>(() => [...featuresAtOpen]);
  const [simAtOpen] = useState(simulation === true);
  const [simDraft, setSimDraft] = useState(simAtOpen);
  const handleSubmit = (meta: ProjectMeta) =>
    onSubmit(
      meta,
      sameFeatureSet(draft, featuresAtOpen) ? null : ALL_MODULE_IDS.filter((id) => draft.includes(id)),
      simulation === undefined || simDraft === simAtOpen ? null : simDraft,
    );
  return (
    <ProjectModalShell lang={lang} title={t(lang, "projectsEdit")} sizeKey={sizeKey} onClose={onCancel}>
      <ProjectForm
        initial={initial}
        stakeholderNames={stakeholderNames}
        addressBook={addressBook}
        resources={resources}
        lang={lang}
        onSubmit={handleSubmit}
        onCancel={onCancel}
        submitLabel={t(lang, "projectEditSave")}
        // The per-project Monte Carlo switch (§502) over a LOCAL draft, written only on Save. `group`:
        // a <label> would bind to the toggle and replace its accessible name with the caption.
        projectManagerAside={simulation !== undefined && (
          <Field label={t(lang, "editProjectForecastHeading")} hint={t(lang, "tipForecasting")} group>
            <SimulationSwitch lang={lang} pressed={simDraft} onToggle={() => setSimDraft(!simDraft)} />
          </Field>
        )}
        extraSection={
          <FunctionsSection
            lang={lang}
            draft={draft}
            onChange={setDraft}
            focusOnMount={focusFunctions === true}
          />
        }
      />
    </ProjectModalShell>
  );
}
