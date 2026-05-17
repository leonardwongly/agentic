import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const FEATURE_CAPABILITY_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type FeatureCapabilityHttpMethod = (typeof FEATURE_CAPABILITY_HTTP_METHODS)[number];

export type FeatureCapabilityContractLike = {
  route: string;
  routeFile: string;
  methods: readonly FeatureCapabilityHttpMethod[];
};

export type FeatureCapabilityLike = {
  id: string;
  contracts: readonly FeatureCapabilityContractLike[];
};

export type FeatureCapabilityContractDrift = {
  featureId: string;
  route: string;
  routeFile: string;
  declaredMethods: FeatureCapabilityHttpMethod[];
  actualMethods: FeatureCapabilityHttpMethod[];
  missingDeclaredMethods: FeatureCapabilityHttpMethod[];
  staleDeclaredMethods: FeatureCapabilityHttpMethod[];
};

function sortMethods(methods: Iterable<string>): FeatureCapabilityHttpMethod[] {
  const methodSet = new Set(methods);
  return FEATURE_CAPABILITY_HTTP_METHODS.filter((method) => methodSet.has(method));
}

export function extractRouteHandlerMethods(source: string): FeatureCapabilityHttpMethod[] {
  const methods = new Set<FeatureCapabilityHttpMethod>();
  const exportPatterns = [
    /^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/gmu,
    /^export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/gmu
  ];

  for (const pattern of exportPatterns) {
    for (const match of source.matchAll(pattern)) {
      methods.add(match[1] as FeatureCapabilityHttpMethod);
    }
  }

  return sortMethods(methods);
}

export function collectFeatureCapabilityContractDrift(
  features: readonly FeatureCapabilityLike[],
  repoRoot = process.cwd()
): FeatureCapabilityContractDrift[] {
  const drift: FeatureCapabilityContractDrift[] = [];

  for (const feature of features) {
    for (const contract of feature.contracts) {
      const absoluteRouteFile = path.resolve(repoRoot, contract.routeFile);
      const actualMethods = existsSync(absoluteRouteFile)
        ? extractRouteHandlerMethods(readFileSync(absoluteRouteFile, "utf8"))
        : [];
      const declaredMethods = sortMethods(contract.methods);
      const actualMethodSet = new Set(actualMethods);
      const declaredMethodSet = new Set(declaredMethods);
      const missingDeclaredMethods = actualMethods.filter((method) => !declaredMethodSet.has(method));
      const staleDeclaredMethods = declaredMethods.filter((method) => !actualMethodSet.has(method));

      if (missingDeclaredMethods.length > 0 || staleDeclaredMethods.length > 0) {
        drift.push({
          featureId: feature.id,
          route: contract.route,
          routeFile: contract.routeFile,
          declaredMethods,
          actualMethods,
          missingDeclaredMethods,
          staleDeclaredMethods
        });
      }
    }
  }

  return drift;
}

export function formatFeatureCapabilityContractDrift(drift: FeatureCapabilityContractDrift): string {
  const missing =
    drift.missingDeclaredMethods.length > 0
      ? ` missing actual method(s): ${drift.missingDeclaredMethods.join(",")}`
      : "";
  const stale =
    drift.staleDeclaredMethods.length > 0 ? ` stale declared method(s): ${drift.staleDeclaredMethods.join(",")}` : "";

  return `${drift.featureId}: ${drift.route} (${drift.routeFile}) declared=${drift.declaredMethods.join(",") || "none"} actual=${drift.actualMethods.join(",") || "none"}${missing}${stale}`;
}
