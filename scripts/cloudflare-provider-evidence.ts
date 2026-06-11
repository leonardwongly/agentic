import { buildCloudflareProviderEvidence } from "./lib/cloudflare-provider-evidence";

const HELP_TEXT = `Usage: npm run cloudflare:provider-evidence -- [--json]

Emits non-secret Cloudflare Workers provider evidence for AGENTIC_DEPLOYMENT_PROVIDER_EVIDENCE_JSON.

The output is derived from apps/web/wrangler.jsonc and contains no secret values.
Use it after the Worker config is set for the intended production target.
`;

function main(): void {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP_TEXT);
    return;
  }

  const evidence = buildCloudflareProviderEvidence({
    repoRoot: process.cwd(),
    environment: process.env.AGENTIC_CLOUDFLARE_EVIDENCE_ENVIRONMENT,
    rollbackAuthority: process.env.AGENTIC_CLOUDFLARE_ROLLBACK_AUTHORITY
  });

  console.log(JSON.stringify(evidence, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Failed to build Cloudflare provider evidence.");
  process.exitCode = 1;
}
