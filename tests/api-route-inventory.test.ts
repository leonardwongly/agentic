import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = path.join(process.cwd(), "apps", "web", "app", "api");
const inventoryPath = path.join(process.cwd(), "docs", "specs", "api-route-inventory.md");
const productSpecPath = path.join(process.cwd(), "docs", "specs", "agentic.md");
const methodOrder = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const governedWrapperEvidence = /\bcreateGovernedMutationRoute\b/u;
const routeSpecificRateLimitEvidence =
  /\brateLimit\s*:|\bcheckAbuseRateLimit\b|\bcheckSessionRateLimit\b|\bgetSessionUnlockRateLimitStatus\b|\brecordFailedSessionUnlockAttempt\b/u;

type RouteInventoryEntry = {
  endpoint: string;
  methods: string[];
};

type MutatingRouteGovernanceEntry = {
  endpoint: string;
  mutatingMethods: string[];
  authBoundary: string;
  ownerWorkspaceScope: string;
  idempotencyPosture: string;
  rateLimiting: string;
  staleWritePosture: string;
  auditBehavior: string;
};

type ActualRouteEntry = RouteInventoryEntry & {
  filePath: string;
  source: string;
};

type MutatingRouteImplementationClass =
  | "governed-wrapper"
  | "equivalent-manual-controls"
  | "explicit-exception";

async function listRouteFiles(dir = apiRoot): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const childFiles = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return listRouteFiles(absolutePath);
      }

      return entry.isFile() && entry.name === "route.ts" ? [absolutePath] : [];
    })
  );

  return childFiles.flat().sort((left, right) => left.localeCompare(right));
}

function routeFileToEndpoint(filePath: string): string {
  const relative = path.relative(apiRoot, filePath).replaceAll(path.sep, "/");
  const route = relative.replace(/\/route\.ts$/u, "").replaceAll(/\[([^\]]+)\]/gu, ":$1");
  return `/api/${route}`;
}

function extractMethods(source: string): string[] {
  const methods = new Set<string>();

  for (const match of source.matchAll(/^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/gmu)) {
    methods.add(match[1]!);
  }

  for (const match of source.matchAll(/^export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/gmu)) {
    methods.add(match[1]!);
  }

  return [...methods].sort((left, right) => methodOrder.indexOf(left as never) - methodOrder.indexOf(right as never));
}

function parseInventory(markdown: string): Map<string, RouteInventoryEntry> {
  const entries = new Map<string, RouteInventoryEntry>();
  const section = markdown.split("## Route Inventory")[1]?.split("\n## ")[0] ?? "";

  for (const match of section.matchAll(/^\|\s*`(\/api\/[^`]+)`\s*\|\s*`([^`]+)`\s*\|/gmu)) {
    const endpoint = match[1]!;
    const methods = match[2]!.split(",").map((method) => method.trim());
    entries.set(endpoint, { endpoint, methods });
  }

  return entries;
}

function parseMutatingGovernanceMatrix(markdown: string): Map<string, MutatingRouteGovernanceEntry> {
  const entries = new Map<string, MutatingRouteGovernanceEntry>();
  const section = markdown.split("## Mutating Route Governance Matrix")[1]?.split("\n## ")[0] ?? "";

  for (const line of section.split(/\r?\n/u)) {
    if (!line.startsWith("| `")) {
      continue;
    }

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length !== 8) {
      continue;
    }

    const [endpointCell, methodsCell, authBoundary, ownerWorkspaceScope, idempotencyPosture, rateLimiting, staleWritePosture, auditBehavior] = cells;
    const endpoint = endpointCell?.match(/^`([^`]+)`$/u)?.[1];

    if (!endpoint) {
      continue;
    }

    entries.set(endpoint, {
      endpoint,
      mutatingMethods: (methodsCell ?? "")
        .split(",")
        .map((method) => method.trim().replaceAll("`", ""))
        .filter(Boolean),
      authBoundary: authBoundary ?? "",
      ownerWorkspaceScope: ownerWorkspaceScope ?? "",
      idempotencyPosture: idempotencyPosture ?? "",
      rateLimiting: rateLimiting ?? "",
      staleWritePosture: staleWritePosture ?? "",
      auditBehavior: auditBehavior ?? ""
    });
  }

  return entries;
}

function hasAnyEvidence(source: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(source));
}

function classifyMutatingRouteImplementation(
  entry: MutatingRouteGovernanceEntry,
  source: string
): MutatingRouteImplementationClass {
  if (governedWrapperEvidence.test(source)) {
    return "governed-wrapper";
  }

  if (
    /Access key for `POST`; session for `DELETE`|Bearer sync secret|GitHub webhook signature|Signed share token|Slack signature|Telegram secret token/iu.test(
      entry.authBoundary
    )
  ) {
    return "explicit-exception";
  }

  return "equivalent-manual-controls";
}

