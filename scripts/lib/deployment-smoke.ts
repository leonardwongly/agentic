import crypto from "node:crypto";

type HealthPayload = {
  status?: string;
};

type ReadinessPayload = {
  ok?: boolean;
  status?: string;
};

export type DeploymentSmokeCheck = {
  name: "health" | "readiness" | "session";
  status: number;
  durationMs: number;
};

export type DeploymentSmokeSummary = {
  healthStatus: string | undefined;
  readinessStatus: string | undefined;
  sessionChecked: boolean;
  requestId: string;
  traceId: string;
  checks: DeploymentSmokeCheck[];
};

export type DeploymentSmokeOptions = {
  baseUrl: string;
  accessKey?: string;
  fetchImpl?: typeof fetch;
  requestId?: string;
  traceId?: string;
};

function requireBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");

  if (!normalized) {
    throw new Error("AGENTIC_SMOKE_BASE_URL must be configured.");
  }

  return normalized;
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  input: string,
  init?: RequestInit
): Promise<{ response: Response; payload: T; durationMs: number }> {
  const startedAt = Date.now();
  const response = await fetchImpl(input, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {})
    }
  });

  let payload: T;

  try {
    payload = (await response.json()) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parsing failure.";
    throw new Error(`Deployment smoke received an invalid JSON response: ${message}`);
  }

  return { response, payload, durationMs: Math.max(0, Date.now() - startedAt) };
}

export async function runDeploymentSmoke(options: DeploymentSmokeOptions): Promise<DeploymentSmokeSummary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = requireBaseUrl(options.baseUrl);
  const accessKey = options.accessKey?.trim();
  const requestId = options.requestId?.trim() || `smoke-${crypto.randomUUID()}`;
  const traceId = options.traceId?.trim() || requestId;
  const correlationHeaders = {
    "x-request-id": requestId,
    "x-trace-id": traceId
  };
  const checks: DeploymentSmokeCheck[] = [];
  const health = await fetchJson<HealthPayload>(fetchImpl, `${baseUrl}/api/health`, {
    headers: correlationHeaders
  });
  checks.push({
    name: "health",
    status: health.response.status,
    durationMs: health.durationMs
  });

  if (!health.response.ok || health.payload.status !== "live") {
    throw new Error("Health check failed.");
  }

  const readiness = await fetchJson<ReadinessPayload>(fetchImpl, `${baseUrl}/api/ready`, {
    headers: correlationHeaders
  });
  checks.push({
    name: "readiness",
    status: readiness.response.status,
    durationMs: readiness.durationMs
  });

  if (!readiness.response.ok || readiness.payload.ok !== true || readiness.payload.status !== "ready") {
    throw new Error("Readiness check failed.");
  }

  if (accessKey) {
    const session = await fetchJson<{ ok?: boolean; error?: string }>(fetchImpl, `${baseUrl}/api/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...correlationHeaders
      },
      body: JSON.stringify({
        accessKey
      })
    });
    checks.push({
      name: "session",
      status: session.response.status,
      durationMs: session.durationMs
    });

    if (!session.response.ok || session.payload.ok !== true) {
      throw new Error("Session smoke check failed.");
    }
  }

  return {
    healthStatus: health.payload.status,
    readinessStatus: readiness.payload.status,
    sessionChecked: Boolean(accessKey),
    requestId,
    traceId,
    checks
  };
}
