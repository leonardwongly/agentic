import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface PackageJson {
  name: string;
  version?: string;
  dependencies?: Record<string, string>;
}

interface PackageLockDependency {
  version?: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  dev?: boolean;
  name?: string;
}

interface PackageLockFile {
  name?: string;
  lockfileVersion: number;
  packages?: Record<string, PackageLockDependency>;
}

interface SpdxExternalRef {
  referenceCategory: "PACKAGE-MANAGER";
  referenceType: "purl";
  referenceLocator: string;
}

interface SpdxPackage {
  SPDXID: string;
  name: string;
  versionInfo: string;
  downloadLocation: string;
  filesAnalyzed: false;
  supplier: string;
  externalRefs?: SpdxExternalRef[];
  checksums?: Array<{
    algorithm: "SHA512";
    checksumValue: string;
  }>;
}

interface SpdxRelationship {
  spdxElementId: string;
  relationshipType: string;
  relatedSpdxElement: string;
}

export interface SpdxDocument {
  spdxVersion: "SPDX-2.3";
  dataLicense: "CC0-1.0";
  SPDXID: "SPDXRef-DOCUMENT";
  name: string;
  documentNamespace: string;
  creationInfo: {
    created: string;
    creators: string[];
  };
  packages: SpdxPackage[];
  relationships: SpdxRelationship[];
}

function parseArgs(argv: string[]) {
  let outputPath = "artifacts/security/agentic-sbom.spdx.json";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== "--output") {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const next = argv[index + 1];
    if (!next) {
      throw new Error("Missing value for --output.");
    }

    outputPath = next;
    index += 1;
  }

  return { outputPath };
}

function slugify(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/gu, "-");
}

function packagePathToName(packagePath: string, dependency: PackageLockDependency): string {
  if (dependency.name) {
    return dependency.name;
  }

  const segments = packagePath.split("/");
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  if (nodeModulesIndex >= 0) {
    return segments.slice(nodeModulesIndex + 1).join("/");
  }

  return packagePath || "root";
}

function toPackageUrl(name: string, version: string): string {
  if (name.startsWith("@")) {
    const [scope, packageName] = name.split("/");
    return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`;
  }

  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

export function buildSpdxDocument(lockFile: PackageLockFile, packageJson: PackageJson, now: Date = new Date()): SpdxDocument {
  const rootName = packageJson.name || lockFile.name || "agentic";
  const rootVersion = packageJson.version || "0.0.0";
  const rootRef = "SPDXRef-Package-root";
  const packages: SpdxPackage[] = [
    {
      SPDXID: rootRef,
      name: rootName,
      versionInfo: rootVersion,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      supplier: "NOASSERTION",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: toPackageUrl(rootName, rootVersion)
        }
      ]
    }
  ];
  const relationships: SpdxRelationship[] = [
    {
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: rootRef
    }
  ];

  for (const [packagePath, dependency] of Object.entries(lockFile.packages ?? {})) {
    if (!packagePath || dependency.dev) {
      continue;
    }

    const name = packagePathToName(packagePath, dependency);
    const version = dependency.version ?? "0.0.0";
    const packageRef = `SPDXRef-Package-${slugify(packagePath)}`;

    packages.push({
      SPDXID: packageRef,
      name,
      versionInfo: version,
      downloadLocation: dependency.resolved ?? "NOASSERTION",
      filesAnalyzed: false,
      supplier: "NOASSERTION",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: toPackageUrl(name, version)
        }
      ],
      checksums: dependency.integrity
        ? [
            {
              algorithm: "SHA512",
              checksumValue: dependency.integrity.replace(/^sha512-/u, "")
            }
          ]
        : undefined
    });

    relationships.push({
      spdxElementId: rootRef,
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: packageRef
    });
  }

  packages.sort((left, right) => left.SPDXID.localeCompare(right.SPDXID));
  relationships.sort((left, right) => {
    const pair = `${left.spdxElementId}:${left.relatedSpdxElement}`;
    const otherPair = `${right.spdxElementId}:${right.relatedSpdxElement}`;
    return pair.localeCompare(otherPair);
  });

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${rootName} runtime sbom`,
    documentNamespace: `https://agentic.local/sbom/${slugify(rootName)}/${now.toISOString()}`,
    creationInfo: {
      created: now.toISOString(),
      creators: ["Tool: agentic/scripts/generate-sbom.ts"]
    },
    packages,
    relationships
  };
}

function main() {
  const { outputPath } = parseArgs(process.argv.slice(2));
  const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as PackageJson;
  const lockFile = JSON.parse(readFileSync(path.resolve(process.cwd(), "package-lock.json"), "utf8")) as PackageLockFile;
  const document = buildSpdxDocument(lockFile, packageJson);
  const resolvedOutputPath = path.resolve(process.cwd(), outputPath);

  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.log(`Wrote SBOM to ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
