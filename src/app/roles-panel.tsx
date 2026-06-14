"use client";

import { useRef } from "react";
import { CENTERED_FIT_PANE_CLASS } from "./view-styles";
import { t } from "./i18n";
import { RolesEditor, type RolesEditorProps } from "./roles-editor";
import { ResetSizeButton } from "./task-manager-ui";

export function RolesPanel(props: RolesEditorProps) {
  // The pane defaults to a content-fit height (CENTERED_FIT_PANE_CLASS) and is
  // manually resizable via the CSS `resize` corner, which writes inline
  // width/height. Clearing those inline values returns it to the content-fit
  // default — there is no persistence, so each open starts content-fit.
  const paneRef = useRef<HTMLElement>(null);
  const resetSize = () => {
    const el = paneRef.current;
    if (el) {
      el.style.width = "";
      el.style.height = "";
    }
  };

  return (
    <section ref={paneRef} className={CENTERED_FIT_PANE_CLASS}>
      <header className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">{t(props.lang, "resourcesManageRoles")}</h2>
        <ResetSizeButton onClick={resetSize} lang={props.lang} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto"><RolesEditor {...props} /></div>
    </section>
  );
}
