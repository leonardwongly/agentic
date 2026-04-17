type HealthPayload = {
  status?: string;
};

type ReadinessPayload = {
  ok?: boolean;
  status?: string;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be configured.`);
  }

  return value;
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<{ response: Response; payload: T }> {
  const response = await fetch(input, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {})
    }
  });

  const payload = (await response.json()) as T;
  return { response, payload };
}

async function main() {
  const baseUrl = requireEnv("AGENTIC_SMOKE_BASE_URL").replace(/\/+$/, "");
  const accessKey = process.env.AGENTIC_SMOKE_ACCESS_KEY?.trim();
  const health = await fetchJson<HealthPayload>(`${baseUrl}/api/health`);

  if (!health.response.ok || health.payload.status !== "live") {
    throw new Error("Health check failed.");
  }

  const readiness = await fetchJson<ReadinessPayload>(`${baseUrl}/api/ready`);

  if (!readiness.response.ok || readiness.payload.ok !== true || readiness.payload.status !== "ready") {
    throw new Error("Readiness check failed.");
  }

  if (accessKey) {
    const session = await fetchJson<{ ok?: boolean; error?: string }>(`${baseUrl}/api/session`, {
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

  console.log(
    JSON.stringify(
      {
        ok: true,
        healthStatus: health.payload.status,
        readinessStatus: readiness.payload.status,
        sessionChecked: Boolean(accessKey)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Deployment smoke test failed.");
  process.exitCode = 1;
});

