import {
  findMissingComplianceRegistryReferences,
  loadComplianceControlRegistry
} from "./collect-compliance-evidence";

function parseArgs(argv: string[]) {
  let registryPath = "config/compliance/controls.json";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--registry":
        if (!next) {
          throw new Error("Missing value for --registry.");
        }
        registryPath = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { registryPath };
}

function main() {
  const { registryPath } = parseArgs(process.argv.slice(2));
  const registry = loadComplianceControlRegistry(registryPath);
  const missingReferences = findMissingComplianceRegistryReferences(registry);

  if (missingReferences.length > 0) {
    const details = missingReferences
      .map((reference) => {
        const checkLabel = reference.checkId ? ` ${reference.checkId}` : "";
        return `- ${reference.controlId} ${reference.kind}${checkLabel}: ${reference.path}`;
      })
      .join("\n");

    throw new Error(`Compliance control registry contains missing file references:\n${details}`);
  }

  console.log(`Validated ${registry.controls.length} compliance control registry entries.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
