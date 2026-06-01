"use client";

import { useResizable } from "./use-resizable";
import { ResetSizeButton, ResizeCornerHint } from "./task-manager-ui";
import { CENTERED_HALF_PANE_CLASS } from "./view-styles";
import { t } from "./i18n";
import { RolesEditor, type RolesEditorProps } from "./roles-editor";

export function RolesPanel(props: RolesEditorProps) {
  const { ref, reset } = useResizable("lop-app:manage-roles-size");
  return (
    <section ref={ref} className={CENTERED_HALF_PANE_CLASS}>
      <header className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">{t(props.lang, "resourcesManageRoles")}</h2>
        <ResetSizeButton onClick={reset} lang={props.lang} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto"><RolesEditor {...props} /></div>
      <ResizeCornerHint lang={props.lang} />
    </section>
  );
}
