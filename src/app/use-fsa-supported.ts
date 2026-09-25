// Hydration-safe "does this browser have the File System Access open picker?"
// The server snapshot is TRUE so SSR renders the load controls enabled; the
// client snapshot then disables them in Firefox/Safari (§574). Module-level
// functions keep the snapshot identities stable (an unstable getSnapshot
// makes useSyncExternalStore loop). Same pattern as task-manager-ui.tsx.
import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};
function getClient(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}
function getServer(): boolean {
  return true;
}

export function useFsaSupported(): boolean {
  return useSyncExternalStore(subscribeNoop, getClient, getServer);
}
