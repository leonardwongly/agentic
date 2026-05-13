import { resetLocalDevState } from "./lib/local-dev-state";

const dryRun = process.argv.includes("--dry-run");
const results = await resetLocalDevState(process.env, {
  dryRun
});

console.log(
  JSON.stringify(
    {
      dryRun,
      results
    },
    null,
    2
  )
);