function hasAuthBoundaryEvidence(entry: MutatingRouteGovernanceEntry, source: string): boolean {
  if (/Session or access key/iu.test(entry.authBoundary)) {
    return hasAnyEvidence(source, [governedWrapperEvidence, /\brequireApiSession\b/u]);
  }

  if (/Access key for `POST`; session for `DELETE`/iu.test(entry.authBoundary)) {
    return hasAnyEvidence(source, [/\bverifyAccessKey\b/u]) && hasAnyEvidence(source, [/\brevokeSessionToken\b/u]);
  }

  if (/Bearer sync secret/iu.test(entry.authBoundary)) {
    return hasAnyEvidence(source, [/\bassertSyncAuthorized\b/u]) && hasAnyEvidence(source, [/\brequireSyncSecret\b/u]);
  }

  if (/GitHub webhook signature/iu.test(entry.authBoundary)) {
    return (
      hasAnyEvidence(source, [/\bverifyGitHubSignature\b/u]) &&
      hasAnyEvidence(source, [/\brequireWebhookSecret\b/u]) &&
      hasAnyEvidence(source, [/\breadBoundedRequestText\b/u])
    );
  }

  if (/Signed share token/iu.test(entry.authBoundary)) {
    return hasAnyEvidence(source, [/\binspectGoalShareToken\b/u, /\bfingerprintGoalShareToken\b/u]);
  }

  if (/Slack signature/iu.test(entry.authBoundary)) {
    return hasAnyEvidence(source, [/\bverifySlackSignature\b/u]);
  }

  if (/Telegram secret token/iu.test(entry.authBoundary)) {
    return hasAnyEvidence(source, [/\bverifyTelegramWebhookSecret\b/u]);
  }

  return false;
}

function claimsConcreteRateLimit(rateLimiting: string): boolean {
  if (/No route-specific rate limit yet|Not applicable/iu.test(rateLimiting)) {
    return false;
  }

  return /\b(?:rate limit|abuse limit|abuse guard|throttl)/iu.test(rateLimiting);
}

function claimsConcreteIdempotency(idempotencyPosture: string): boolean {
  return /`x-idempotency-key`|idempotency key|dedupe|dedup|delivery|token fingerprint|canonicalized|operation id|source job id|update id/iu.test(
    idempotencyPosture
  );
}

function hasIdempotencyEvidence(source: string): boolean {
  return hasAnyEvidence(source, [
    /\bidempotency\s*:/u,
    /\bidempotencyKey\b/u,
    /\bparseIdempotencyKey\b/u,
    /\bparseOrDeriveIdempotencyKey\b/u,
    /\bdeliveryId\b/u,
    /\baction_id\b/u,
    /\bactionId\b/u,
    /\bupdate_id\b/u,
    /\bfingerprintGoalShareToken\b/u,
    /\bcanonicalize/u,
    /\bcanonical[A-Za-z]+/u,
    /\bcreateLocalNote\b/u,
    /\bupdateLocalNote\b/u,
    /\blistPrivacyOperations\b/u,
    /\breused\b/u,
    /\bdedupe/iu
  ]);
}

function claimsStaleWriteImplementation(staleWritePosture: string): boolean {
  return !/Not applicable|Create-only|Queue append only|append\/queue oriented|Append\/update|Last-write wins|read\/refresh payload assembly|outbound notification send/iu.test(
    staleWritePosture
  );
}

function hasStaleWriteEvidence(source: string): boolean {
  return hasAnyEvidence(source, [
    /\brequireUpdatedAtPrecondition\b/u,
    /\bassertJobRecoveryAllowed\b/u,
    /\bcurrent\b[\s\S]{0,160}\bstate\b/iu,
    /\bexisting\b[\s\S]{0,160}\bstatus\b/iu,
    /\bgetGoalBundleForUser\b/u,
    /\bgetWorkspaceGovernance\b/u,
    /\bgetGoalShareByTokenFingerprint\b/u,
    /\bgetTelegramApprovalAction\b/u,
    /\bverifySlackApprovalToken\b/u,
    /\bgetDashboardData\b/u
  ]);
}

