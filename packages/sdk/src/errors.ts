import { AbeleError, ErrorCodeSchema } from "@abele/sync-protocol";
import {
  EngineError,
  HttpError,
  ExternalStateError,
  SyncCancelled,
} from "@abele/sync-core";

export class RecoveryRequiredError extends Error {
  readonly code = "RECOVERY_REQUIRED";
  constructor() {
    super(
      "Replica recovery required. Preserve files and state; reopen with the original state directory or seek recovery assistance.",
    );
    this.name = "RecoveryRequiredError";
  }
}

/** Rebuild errors from classifications only; text, causes and details are untrusted. */
export function safeError(error: unknown): Error {
  if (error instanceof SyncCancelled) return new SyncCancelled();
  if (
    error instanceof ExternalStateError &&
    error.reason === "recovery-required"
  )
    return new RecoveryRequiredError();
  if (error instanceof HttpError)
    return new HttpError(
      error.status,
      engineCode(error.code),
      "Sync request failed",
    );
  if (error instanceof EngineError)
    return new EngineError(engineCode(error.code), "Sync request failed");
  if (error instanceof AbeleError) {
    const code = ErrorCodeSchema.safeParse(error.code);
    if (code.success) return new AbeleError(code.data, "Sync request refused");
  }
  return new Error("Sync operation failed");
}

function engineCode(code: unknown): EngineError["code"] {
  return code === "offline" ||
    code === "unauthorized" ||
    code === "conflict" ||
    code === "io" ||
    code === "lost"
    ? code
    : "protocol";
}

/** Classify transient HTTP failures before core loses the transport status. */
export function safeFetch(fetcher: typeof fetch): typeof fetch {
  return async (...args) => {
    const response = await fetcher(...args);
    if (response.status >= 500 && response.status <= 599) {
      // The body is untrusted and may never finish; it cannot delay a retry.
      void response.body?.cancel().catch(() => {});
      throw new HttpError(
        response.status,
        "offline",
        "Sync server unavailable",
      );
    }
    return response;
  };
}
