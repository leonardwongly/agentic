import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  evaluateRolloutGateManifest,
  readTelemetryExportBatches,
  type RolloutGateManifest
} from "../packages/observability/src/rollout-gates";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseArgs(argv: string[]) {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (!current?.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = current.slice(2).split("=", 2);

    if (inlineValue !== undefined) {
      values.set(key, inlineValue);
      continue;
    }

    const next = argv[index + 1];

    if (next && !next.startsWith("--")) {
      values.set(key, next);
      index += 1;
      continue;
    }

    values.set(key, "true");
  }

  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const retentionDir =
    args.get("dir") ??
    process.env.AGENTIC_TELEMETRY_RETENTION_DIR ??
    path.join(process.cwd(), ".agentic", "telemetry");
  const manifestPath =
    args.get("manifest") ?? path.join(process.cwd(), "config", "observability", "alerts.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RolloutGateManifest;
  const batches = await readTelemetryExportBatches(retentionDir);
  const evaluation = evaluateRolloutGateManifest(manifest, batches);

  assert(evaluation.results.length > 0, "Rollout gate manifest does not contain any alerts.");

  console.log(
    JSON.stringify(
      {
        ok: evaluation.passed,
        retentionDir,
        manifestPath,
        ...evaluation
      },
      null,
      2
    )
  );

  if (!evaluation.passed) {
    process.exitCode = 1;
  }
}

await main();
