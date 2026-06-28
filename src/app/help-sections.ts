// Shared Help content table — consumed by both the floating top-bar Help panel
// (`help-menu.tsx`) and the in-pane Help view (`help-view.tsx`). Each entry is a
// title + body i18n key pair (EN/DE strings live in i18n*.ts).

import type { TranslationKey } from "./i18n";

export interface HelpSection {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
}

export const HELP_SECTIONS: readonly HelpSection[] = [
  { titleKey: "helpSecLayoutTitle", bodyKey: "helpSecLayoutBody" },
  { titleKey: "helpSecAddTitle", bodyKey: "helpSecAddBody" },
  { titleKey: "helpSecFieldVisibilityTitle", bodyKey: "helpSecFieldVisibilityBody" },
  { titleKey: "helpSecTemplatesTitle", bodyKey: "helpSecTemplatesBody" },
  { titleKey: "helpSecPerProjectFunctionsTitle", bodyKey: "helpSecPerProjectFunctionsBody" },
  { titleKey: "helpSecTemplateSuggestTitle", bodyKey: "helpSecTemplateSuggestBody" },
  { titleKey: "helpSecWorkspaceTitle", bodyKey: "helpSecWorkspaceBody" },
  { titleKey: "helpSecTabsTitle", bodyKey: "helpSecTabsBody" },
  { titleKey: "helpSecTasksTitle", bodyKey: "helpSecTasksBody" },
  { titleKey: "helpSecTaskStatusTitle", bodyKey: "helpSecTaskStatusBody" },
  { titleKey: "helpSecGanttTitle", bodyKey: "helpSecGanttBody" },
  { titleKey: "helpSecRaidTitle", bodyKey: "helpSecRaidBody" },
  { titleKey: "helpSecResourcesTitle", bodyKey: "helpSecResourcesBody" },
  { titleKey: "helpSecSteeringTitle", bodyKey: "helpSecSteeringBody" },
  { titleKey: "helpSecActivityTitle", bodyKey: "helpSecActivityBody" },
  { titleKey: "helpSecDocumentsTitle", bodyKey: "helpSecDocumentsBody" },
  { titleKey: "helpSecVoiceTitle", bodyKey: "helpSecVoiceBody" },
  { titleKey: "helpSecNotifTitle", bodyKey: "helpSecNotifBody" },
  { titleKey: "helpSecTimezonesTitle", bodyKey: "helpSecTimezonesBody" },
  { titleKey: "helpSecJiraTitle", bodyKey: "helpSecJiraBody" },
  { titleKey: "helpSecStorageTitle", bodyKey: "helpSecStorageBody" },
  { titleKey: "helpSecSetupWizardTitle", bodyKey: "helpSecSetupWizardBody" },
  { titleKey: "helpSecVersionHistoryTitle", bodyKey: "helpSecVersionHistoryBody" },
  { titleKey: "helpSecAiTitle", bodyKey: "helpSecAiBody" },
  { titleKey: "helpSecAiAdvancedTitle", bodyKey: "helpSecAiAdvancedBody" },
  { titleKey: "helpSecInputFeedbackTitle", bodyKey: "helpSecInputFeedbackBody" },
  { titleKey: "helpSecTourTitle", bodyKey: "helpSecTourBody" },
  { titleKey: "helpSecKeysTitle", bodyKey: "helpSecKeysBody" },
];
