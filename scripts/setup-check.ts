import { evaluateSetupEnvironment } from "./lib/setup-check";

const report = evaluateSetupEnvironment(process.env);

console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
  process.exitCode = 1;
}
