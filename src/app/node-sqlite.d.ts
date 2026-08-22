// Minimal ambient types for `node:sqlite` (a Node 22.5+ / 24 built-in).
//
// `@types/node` is pinned at 20.x in this repo, which PREDATES these typings, so
// the module resolves at RUNTIME (vitest runs on Node 24) but not at COMPILE
// time: a plain `import { DatabaseSync } from "node:sqlite"` fails
// `npx tsc --noEmit` with TS2591 while passing vitest — the repo's documented
// vitest-green/tsc-red shape. Only `turso-schema.execute.test.ts` uses it.
//
// ★★ DELETE THIS FILE when `@types/node` reaches >= 22.5. From that version on
// it SHADOWS the real declarations, so a stub that is merely incomplete (or has
// drifted from the upstream signature) would start silently overriding correct
// types instead of supplying missing ones. Deliberately trimmed to the surface
// the test actually calls.
declare module "node:sqlite" {
  /** Node's `SupportedValueType` — what a statement parameter may be. */
  type SqliteInputValue = null | number | bigint | string | Uint8Array;

  interface StatementSync {
    run(...params: SqliteInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    all(...params: SqliteInputValue[]): Record<string, unknown>[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
