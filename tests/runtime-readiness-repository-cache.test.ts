import { afterEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  getJobReadinessSummary: vi.fn(async () => ({
    queuedJobs: 0,
    retryingJobs: 0,
    runningJobs: 0,
    deadLetterJobs: 0,
    expiredLeases: 0,
    stalePendingJobs: 0,
    oldestPendingJobAgeMs: null
  })),
  getProviderCredentialReadinessSummary: vi.fn(async () => ({
    totalCredentials: 0,
    connectedCredentials: 0,
    degradedCredentials: 0,
    reconnectRequiredCredentials: 0,
    refreshFailedCredentials: 0,
    revokedCredentials: 0,
    expiredCredentials: 0,
    validationStaleCredentials: 0
  })),
  getLatestWorkerRuntimeHealth: vi.fn(async () => ({
    version: 1,
    runnerId: "test-worker",
    pid: 1,
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    processedCount: 0,
    lastProcessedAt: null,
    lastErrorAt: null,
    lastErrorClass: null,
    scheduler: {
      enabled: true,
      lastRunAt: null,
      lastCompletedAt: null,
      lastDecisionCount: 0,
      lastErrorAt: null,
      lastErrorClass: null
    }
  })),
  listJobs: vi.fn(async () => {
    throw new Error("readiness should use aggregate job summaries");
  }),
  listProviderCredentials: vi.fn(async () => {
    throw new Error("readiness should use aggregate provider credential summaries");
  })
}));

const createRepositoryMock = vi.fn(() => repositoryMocks);
const schemaStatusMock = vi.hoisted(() =>
  vi.fn(async () => ({
    reachable: true,
    ready: true,
    failureReason: null,
    missingMetadataTable: false,
    appliedMigrations: ["0001_init.sql"],
    pendingMigrations: [],
    driftedMigrations: [],
    requiredSchemaObjects: {
      tables: ["auth_session_rate_limits"],
      indexes: ["auth_session_rate_limits_updated_at_idx"],
      missingTables: [],
      missingIndexes: []
    },
    lastAppliedAt: "2026-06-11T00:00:00.000Z"
  }))
);
const poolMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  query: vi.fn(async () => ({ rows: [{ ok: 1 }] })),
  end: vi.fn(async () => undefined)
}));

vi.mock("@agentic/repository", () => ({
  createRepository: createRepositoryMock
}));

vi.mock("@agentic/db/schema-status", () => ({
  getDatabaseSchemaStatus: schemaStatusMock
}));

vi.mock("pg", () => ({
  Pool: vi.fn().mockImplementation(function MockPool(options) {
    poolMocks.constructor(options);
    return {
      query: poolMocks.query,
      end: poolMocks.end
    };
  })
}));

vi.mock("../apps/web/lib/auth", () => ({
  getAuthMode: () => ({
    requiresConfiguredKey: false,
    usesDevelopmentFallback: true,
    configured: true
  })
}));

vi.mock("../apps/web/lib/auth-runtime-state", () => ({
  getAuthRuntimeStateStatus: () => ({
    production: false,
    requiresSharedState: false,
    sessionStateScope: "process-local",
    unlockStateScope: "process-local",
    sharedStateConfigured: true,
    allowsProcessLocalStateException: true,
    warnings: []
  })
}));

vi.mock("../apps/web/lib/request-client-identity", () => ({
  getRequestIdentityRuntimeStatus: () => ({
    production: false,
    trustProxyHeaders: true,
    trustedClientIpHeader: "x-forwarded-for",
    identitySource: "trusted-ip",
    warnings: []
  })
}));

