"use client";

import { t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { useDraggable } from "./use-draggable";
import { RolesEditor, type RolesEditorProps } from "./roles-editor";

interface Props extends RolesEditorProps {
  open: boolean;
  onClose: () => void;
}

export function RolesModal({
  lang, open, roles, disciplines, grades,
  onSaveRole, onDeleteRole, onResolveOrCreateRole,
  onAddDiscipline, onRenameDiscipline, onDeleteDiscipline, onReorderDisciplines,
  onAddGrade, onRenameGrade, onDeleteGrade, onReorderGrades,
  onClose,
}: Props) {
  const { offset, handleProps } = useDraggable(open);

  if (!open) return null;

  const editorProps: RolesEditorProps = {
    lang, roles, disciplines, grades,
    onSaveRole, onDeleteRole, onResolveOrCreateRole,
    onAddDiscipline, onRenameDiscipline, onDeleteDiscipline, onReorderDisciplines,
    onAddGrade, onRenameGrade, onDeleteGrade, onReorderGrades,
  };

  return (
    <Modal open onClose={onClose} ariaLabel={t(lang, "rolesManageTitle")} align="center" backdropClassName="bg-black/40" zIndex={50}>
      <div
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex max-h-[90vh] w-[720px] min-w-[320px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, "rolesManageTitle")}
          onClose={onClose}
          dragHandleProps={handleProps}
        />

        <div className="flex flex-col gap-6 overflow-y-auto p-5">
          <RolesEditor {...editorProps} />
        </div>
      </div>
    </Modal>
  );
}
