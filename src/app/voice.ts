import type { Lang } from "./i18n";

// --- Minimal SpeechRecognition typing (Web Speech API is non-standard) ---

type SREvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    [index: number]: { transcript: string; confidence: number };
  }>;
};

type SRError = { error: string };

type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRError) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type SRCtor = new () => SR;

export function getCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) ?? null;
}

export function isVoiceSupported(): boolean {
  return getCtor() !== null;
}

function recogLang(lang: Lang): string {
  if (lang === "de") return "de-DE";
  return lang;
}

type StartOptions = {
  lang: Lang;
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd?: () => void;
  onError?: (err: string) => void;
  continuous?: boolean;
};

export function startRecognition(opts: StartOptions): (() => void) | null {
  const Ctor = getCtor();
  if (!Ctor) return null;
  const recog = new Ctor();
  recog.lang = recogLang(opts.lang);
  recog.continuous = Boolean(opts.continuous);
  recog.interimResults = Boolean(opts.onInterim);
  recog.maxAlternatives = 1;

  recog.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (final) opts.onFinal(final.trim());
    else if (interim && opts.onInterim) opts.onInterim(interim.trim());
  };

  recog.onend = () => opts.onEnd?.();
  recog.onerror = (e) => opts.onError?.(e.error || "unknown");

  try {
    recog.start();
  } catch (e) {
    opts.onError?.(String(e));
    return null;
  }

  return () => {
    try {
      recog.stop();
    } catch {
      /* noop */
    }
  };
}

// --- Command parsing ---

export type Command =
  | { kind: "openForm" }
  | { kind: "openFormWith"; taskName: string }
  | { kind: "edit"; id: number }
  | { kind: "delete"; id: number }
  | { kind: "sendInquiry"; id: number }
  | { kind: "clearAll" }
  | { kind: "search"; query: string }
  | { kind: "clearSearch" }
  | { kind: "language"; lang: Lang }
  | { kind: "unknown"; text: string };

type Matcher = (text: string) => Command | null;

const EN_PATTERNS: Matcher[] = [
  (t) => {
    const m = /^(?:edit|update|change|modify)\s+task\s+(\d+)\b/i.exec(t);
    return m ? { kind: "edit", id: Number(m[1]) } : null;
  },
  (t) => {
    const m = /^(?:delete|remove)\s+task\s+(\d+)\b/i.exec(t);
    return m ? { kind: "delete", id: Number(m[1]) } : null;
  },
  (t) => {
    const m =
      /^send\s+(?:inquiry|update|reminder)\s+(?:for|about)?\s*task\s+(\d+)\b/i.exec(
        t,
      );
    return m ? { kind: "sendInquiry", id: Number(m[1]) } : null;
  },
  (t) => {
    if (/^(?:clear|delete|remove)\s+all(?:\s+tasks)?\b/i.test(t))
      return { kind: "clearAll" };
    return null;
  },
  (t) => {
    const m = /^(?:add|create|new)\s+(?:a\s+)?(?:new\s+)?task\s+(.+)/i.exec(t);
    return m ? { kind: "openFormWith", taskName: m[1].trim() } : null;
  },
  (t) => {
    if (/^(?:add|create|new|open)\s+(?:a\s+)?(?:new\s+)?task\b/i.test(t))
      return { kind: "openForm" };
    return null;
  },
  (t) => {
    if (/^clear\s+search\b/i.test(t)) return { kind: "clearSearch" };
    return null;
  },
  (t) => {
    const m = /^search\s+(?:for\s+)?(.+)/i.exec(t);
    return m ? { kind: "search", query: m[1].trim() } : null;
  },
  (t) => {
    const m =
      /^(?:switch|change)?\s*(?:to\s+|language\s+to\s+)?(english\s+u\.?s\.?|english\s+u\.?k\.?|english|german|deutsch)\b/i.exec(
        t,
      );
    if (!m) return null;
    const w = m[1].toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
    if (w.includes("uk") || w.includes("u k"))
      return { kind: "language", lang: "en-GB" };
    if (w.includes("german") || w.includes("deutsch"))
      return { kind: "language", lang: "de" };
    return { kind: "language", lang: "en-US" };
  },
];

const DE_PATTERNS: Matcher[] = [
  (t) => {
    const m =
      /^aufgabe\s+(\d+)\s+(?:bearbeiten|aktualisieren|[aä]ndern)\b/i.exec(t);
    return m ? { kind: "edit", id: Number(m[1]) } : null;
  },
  (t) => {
    const m =
      /^(?:bearbeite|aktualisiere|[aä]ndere)\s+aufgabe\s+(\d+)\b/i.exec(t);
    return m ? { kind: "edit", id: Number(m[1]) } : null;
  },
  (t) => {
    const m = /^aufgabe\s+(\d+)\s+(?:l[oö]schen|entfernen)\b/i.exec(t);
    return m ? { kind: "delete", id: Number(m[1]) } : null;
  },
  (t) => {
    const m = /^(?:l[oö]sche|entferne)\s+aufgabe\s+(\d+)\b/i.exec(t);
    return m ? { kind: "delete", id: Number(m[1]) } : null;
  },
  (t) => {
    const m =
      /^(?:anfrage|update)\s+(?:senden\s+)?(?:f[uü]r\s+)?aufgabe\s+(\d+)\b/i.exec(
        t,
      );
    if (m) return { kind: "sendInquiry", id: Number(m[1]) };
    const m2 = /^aufgabe\s+(\d+)\s+(?:anfrage|update)\s+senden\b/i.exec(t);
    return m2 ? { kind: "sendInquiry", id: Number(m2[1]) } : null;
  },
  (t) => {
    if (/^alle(?:\s+aufgaben)?\s+l[oö]schen\b/i.test(t))
      return { kind: "clearAll" };
    return null;
  },
  (t) => {
    const m = /^neue\s+aufgabe\s+(.+)/i.exec(t);
    return m ? { kind: "openFormWith", taskName: m[1].trim() } : null;
  },
  (t) => {
    if (/^neue\s+aufgabe\b/i.test(t)) return { kind: "openForm" };
    return null;
  },
  (t) => {
    if (/^suche\s+zur[uü]cksetzen\b/i.test(t)) return { kind: "clearSearch" };
    return null;
  },
  (t) => {
    const m = /^suche\s+(?:nach\s+)?(.+)/i.exec(t);
    return m ? { kind: "search", query: m[1].trim() } : null;
  },
  (t) => {
    const m = /^sprache\s+(englisch|deutsch|english|german)\b/i.exec(t);
    if (!m) return null;
    const w = m[1].toLowerCase();
    if (w === "deutsch" || w === "german")
      return { kind: "language", lang: "de" };
    return { kind: "language", lang: "en-US" };
  },
];

const PATTERNS_BY_LANG: Record<Lang, Matcher[]> = {
  "en-US": EN_PATTERNS,
  "en-GB": EN_PATTERNS,
  de: DE_PATTERNS,
};

export function parseCommand(text: string, lang: Lang): Command {
  const cleaned = text.trim().replace(/[.?!,;:]+$/, "");
  const primary = PATTERNS_BY_LANG[lang] || EN_PATTERNS;

  for (const fn of primary) {
    const result = fn(cleaned);
    if (result) return result;
  }
  // Fallback: try the other language's patterns in case of misrecognition
  const fallback = primary === EN_PATTERNS ? DE_PATTERNS : EN_PATTERNS;
  for (const fn of fallback) {
    const result = fn(cleaned);
    if (result) return result;
  }
  return { kind: "unknown", text };
}
