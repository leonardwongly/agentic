import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = path.join(process.cwd(), "apps", "web", "app", "api");
const inventoryPath = path.join(process.cwd(), "docs", "specs", "api-route-inventory.md");
const productSpecPath = path.join(process.cwd(), "docs", "specs", "agentic.md");
const methodOrder = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type RouteInventoryEntry = {
  endpoint: string;
  methods: string[];
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

  for (const match of markdown.matchAll(/^\|\s*`(\/api\/[^`]+)`\s*\|\s*`([^`]+)`\s*\|/gmu)) {
    const endpoint = match[1]!;
    const methods = match[2]!.split(",").map((method) => method.trim());
    entries.set(endpoint, { endpoint, methods });
  }

  return entries;
}

describe("API route inventory", () => {
  it("documents every app route handler with exact HTTP methods", async () => {
    const routeFiles = await listRouteFiles();
    const inventory = parseInventory(await readFile(inventoryPath, "utf8"));
    const actualEntries = await Promise.all(
      routeFiles.map(async (filePath) => ({
        endpoint: routeFileToEndpoint(filePath),
        methods: extractMethods(await readFile(filePath, "utf8"))
      }))
    );

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
});
