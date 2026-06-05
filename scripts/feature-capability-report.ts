import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildFeatureCapabilityMaturityBoard,
  FEATURE_CAPABILITIES,
  summarizeFeatureCapabilities,
  type FeatureCapabilityMaturityBlocker
} from "../apps/web/lib/feature-capabilities";
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
const maturityBoard = buildFeatureCapabilityMaturityBoard();

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

function formatBlocker(blocker: FeatureCapabilityMaturityBlocker): string {
  if (blocker.type === "issue") {
    return `#${blocker.issue} ${blocker.title}`;
  }

  return `none: ${blocker.reason}`;
}

console.log("");
console.log("Capability maturity board");
console.log(`- preview features: ${maturityBoard.previewFeatures}`);
console.log(`- production claims: ${maturityBoard.productionClaims}`);
console.log(`- release blocked: ${maturityBoard.releaseBlocked ? "yes" : "no"}`);

for (const lane of maturityBoard.lanes) {
  console.log(
    `- lane ${lane.ownerLane}: total=${lane.total}, preview=${lane.preview}, operational+=${lane.operationalOrBetter}, blocked=${lane.releaseBlocked}`
  );
}

for (const item of maturityBoard.items) {
  console.log(
    [
      `- ${item.id}`,
      `${item.readiness}->${item.targetReadiness}`,
      `owner=${item.ownerLane}`,
      `blocker=${formatBlocker(item.blocker)}`,
      `next="${item.nextValidationGate}"`,
      `gates=${item.requiredGates.length}`,
      `evidence=${item.lastValidationEvidence.length}`,
      `productionEvidence=${item.productionEvidence.length}`,
      `contracts=${item.contracts}`
    ].join(" | ")
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

if (maturityBoard.issues.length > 0) {
  console.error("Feature maturity issues detected:");
  for (const issue of maturityBoard.issues) {
    console.error(`- ${issue.featureId}: ${issue.message}`);
  }
}

if (duplicateIds.length > 0 || missingContractFiles.length > 0 || contractDrift.length > 0 || maturityBoard.issues.length > 0) {
  process.exitCode = 1;
}
