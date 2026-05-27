"use client";

import { createContext, useContext, type ReactNode } from "react";
import { type Command } from "./voice";

export interface VoiceCommandHandlers {
  onCommand: (cmd: Command, originalText: string) => void;
  onError: (msg: string) => void;
}

const VoiceCommandContext = createContext<VoiceCommandHandlers | null>(null);

export function VoiceCommandProvider({
  value,
  children,
}: {
  value: VoiceCommandHandlers | null;
  children: ReactNode;
}) {
  return (
    <VoiceCommandContext.Provider value={value}>{children}</VoiceCommandContext.Provider>
  );
}

/** Voice-command handlers if a provider is in scope, else null (e.g. popout). */
export function useVoiceCommand(): VoiceCommandHandlers | null {
  return useContext(VoiceCommandContext);
}
