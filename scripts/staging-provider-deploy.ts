import {
  buildProviderDeployEnv,
  parseDeployTimeoutMs,
  parseProviderDeployConfig,
  runProviderDeployCommand
} from "./lib/staging-provider-deploy";

async function main() {
  const config = parseProviderDeployConfig(process.env, {
    requireConfig: true
  });
  const timeoutMs = parseDeployTimeoutMs(process.env);

  await runProviderDeployCommand(config, {
    cwd: process.cwd(),
    env: buildProviderDeployEnv(process.env),
    timeoutMs
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        command: config.command,
        args: config.args.length,
        timeoutMs
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Provider staging deploy failed.");
  process.exitCode = 1;
});
