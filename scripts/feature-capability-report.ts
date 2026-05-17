import { existsSync } from "node:fs";
import path from "node:path";
import { FEATURE_CAPABILITIES, summarizeFeatureCapabilities } from "../apps/web/lib/feature-capabilities";
import {
  collectFeatureCapabilityContractDrift,
  formatFeatureCapabilityContractDrift
} from "./lib/feature-capability-contracts";

const repoRoot = process.cwd();
const seenIds = new Set<string>();
const duplicateIds: string[] = [];
const missingContractFiles: string[] = [];
const contractDrift = collectFeatureCapabilityContractDrift(FEATURE_CAPABILITIES, repoRoot);
const summary = summarizeFeatureCapabilities();

for (const feature of FEATURE_CAPABILITIES) {
  if (seenIds.has(feature.id)) {
    duplicateIds.push(feature.id);
  }
  seenIds.add(feature.id);

  for (const contract of feature.contracts) {
    const contractPath = path.resolve(repoRoot, contract.routeFile);
    if (!existsSync(contractPath)) {
      missingContractFiles.push(`${feature.id}: ${contract.routeFile} (${contract.route})`);
    }
  }
}

console.log("Feature capability inventory");
console.log(`- features: ${summary.totalFeatures}`);
console.log(`- tracked contracts: ${summary.trackedContracts}`);
console.log(`- core operational+: ${summary.core.operationalOrBetter}/${summary.core.total}`);
console.log(`- advanced operational+: ${summary.advanced.operationalOrBetter}/${summary.advanced.total}`);

for (const feature of FEATURE_CAPABILITIES) {
  console.log(
    `- ${feature.id}: ${feature.surface} / ${feature.readiness} / ${feature.loopStage} / contracts=${feature.contracts.length}`
  );
}

if (duplicateIds.length > 0) {
  console.error("Duplicate feature ids detected:");
  for (const id of duplicateIds) {
    console.error(`- ${id}`);
  }
}

if (missingContractFiles.length > 0) {
  console.error("Missing feature contract files detected:");
  for (const contract of missingContractFiles) {
    console.error(`- ${contract}`);
  }
}

if (contractDrift.length > 0) {
  console.error("Feature contract route-method drift detected:");
  for (const drift of contractDrift) {
    console.error(`- ${formatFeatureCapabilityContractDrift(drift)}`);
  }
}

if (duplicateIds.length > 0 || missingContractFiles.length > 0 || contractDrift.length > 0) {
  process.exitCode = 1;
}
