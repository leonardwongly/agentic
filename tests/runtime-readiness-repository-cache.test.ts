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
  listJobs: vi.fn(async () => {
    throw new Error("readiness should use aggregate job summaries");
  }),
  listProviderCredentials: vi.fn(async () => {
    throw new Error("readiness should use aggregate provider credential summaries");
  })
}));

const createRepositoryMock = vi.fn(() => repositoryMocks);

vi.mock("@agentic/repository", () => ({
  createRepository: createRepositoryMock
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
    delete process.env.DATABASE_URL;
    delete process.env.NODE_ENV;
  });

  it("reuses a single repository instance across repeated readiness checks", async () => {
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
