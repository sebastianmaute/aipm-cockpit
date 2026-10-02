// The display label for each budget type — ONE map, so the bucket modal, the
// Budget panel and the Budget report cannot name a type differently (§488 added
// the third, which the three hand-written ternaries would each have missed).
import type { TranslationKey } from "./i18n";
import type { BudgetType } from "./types";

export const BUDGET_TYPE_LABEL: Record<BudgetType, TranslationKey> = {
  tm: "budgetTypeTm",
  fixed: "budgetTypeFixed",
  e2e: "budgetTypeE2e",
};