describe("getWebReadinessReport repository lifecycle", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    repositoryMocks.getJobReadinessSummary.mockResolvedValue({
      queuedJobs: 0,
      retryingJobs: 0,
      runningJobs: 0,
      deadLetterJobs: 0,
      expiredLeases: 0,
      stalePendingJobs: 0,
      oldestPendingJobAgeMs: null
    });
    repositoryMocks.getProviderCredentialReadinessSummary.mockResolvedValue({
      totalCredentials: 0,
      connectedCredentials: 0,
      degradedCredentials: 0,
      reconnectRequiredCredentials: 0,
      refreshFailedCredentials: 0,
      revokedCredentials: 0,
      expiredCredentials: 0,
      validationStaleCredentials: 0
    });
    repositoryMocks.getLatestWorkerRuntimeHealth.mockResolvedValue({
      version: 1,
      runnerId: "test-worker",
      pid: 1,
      status: "running",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processedCount: 0,
      lastProcessedAt: null,
      lastErrorAt: null,
      lastErrorClass: null,
      scheduler: {
        enabled: true,
        lastRunAt: null,
        lastCompletedAt: null,
        lastDecisionCount: 0,
        lastErrorAt: null,
        lastErrorClass: null
      }
    });
    schemaStatusMock.mockClear();
    poolMocks.constructor.mockClear();
    poolMocks.query.mockClear();
    poolMocks.end.mockClear();
    delete process.env.DATABASE_URL;
    delete process.env.NODE_ENV;
  });

  it("reuses a single repository instance across repeated readiness checks", { timeout: 15_000 }, async () => {
    process.env.NODE_ENV = "production";

    const { getWebReadinessReport } = await import("../apps/web/lib/runtime-readiness");

    await getWebReadinessReport();
    await getWebReadinessReport();

    expect(createRepositoryMock).toHaveBeenCalledTimes(1);
  });

  it("caches public readiness summaries within the TTL", async () => {
    process.env.NODE_ENV = "development";

    const { getPublicWebReadinessSummary, resetPublicWebReadinessCacheForTests } = await import(
      "../apps/web/lib/runtime-readiness"
    );
    resetPublicWebReadinessCacheForTests();

    const first = await getPublicWebReadinessSummary({
      now: 1_000,
      ttlMs: 5_000
    });
    const second = await getPublicWebReadinessSummary({
      now: 2_000,
      ttlMs: 5_000
    });

    expect(first).toEqual(second);
    expect(repositoryMocks.getJobReadinessSummary).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.getProviderCredentialReadinessSummary).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.listJobs).not.toHaveBeenCalled();
    expect(repositoryMocks.listProviderCredentials).not.toHaveBeenCalled();
  });

  it("keeps authenticated detailed readiness fresh while public readiness is cached", async () => {
    process.env.NODE_ENV = "development";

    const { getPublicWebReadinessSummary, getWebReadinessReport, resetPublicWebReadinessCacheForTests } = await import(
      "../apps/web/lib/runtime-readiness"
    );
    resetPublicWebReadinessCacheForTests();

    await getPublicWebReadinessSummary({
      now: 1_000,
      ttlMs: 5_000
    });
    await getPublicWebReadinessSummary({
      now: 2_000,
      ttlMs: 5_000
    });
    await getWebReadinessReport();

    expect(repositoryMocks.getJobReadinessSummary).toHaveBeenCalledTimes(2);
    expect(repositoryMocks.getProviderCredentialReadinessSummary).toHaveBeenCalledTimes(2);
  });

  it("uses a lightweight database ping for public readiness and keeps schema drift on details", async () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://agentic.example/agentic";

    const { getPublicWebReadinessSummary, getWebReadinessReport, resetPublicWebReadinessCacheForTests } = await import(
      "../apps/web/lib/runtime-readiness"
    );
    resetPublicWebReadinessCacheForTests();

    await expect(getPublicWebReadinessSummary({
      now: 1_000,
      ttlMs: 1
    })).resolves.toMatchObject({
      ok: true,
      status: "ready"
    });

    expect(poolMocks.query).toHaveBeenCalledWith("select 1");
    expect(schemaStatusMock).not.toHaveBeenCalled();

    const details = await getWebReadinessReport();

    expect(details.status).toBe("ready");
    expect(schemaStatusMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to a stale not-ready public snapshot when refresh fails", async () => {
    process.env.NODE_ENV = "production";
    repositoryMocks.getJobReadinessSummary.mockResolvedValueOnce({
      queuedJobs: 0,
      retryingJobs: 0,
      runningJobs: 0,
      deadLetterJobs: 1,
      expiredLeases: 0,
      stalePendingJobs: 0,
      oldestPendingJobAgeMs: null
    });

    const { getPublicWebReadinessSummary, resetPublicWebReadinessCacheForTests } = await import(
      "../apps/web/lib/runtime-readiness"
    );
    resetPublicWebReadinessCacheForTests();

    const first = await getPublicWebReadinessSummary({
      now: 1_000,
      ttlMs: 1
    });
    repositoryMocks.getJobReadinessSummary.mockRejectedValueOnce(new Error("database timeout"));
    const second = await getPublicWebReadinessSummary({
      now: 2_000,
      ttlMs: 1
    });

    expect(first.ok).toBe(false);
    expect(second).toEqual(first);
  });
});
