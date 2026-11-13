// Every external service the app's own server and the desktop shell contact, in one list. The browser's own
// hosts are the CSP constants in `src/proxy.ts`; this list is what the CSP cannot see. A test walks the
// shipped source and fails when a server route directory or a desktop file that makes network calls is
// neither registered here nor listed with a reason, so the list cannot fall behind the code. The compliance
// pack renders its "server destinations" table from it; each text states what the request builder sends,
// so change a text when its call site changes.

import type { TranslationKey } from "./i18n";

/** Who RUNS the receiving service: the vendor when the code pins its host (anthropic, atlassian, timelog, turso, ecb, github), `customer` when the deploying organisation runs it (its own AI gateway), `user-chosen` when the user enters any endpoint. */
export type DestinationOperator = "customer" | "anthropic" | "atlassian" | "timelog" | "turso" | "ecb" | "github" | "user-chosen";

export interface OutboundDestination {
  id: string;
  /** Repo-relative: an `src/app/api/<dir>` directory, an `src/app/api/<dir>/<file>.ts`, or a `desktop/src/**` file. */
  caller: string;
  operator: DestinationOperator;
  /** What the request carries. */
  sentKey: TranslationKey;
  /** What causes it. */
  whenKey: TranslationKey;
}

export const OUTBOUND_DESTINATIONS: readonly OutboundDestination[] = [
  { id: "ai-relay-anthropic", caller: "src/app/api/ai/_relay.ts", operator: "anthropic", sentKey: "outboundAiRelaySent", whenKey: "outboundAiRelayWhen" },
  { id: "ai-gateway", caller: "src/app/api/ai/_relay.ts", operator: "customer", sentKey: "outboundAiGatewaySent", whenKey: "outboundAiGatewayWhen" },
  { id: "chat-sweep-turso", caller: "src/app/api/ai/_chat-sweep.ts", operator: "turso", sentKey: "outboundChatSweepSent", whenKey: "outboundChatSweepWhen" },
  { id: "jira", caller: "src/app/api/jira", operator: "atlassian", sentKey: "outboundJiraSent", whenKey: "outboundJiraWhen" },
  { id: "confluence", caller: "src/app/api/confluence", operator: "atlassian", sentKey: "outboundConfluenceSent", whenKey: "outboundConfluenceWhen" },
  { id: "timelog", caller: "src/app/api/timelog", operator: "timelog", sentKey: "outboundTimelogSent", whenKey: "outboundTimelogWhen" },
  { id: "speech-to-text", caller: "src/app/api/stt", operator: "user-chosen", sentKey: "outboundSttSent", whenKey: "outboundSttWhen" },
  { id: "ecb-rates", caller: "src/app/api/ecb", operator: "ecb", sentKey: "outboundEcbSent", whenKey: "outboundEcbWhen" },
  { id: "desktop-updater", caller: "desktop/src/updater.ts", operator: "github", sentKey: "outboundUpdaterSent", whenKey: "outboundUpdaterWhen" },
];

/** Files the scan finds that make no call to an external service, each with the reason. */
export const NO_OUTBOUND_CALLERS: readonly { caller: string; reason: string }[] = [
  { caller: "desktop/src/main.ts", reason: "Its only fetch( asks the app's own loopback address (APP_ORIGIN) whether the bundled server is up; links to external pages open in the user's own browser through shell.openExternal." },
  { caller: "desktop/src/lib/constants.ts", reason: "Holds the loopback origin and the releases-page address as constants; the releases page is only opened in the user's browser (by updater.ts), never fetched." },
  { caller: "desktop/src/lib/electron-updater-loader.ts", reason: "Only picks the autoUpdater object out of the imported module; it makes no request itself (updater.ts does, and is registered)." },
];
