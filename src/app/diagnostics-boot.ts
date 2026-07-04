// One-time registration of global uncaught-error handlers that feed the diagnostic
// ring. Chains (does not replace) any existing handler.
import { logDiag, migrateLegacyDataLossLog } from "./diagnostics";

let registered = false;

export function registerDiagnosticsGlobalHandlers(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  migrateLegacyDataLossLog();
  window.addEventListener("error", (e: ErrorEvent) => {
    logDiag("error", "uncaught", { message: e.message ?? "", source: e.filename ?? "" });
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? "");
    logDiag("error", "unhandledRejection", { message });
  });
}
