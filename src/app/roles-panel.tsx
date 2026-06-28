"use client";

import { useRef } from "react";
import { CENTERED_FIT_PANE_CLASS } from "./view-styles";
import { RolesEditor, type RolesEditorProps } from "./roles-editor";

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
    <section ref={paneRef} className={`print-root print-landscape ${CENTERED_FIT_PANE_CLASS}`}>
      <div className="min-h-0 flex-1 overflow-y-auto pr-2"><RolesEditor {...props} onResetSize={resetSize} /></div>
    </section>
  );
}
