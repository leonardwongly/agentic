import { afterEach, describe, expect, it, vi } from "vitest";

const createRepositoryMock = vi.fn(() => ({
  listJobs: vi.fn(async () => []),
  listProviderCredentials: vi.fn(async () => [])
}));

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
    identitySource: "x-forwarded-for",
    warnings: []
  })
}));

describe("getWebReadinessReport repository lifecycle", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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
});
