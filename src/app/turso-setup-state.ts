import { isUsableTursoUrl } from "./turso-config";

export interface TursoSetupInput {
  /** The URL as typed in the field (draft). */
  url: string;
  /** The token as typed in the field (draft). */
  token: string;
  /** A usable `NEXT_PUBLIC_TURSO_DATABASE_URL` supplies the URL. */
  urlFromEnv: boolean;
  /** An accepted `NEXT_PUBLIC_TURSO_AUTH_TOKEN` supplies the token. */
  tokenFromEnv: boolean;
  /** The last "Test connection" passed for exactly the current URL and token. */
  testConfirmed: boolean;
}

export interface TursoSetupState {
  urlDone: boolean;
  tokenDone: boolean;
  testDone: boolean;
}

/** Which of the three Turso setup steps already look finished. Pure and i18n-free. */
export function tursoSetupState(input: TursoSetupInput): TursoSetupState {
  return {
    urlDone: input.urlFromEnv || isUsableTursoUrl(input.url),
    tokenDone: input.tokenFromEnv || input.token.trim() !== "",
    testDone: input.testConfirmed,
  };
}