function hasScopeEvidence(entry: MutatingRouteGovernanceEntry, source: string): boolean {
  if (/Not applicable/iu.test(entry.ownerWorkspaceScope)) {
    return true;
  }

  if (/Repository allowlist/iu.test(entry.ownerWorkspaceScope)) {
    return hasAnyEvidence(source, [/\ballowlist/iu, /\ballowedRepositories\b/u]);
  }

  if (/Slack team|Slack channel|Telegram chat/iu.test(entry.ownerWorkspaceScope)) {
    return hasAnyEvidence(source, [/\bresolveSlackActorUserId\b/u, /\bresolveTelegramActorUserId\b/u]);
  }

  if (/Token scope|share token/iu.test(entry.ownerWorkspaceScope)) {
    return hasAnyEvidence(source, [/\binspectGoalShareToken\b/u, /\bgetGoalShareByTokenFingerprint\b/u]);
  }

  if (/browser\/session/iu.test(entry.ownerWorkspaceScope)) {
    return hasAnyEvidence(source, [/\bAGENTIC_SESSION_COOKIE\b/u, /\bcreateSessionCookie\b/u]);
  }

  return hasAnyEvidence(source, [
    /\bprincipal\.userId\b/u,
    /\buserId\b/u,
    /\bworkspaceId\b/u,
    /\bactiveWorkspace\b/u,
    /\bownerUserId\b/u,
    /\bactorUserId\b/u,
    /\bgetGoalBundleForUser\b/u,
    /\brequireOwnedWorkspace\b/u
  ]);
}

function claimsAuditOrSideEffect(auditBehavior: string): boolean {
  return !/No external side effect|No durable mutation/iu.test(auditBehavior);
}

function hasAuditEvidence(source: string): boolean {
  return hasAnyEvidence(source, [
    /\bactorContext\b/u,
    /\benqueue[A-Z][A-Za-z]+\b/u,
    /\bsave[A-Z][A-Za-z]+\b/u,
    /\brecord[A-Z][A-Za-z]+\b/u,
    /\brecordCounter\b/u,
    /\blogInfo\b/u,
    /\blogError\b/u,
    /\bcreate[A-Za-z]+Log\b/u,
    /\baudit/iu,
    /\brepository\.[A-Za-z]+/u
  ]);
}

