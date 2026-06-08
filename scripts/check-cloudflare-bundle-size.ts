import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// F5 (#982): guard the Cloudflare Worker upload size against Workers' gzipped
// script-size limits (3 MiB free, 10 MiB paid). Run `npm run cf:build -w
// @agentic/web` first; this parses `wrangler deploy --dry-run`. Note the parsed
// "gzip" is wrangler's Total Upload (worker script + static assets), so it is a
// conservative upper bound for the script-only limit.

const REPO_ROOT = process.cwd();
const WEB_DIR = path.join(REPO_ROOT, "apps", "web");
const WRANGLER_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "wrangler");
const OPEN_NEXT_DIR = path.join(WEB_DIR, ".open-next");

// Default to the paid-plan limit; override with CF_WORKER_GZIP_LIMIT_MIB=3 for free.
const LIMIT_MIB = Number.parseFloat(process.env.CF_WORKER_GZIP_LIMIT_MIB ?? "10");

function fail(message: string): never {
  console.error(`\u2716 cloudflare bundle-size check: ${message}`);
  process.exit(1);
}

function main(): void {
  if (!existsSync(OPEN_NEXT_DIR)) {
    fail("apps/web/.open-next not found. Run `npm run cf:build -w @agentic/web` first.");
  }

  let output = "";
  try {
    output = execFileSync(WRANGLER_BIN, ["deploy", "--dry-run"], {
      cwd: WEB_DIR,
      encoding: "utf8",
      env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" }
    });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    output = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
    if (!/gzip:/i.test(output)) {
      fail(`wrangler dry-run failed:\n${output}`);
    }
  }

  const match = output.match(/gzip:\s*([\d.]+)\s*KiB/i);
  if (!match) {
    fail(`could not parse gzip size from wrangler output:\n${output}`);
  }

  const gzipMib = Number.parseFloat(match[1]) / 1024;
  const rounded = gzipMib.toFixed(2);

  if (gzipMib > LIMIT_MIB) {
    fail(
      `worker upload is ${rounded} MiB gzipped, over the ${LIMIT_MIB} MiB limit. ` +
        "Reduce bundle size (OpenNext multi-worker split / dependency reduction) before deploying — " +
        "see docs/deployment/cloudflare-workers.md."
    );
  }

  console.log(`\u2713 cloudflare bundle-size check: worker upload is ${rounded} MiB gzipped (limit ${LIMIT_MIB} MiB).`);
}

main();
