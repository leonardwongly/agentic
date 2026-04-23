type HealthPayload = {
  status?: string;
};

type ReadinessPayload = {
  ok?: boolean;
  status?: string;
};

export type DeploymentSmokeSummary = {
  healthStatus: string | undefined;
  readinessStatus: string | undefined;
  sessionChecked: boolean;
};

export type DeploymentSmokeOptions = {
  baseUrl: string;
  accessKey?: string;
  fetchImpl?: typeof fetch;
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
): Promise<{ response: Response; payload: T }> {
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

  return { response, payload };
}

export async function runDeploymentSmoke(options: DeploymentSmokeOptions): Promise<DeploymentSmokeSummary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = requireBaseUrl(options.baseUrl);
  const accessKey = options.accessKey?.trim();
  const health = await fetchJson<HealthPayload>(fetchImpl, `${baseUrl}/api/health`);

  if (!health.response.ok || health.payload.status !== "live") {
    throw new Error("Health check failed.");
  }

  const readiness = await fetchJson<ReadinessPayload>(fetchImpl, `${baseUrl}/api/ready`);

  if (!readiness.response.ok || readiness.payload.ok !== true || readiness.payload.status !== "ready") {
    throw new Error("Readiness check failed.");
  }

  if (accessKey) {
    const session = await fetchJson<{ ok?: boolean; error?: string }>(fetchImpl, `${baseUrl}/api/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        accessKey
      })
    });

    if (!session.response.ok || session.payload.ok !== true) {
      throw new Error("Session smoke check failed.");
    }
  }

  return {
    healthStatus: health.payload.status,
    readinessStatus: readiness.payload.status,
    sessionChecked: Boolean(accessKey)
  };
}
