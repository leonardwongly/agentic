import { evaluateFirstRunReadiness } from "./lib/engineering-hygiene";

const report = evaluateFirstRunReadiness({
  cwd: process.cwd(),
  nodeVersion: process.version,
  npmUserAgent: process.env.npm_config_user_agent,
  env: process.env
});

for (const check of report.checks) {
  const marker = check.status.toUpperCase().padEnd(4);
  console.log(`${marker} ${check.id}: ${check.message}`);
}

if (!report.ok) {
  process.exitCode = 1;
}
