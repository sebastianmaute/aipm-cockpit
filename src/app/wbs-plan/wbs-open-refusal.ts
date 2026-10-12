// Why `useWbsPlan().open` (the chat tool's entry point) opened nothing, so the
// tool can tell the model what to say instead of a generic refusal.
//
// ★★ Its own import-free module, not wbs-plan.ts: chat-tools.ts names it, and
// rich-text-plain.test.ts's DOM-free guard walks ai-eval.ts's import graph
// through `import type` edges too. wbs-plan.ts imports ai-rich-text (DOMPurify),
// so a type import of it from chat-tools.ts put a DOMPurify caller in that graph.

export type WbsOpenRefusal = "popout" | "aiOff" | "loading" | "busy" | "unknownGroup" | "noTasks";
