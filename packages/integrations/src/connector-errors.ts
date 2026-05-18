export const connectorFailureCodeValues = [
  "invalid_request",
  "not_configured",
  "timeout",
  "rate_limited",
  "unauthorized",
  "remote_error"
] as const;

export type ConnectorFailureCode = (typeof connectorFailureCodeValues)[number];

export class ConnectorFailureError extends Error {
  constructor(
    public readonly provider: string,
    public readonly operation: string,
    public readonly code: ConnectorFailureCode,
    public readonly retryable: boolean,
    options?: {
      statusCode?: number;
      retryAfterSeconds?: number;
      cause?: unknown;
      message?: string;
    }
  ) {
    super(
      options?.message ??
        `${provider} ${operation} failed with ${code.replaceAll("_", " ")}${options?.statusCode ? ` (HTTP ${options.statusCode})` : ""}.`
    );
    this.name = "ConnectorFailureError";
    this.statusCode = options?.statusCode;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.cause = options?.cause;
  }

  readonly statusCode?: number;
  readonly retryAfterSeconds?: number;
  override readonly cause?: unknown;
}

export function parseRetryAfterSeconds(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

export function createNotConfiguredConnectorError(params: {
  provider: string;
  operation: string;
  envVar: string;
}): ConnectorFailureError {
  return new ConnectorFailureError(params.provider, params.operation, "not_configured", false, {
    message: `${params.provider} is not configured. Set ${params.envVar}.`
  });
}

export function createInvalidConnectorRequestError(params: {
  provider: string;
  operation: string;
  message: string;
}): ConnectorFailureError {
  return new ConnectorFailureError(params.provider, params.operation, "invalid_request", false, {
    message: params.message
  });
}

export function createHttpConnectorError(params: {
  provider: string;
  operation: string;
  statusCode: number;
  retryAfterSeconds?: number;
  message?: string;
}): ConnectorFailureError {
  const code =
    params.statusCode === 401 || params.statusCode === 403
      ? "unauthorized"
      : params.statusCode === 429
        ? "rate_limited"
        : "remote_error";
  const retryable = code === "rate_limited" || params.statusCode >= 500;

  return new ConnectorFailureError(params.provider, params.operation, code, retryable, {
    statusCode: params.statusCode,
    retryAfterSeconds: params.retryAfterSeconds,
    message: params.message
  });
}

export function getConnectorHttpStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as {
    code?: unknown;
    status?: unknown;
    response?: {
      status?: unknown;
      headers?: {
        get?: (name: string) => string | null;
        [key: string]: unknown;
      };
    };
  };
  const status = candidate.response?.status ?? candidate.status ?? candidate.code;

  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}

export function createConnectorTimeoutSignal(params: {
  timeoutMs: number;
  signal?: AbortSignal;
}): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(params.timeoutMs);

  if (!params.signal) {
    return timeoutSignal;
  }

  if (params.signal.aborted) {
    return params.signal;
  }

  return AbortSignal.any([params.signal, timeoutSignal]);
}

export function normalizeConnectorThrownError(params: {
  provider: string;
  operation: string;
  error: unknown;
}): ConnectorFailureError {
  if (params.error instanceof ConnectorFailureError) {
    return params.error;
  }

  const timeout =
    typeof params.error === "object" &&
    params.error !== null &&
    "name" in params.error &&
    typeof params.error.name === "string" &&
    (params.error.name === "AbortError" || params.error.name === "TimeoutError");

  if (timeout) {
    return new ConnectorFailureError(params.provider, params.operation, "timeout", true, {
      cause: params.error,
      message: `${params.provider} ${params.operation} timed out.`
    });
  }

  const statusCode = getConnectorHttpStatusCode(params.error);

  if (statusCode !== undefined) {
    return createHttpConnectorError({
      provider: params.provider,
      operation: params.operation,
      statusCode,
      retryAfterSeconds:
        typeof params.error === "object" &&
        params.error !== null &&
        "response" in params.error &&
        typeof params.error.response === "object" &&
        params.error.response !== null &&
        "headers" in params.error.response &&
        typeof params.error.response.headers === "object" &&
        params.error.response.headers !== null &&
        "get" in params.error.response.headers &&
        typeof params.error.response.headers.get === "function"
          ? parseRetryAfterSeconds(params.error.response.headers.get("retry-after"))
          : undefined,
      message:
        params.error instanceof Error && params.error.message
          ? params.error.message
          : undefined
    });
  }

  return new ConnectorFailureError(params.provider, params.operation, "remote_error", true, {
    cause: params.error,
    message:
      params.error instanceof Error && params.error.message
        ? params.error.message
        : `${params.provider} ${params.operation} failed due to an upstream error.`
  });
}
