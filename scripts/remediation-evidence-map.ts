import {
  DEFAULT_REMEDIATION_EVIDENCE_MAP_PATH,
  readRemediationEvidenceMap,
  renderRemediationEvidenceMapReport,
  validateRemediationEvidenceMap
} from "./lib/remediation-evidence-map";

function readArgValue(name: string) {
  const inline = process.argv.find(arg => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const mapPath = readArgValue("--map") ?? DEFAULT_REMEDIATION_EVIDENCE_MAP_PATH;
const map = readRemediationEvidenceMap(mapPath);
const report = validateRemediationEvidenceMap(map, { cwd: process.cwd() });

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(renderRemediationEvidenceMapReport(report));
}

if (!report.ok) {
  process.exitCode = 1;
}