describe("API route inventory", () => {
  async function listActualRouteEntries(): Promise<ActualRouteEntry[]> {
    const routeFiles = await listRouteFiles();

    return Promise.all(
      routeFiles.map(async (filePath) => ({
        endpoint: routeFileToEndpoint(filePath),
        methods: extractMethods(await readFile(filePath, "utf8")),
        filePath,
        source: await readFile(filePath, "utf8")
      }))
    );
  }

  it("documents every app route handler with exact HTTP methods", async () => {
    const inventory = parseInventory(await readFile(inventoryPath, "utf8"));
    const actualEntries = await listActualRouteEntries();

    expect(actualEntries.length).toBeGreaterThan(0);

    for (const actual of actualEntries) {
      expect(inventory.get(actual.endpoint)?.methods, actual.endpoint).toEqual(actual.methods);
    }

    const actualEndpointSet = new Set(actualEntries.map((entry) => entry.endpoint));
    const staleEndpoints = [...inventory.keys()].filter((endpoint) => !actualEndpointSet.has(endpoint));
    expect(staleEndpoints).toEqual([]);
  });

  it("links the product spec to the canonical inventory", async () => {
    const productSpec = await readFile(productSpecPath, "utf8");
    expect(productSpec).toContain("docs/specs/api-route-inventory.md");
  });

  it("declares governance posture for every mutating route", async () => {
    const inventoryMarkdown = await readFile(inventoryPath, "utf8");
    const inventory = parseInventory(inventoryMarkdown);
    const governanceMatrix = parseMutatingGovernanceMatrix(inventoryMarkdown);
    const mutatingEntries = [...inventory.values()]
      .map((entry) => ({
        ...entry,
        mutatingMethods: entry.methods.filter((method) => mutatingMethods.has(method))
      }))
      .filter((entry) => entry.mutatingMethods.length > 0);

    expect(mutatingEntries.length).toBeGreaterThan(0);

    for (const entry of mutatingEntries) {
      const governance = governanceMatrix.get(entry.endpoint);
      expect(governance, entry.endpoint).toBeDefined();
      expect(governance?.mutatingMethods, entry.endpoint).toEqual(entry.mutatingMethods);

      for (const [field, value] of Object.entries(governance ?? {})) {
        if (field === "endpoint" || field === "mutatingMethods") {
          continue;
        }

        expect(value, `${entry.endpoint} ${field}`).not.toMatch(/^(?:|tbd|todo|unknown)$/iu);
      }
    }

    const mutatingEndpointSet = new Set(mutatingEntries.map((entry) => entry.endpoint));
    const staleGovernanceEntries = [...governanceMatrix.keys()].filter((endpoint) => !mutatingEndpointSet.has(endpoint));
    expect(staleGovernanceEntries).toEqual([]);
  });

  it("requires implementation evidence for declared concrete If-Match stale-write protection", async () => {
    const inventoryMarkdown = await readFile(inventoryPath, "utf8");
    const governanceMatrix = parseMutatingGovernanceMatrix(inventoryMarkdown);
    const actualEntriesByEndpoint = new Map((await listActualRouteEntries()).map((entry) => [entry.endpoint, entry]));
    const ifMatchProtectedEntries = [...governanceMatrix.values()].filter((entry) =>
      /requires concrete `?If-Match`?/iu.test(entry.staleWritePosture)
    );

    expect(ifMatchProtectedEntries.length).toBeGreaterThan(0);

    for (const entry of ifMatchProtectedEntries) {
      const route = actualEntriesByEndpoint.get(entry.endpoint);

      expect(route?.source, `${entry.endpoint} route source`).toContain("requireUpdatedAtPrecondition");
    }
  });

  it("classifies every mutating route by implementation evidence", async () => {
    const inventoryMarkdown = await readFile(inventoryPath, "utf8");
    const governanceMatrix = parseMutatingGovernanceMatrix(inventoryMarkdown);
    const actualEntriesByEndpoint = new Map((await listActualRouteEntries()).map((entry) => [entry.endpoint, entry]));
    const classifiedRoutes = new Map<string, MutatingRouteImplementationClass>();

    for (const entry of governanceMatrix.values()) {
      const route = actualEntriesByEndpoint.get(entry.endpoint);
      expect(route, entry.endpoint).toBeDefined();

      const implementationClass = classifyMutatingRouteImplementation(entry, route?.source ?? "");
      classifiedRoutes.set(entry.endpoint, implementationClass);
      expect(["governed-wrapper", "equivalent-manual-controls", "explicit-exception"], entry.endpoint).toContain(
        implementationClass
      );

      if (implementationClass === "governed-wrapper") {
        expect(route?.source, entry.endpoint).toContain("createGovernedMutationRoute");
      }

      if (implementationClass === "equivalent-manual-controls") {
        expect(route?.source, `${entry.endpoint} should not be wrapper-classified`).not.toContain(
          "createGovernedMutationRoute"
        );
        expect(hasAuthBoundaryEvidence(entry, route?.source ?? ""), `${entry.endpoint} manual auth boundary`).toBe(true);
      }

      if (implementationClass === "explicit-exception") {
        expect(route?.source, `${entry.endpoint} should not be wrapper-classified`).not.toContain(
          "createGovernedMutationRoute"
        );
        expect(hasAuthBoundaryEvidence(entry, route?.source ?? ""), `${entry.endpoint} exception auth boundary`).toBe(
          true
        );
      }
    }

    expect(classifiedRoutes.size).toBe(governanceMatrix.size);
    expect([...classifiedRoutes.values()]).toContain("governed-wrapper");
    expect([...classifiedRoutes.values()]).toContain("equivalent-manual-controls");
    expect([...classifiedRoutes.values()]).toContain("explicit-exception");
  });

  it("requires source evidence for documented mutating route controls", async () => {
    const inventoryMarkdown = await readFile(inventoryPath, "utf8");
    const governanceMatrix = parseMutatingGovernanceMatrix(inventoryMarkdown);
    const actualEntriesByEndpoint = new Map((await listActualRouteEntries()).map((entry) => [entry.endpoint, entry]));

    for (const entry of governanceMatrix.values()) {
      const route = actualEntriesByEndpoint.get(entry.endpoint);
      const source = route?.source ?? "";

      expect(hasAuthBoundaryEvidence(entry, source), `${entry.endpoint} auth boundary`).toBe(true);
      expect(hasScopeEvidence(entry, source), `${entry.endpoint} owner/workspace scope`).toBe(true);

      if (claimsConcreteRateLimit(entry.rateLimiting)) {
        expect(routeSpecificRateLimitEvidence.test(source), `${entry.endpoint} rate limiting`).toBe(true);
      }

      if (claimsConcreteIdempotency(entry.idempotencyPosture)) {
        expect(hasIdempotencyEvidence(source), `${entry.endpoint} idempotency`).toBe(true);
      }

      if (claimsStaleWriteImplementation(entry.staleWritePosture)) {
        expect(hasStaleWriteEvidence(source), `${entry.endpoint} stale-write posture`).toBe(true);
      }

      if (claimsAuditOrSideEffect(entry.auditBehavior)) {
        expect(hasAuditEvidence(source), `${entry.endpoint} audit/side-effect behavior`).toBe(true);
      }
    }
  });
});
