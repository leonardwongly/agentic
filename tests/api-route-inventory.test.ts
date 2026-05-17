import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = path.join(process.cwd(), "apps", "web", "app", "api");
const inventoryPath = path.join(process.cwd(), "docs", "specs", "api-route-inventory.md");
const productSpecPath = path.join(process.cwd(), "docs", "specs", "agentic.md");
const methodOrder = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
});
