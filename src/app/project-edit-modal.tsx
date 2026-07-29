"use client";

// The project modal host, shared by the Projects panel (create + edit) and the
// Settings → General project block (edit). Extracted so Settings does not have
// to copy the Modal + panel + header + scroller block — dup:check is blocking,
// and two copies would drift on chrome, sizing and dismissal behaviour.
//
// Presentational: every value and handler is a prop.

import type { ReactNode } from "react";
import { type Contact } from "./contacts";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { ProjectForm } from "./project-form";
import { ResetSizeButton } from "./task-manager-ui";
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
  sizeKey: string;
  onSubmit: (meta: ProjectMeta) => void;
  onCancel: () => void;
}

/** The shell wrapped around a prefilled `ProjectForm` — the edit flow, mounted
 *  from both the Projects panel and Settings → General. */
export function ProjectEditModal({
  lang, initial, stakeholderNames, addressBook, resources, sizeKey, onSubmit, onCancel,
}: ProjectEditModalProps) {
  return (
    <ProjectModalShell lang={lang} title={t(lang, "projectsEdit")} sizeKey={sizeKey} onClose={onCancel}>
      <ProjectForm
        initial={initial}
        stakeholderNames={stakeholderNames}
        addressBook={addressBook}
        resources={resources}
        lang={lang}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </ProjectModalShell>
  );
}
