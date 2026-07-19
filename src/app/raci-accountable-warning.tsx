"use client";

// Shared amber warning badge for a milestone's RACI "Accountable" coverage.
// Rendered identically by the RACI panel and the stakeholder report (both drove
// the same `bg-[var(--rag-amber)]/20` chip off the same `RaciWarning` value).
// Renders nothing for "none".

import { Badge } from "./badge";
import { t, type Lang } from "./i18n";
import type { RaciWarning } from "./stakeholders";

const AMBER_CHIP =
  "font-medium bg-[var(--rag-amber)]/20 text-ui-dark-blue dark:text-ui-light-grey";

export function RaciAccountableWarning({
  lang,
  warning,
}: {
  lang: Lang;
  warning: RaciWarning;
}) {
  if (warning === "none") return null;
  return (
    <Badge className={AMBER_CHIP}>
      {t(lang, warning === "missing" ? "raciAccountableMissing" : "raciAccountableMultiple")}
    </Badge>
  );
}
