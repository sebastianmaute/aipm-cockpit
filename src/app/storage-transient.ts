// src/app/storage-transient.ts — which Turso failures are worth retrying.
//
// Shared by the scheduled-job runner (§772, `scheduled-job-run.ts`) and the
// Action Center learning load (§781, `use-action-learning.ts`). The two compose
// them differently: a scheduled run treats every `StorageNotReadyError` as
// transient, while the learning load stops on a REJECTED token, which no retry
// can fix and the user has to see.
import { TursoHttpError } from "./turso-pipeline";
import { StorageNotReadyError } from "./workspace";

/** A busy or locked database (the open project's autosave holds the tenant database) is transient (spec Run step 3).
 *  SQLite reports it only as text, so this is the one place the wording is read (never stored). */
const BUSY = /SQLITE_BUSY|SQLITE_LOCKED|database (table )?is (locked|busy)/i;
export const isBusyDbError = (e: unknown): boolean => e instanceof Error && BUSY.test(e.message);

/** A server blip: HTTP 429 or 5xx from Turso, by status, not by wording. */
export const isTursoServerBlip = (e: unknown): boolean =>
  e instanceof TursoHttpError && (e.status === 429 || e.status >= 500);

/** Unreachable or timed out (`postPipeline` folds both into this hint). */
export const isStorageUnreachable = (e: unknown): boolean =>
  e instanceof StorageNotReadyError && e.hint === "storage-unreachable";

/** For the learning load (§781): a connectivity failure, a server blip or a busy
 *  database is retried. Everything else — a rejected token
 *  (`turso-token-rejected`, `turso-env-token-rejected`), a SQL error, a malformed
 *  response — is permanent: retrying cannot fix it. */
export const isRetryableLearningLoadError = (e: unknown): boolean =>
  isStorageUnreachable(e) || isTursoServerBlip(e) || isBusyDbError(e);
