// src/test/turso-wire.ts
//
// Test helpers that read and answer a `/v2/pipeline` request body in both of the
// shapes `runTursoPipeline` sends: one `execute` request per statement, or, for a
// BEGIN…COMMIT list, ONE `batch` request whose steps are the statements plus a
// trailing conditional ROLLBACK (§637).

interface WireStmt { sql: string }
interface WireRequest { type: string; stmt?: WireStmt; batch?: { steps: { stmt: WireStmt }[] } }

function requestsOf(init: RequestInit | undefined): WireRequest[] {
  return (JSON.parse(String(init?.body ?? "{}")) as { requests?: WireRequest[] }).requests ?? [];
}

/** The statements a request carries, in order. A batch's own trailing ROLLBACK step is left out, so the
 *  list reads the same as the statement list the caller passed to `runTursoPipeline`. */
export function pipelineSqls(init: RequestInit | undefined): string[] {
  return requestsOf(init).flatMap((r) =>
    r.type === "batch" ? (r.batch?.steps ?? []).slice(0, -1).map((s) => s.stmt.sql) : [r.stmt?.sql ?? ""],
  );
}

/** A batch answer in which statement step `failing` errored with `message`: the steps before it returned
 *  empty results, the statement steps after it were skipped, and the trailing ROLLBACK step ran. */
export function failedBatchBody(init: RequestInit | undefined, failing: number, message: string): { results: unknown[] } {
  const empty = { cols: [], rows: [] };
  const steps = requestsOf(init).find((r) => r.type === "batch")?.batch?.steps ?? [];
  const last = steps.length - 1;
  return {
    results: [{
      type: "ok",
      response: {
        type: "batch",
        result: {
          step_results: steps.map((_, i) => (i < failing || i === last ? empty : null)),
          step_errors: steps.map((_, i) => (i === failing ? { message } : null)),
        },
      },
    }],
  };
}

/** An all-succeeded answer to that request: one ok per `execute`, or a batch whose every statement step
 *  returned an empty result and whose ROLLBACK step was skipped. */
export function okPipelineBody(init: RequestInit | undefined): { results: unknown[] } {
  const empty = { cols: [], rows: [] };
  return {
    results: requestsOf(init).map((r) => {
      if (r.type !== "batch") return { type: "ok", response: { type: "execute", result: empty } };
      const steps = r.batch?.steps ?? [];
      return {
        type: "ok",
        response: {
          type: "batch",
          result: {
            step_results: steps.map((_, i) => (i < steps.length - 1 ? empty : null)),
            step_errors: steps.map(() => null),
          },
        },
      };
    }),
  };
}
