import {
  DEFAULT_RELEASE_CLOSEOUT_EVIDENCE_PATH,
  readReleaseCloseoutEvidenceManifest,
  renderReleaseCloseoutEvidenceReport,
  validateReleaseCloseoutEvidenceManifest
} from "./lib/release-closeout-evidence";

function readArgValue(name: string) {
  const prefix = `${name}=`;
  const inline = process.argv.find(arg => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  if (index >= 0) {
    return process.argv[index + 1];
  }

  return undefined;
}

const manifestPath = readArgValue("--manifest") ?? DEFAULT_RELEASE_CLOSEOUT_EVIDENCE_PATH;
const manifest = readReleaseCloseoutEvidenceManifest(manifestPath);
const report = validateReleaseCloseoutEvidenceManifest(manifest, { cwd: process.cwd() });

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(renderReleaseCloseoutEvidenceReport(report));
}

if (!report.ok) {
  process.exitCode = 1;
}
