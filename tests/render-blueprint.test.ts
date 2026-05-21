import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const blueprintPath = join(process.cwd(), "deploy", "render", "render.yaml");
const deploymentRunbookPath = join(process.cwd(), "docs", "runbooks", "deployment.md");

function readBlueprint(): string {
  return readFileSync(blueprintPath, "utf8");
}

function readDeploymentRunbook(): string {
  return readFileSync(deploymentRunbookPath, "utf8");
}

describe("Render Blueprint deployment target", () => {
  it("prepares the full Node/container topology without being the default root Blueprint", () => {
    const blueprint = readBlueprint();

    expect(blueprint).toContain("This file intentionally lives outside the repository root");
    expect(blueprint).toContain("name: agentic-web");
    expect(blueprint).toContain("type: web");
    expect(blueprint).toContain("name: agentic-worker");
    expect(blueprint).toContain("type: worker");
    expect(blueprint).toContain("name: agentic-postgres");
    expect(blueprint).toContain("runtime: docker");
    expect(blueprint).toContain("dockerfilePath: ./Dockerfile");
    expect(blueprint).toContain("healthCheckPath: /api/health");
  });

  it("runs web and worker with the existing production startup contracts", () => {
    const blueprint = readBlueprint();

    expect(blueprint).toContain("dockerCommand: npm run start:web:prod -- --hostname 0.0.0.0 --port $PORT");
    expect(blueprint).toContain("dockerCommand: npm run start:worker:prod");
    expect(blueprint).toContain("AGENTIC_REQUIRE_SHARED_AUTH_STATE");
    expect(blueprint).toContain('value: "true"');
  });

  it("keeps the first provider sync manually controlled", () => {
    const blueprint = readBlueprint();

    expect(blueprint.match(/autoDeployTrigger: off/gu)).toHaveLength(2);
  });

  it("runs additive migrations once before the web service starts", () => {
    const blueprint = readBlueprint();
    const migrationCommand = "preDeployCommand: npm run db:migrate";
    const workerSection = blueprint.slice(blueprint.indexOf("name: agentic-worker"));

    expect(blueprint.match(new RegExp(migrationCommand, "gu"))).toHaveLength(1);
    expect(workerSection).not.toContain(migrationCommand);
  });

  it("keeps secret values out of the checked-in provider template", () => {
    const blueprint = readBlueprint();
    const secretKeys = [
      "AGENTIC_ACCESS_KEY",
      "AGENTIC_GITHUB_APP_ID",
      "AGENTIC_GITHUB_APP_INSTALLATION_ID",
      "AGENTIC_GITHUB_APP_PRIVATE_KEY",
      "AGENTIC_GITHUB_APP_SYNC_SECRET",
      "AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES"
    ];

    for (const key of secretKeys) {
      expect(blueprint).toMatch(new RegExp(`key: ${key}\\n\\s+sync: false`));
    }

    expect(blueprint).not.toMatch(/AGENTIC_GITHUB_APP_PRIVATE_KEY\s*\n\s*value:/);
    expect(blueprint).not.toMatch(/AGENTIC_ACCESS_KEY\s*\n\s*value:/);
    expect(blueprint).not.toContain("trycloudflare.com");
  });

  it("shares managed Postgres through provider references instead of hardcoded credentials", () => {
    const blueprint = readBlueprint();

    expect(blueprint).toContain("fromDatabase:");
    expect(blueprint).toContain("name: agentic-postgres");
    expect(blueprint).toContain("property: connectionString");
    expect(blueprint).not.toMatch(/postgres:\/\//);
    expect(blueprint).not.toMatch(/postgresql:\/\//);
  });

  it("documents the current Render CLI command for service inventory evidence", () => {
    const runbook = readDeploymentRunbook();

    expect(runbook).toContain("render services list --output json");
    expect(runbook).not.toContain("render services --output json");
  });

  it("documents that free-tier rewrites are not production waivers for the worker topology", () => {
    const runbook = readDeploymentRunbook();

    expect(runbook).toContain("Do not treat a free-tier Blueprint rewrite as a production waiver");
    expect(runbook).toContain("not for");
    expect(runbook).toContain("background workers");
    expect(runbook).toContain("services[1]");
    expect(runbook).toContain("need_payment_info");
    expect(runbook).toContain("preDeployCommand");
  });
});
