import { readFileSync } from "node:fs";
import path from "node:path";

export type CloudflareProviderEvidence = {
  provider: "cloudflare-workers";
  environment: string;
  services: Array<{
    name: string;
    role: "web" | "worker";
  }>;
  database: {
    engine: "postgres";
    configured: boolean;
    binding: string | null;
    hyperdriveId: string | null;
  };
  stableHttpsIngress: boolean;
  secretManagement: boolean;
  rollbackAuthority: string;
};

export type CloudflareProviderEvidenceOptions = {
  repoRoot: string;
  environment?: string;
  stableHttpsIngress?: boolean;
  secretManagement?: boolean;
  rollbackAuthority?: string;
};

type WranglerConfig = {
  name?: unknown;
  triggers?: {
    crons?: unknown;
  };
  hyperdrive?: unknown;
};

export class CloudflareProviderEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareProviderEvidenceError";
  }
}

function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    const next = input[index + 1] ?? "";

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      } else if (char === "\n") {
        output += char;
      }
      continue;
    }

    if (!inString && char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (!inString && char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += char;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
    }
  }

  return output;
}

function readWranglerConfig(repoRoot: string): WranglerConfig {
  const configPath = path.join(repoRoot, "apps", "web", "wrangler.jsonc");
  const raw = readFileSync(configPath, "utf8");

  try {
    return JSON.parse(stripJsonComments(raw)) as WranglerConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    throw new CloudflareProviderEvidenceError(`Could not parse apps/web/wrangler.jsonc: ${message}`);
  }
}

function requireWorkerName(config: WranglerConfig): string {
  if (typeof config.name === "string" && config.name.trim()) {
    return config.name.trim();
  }

  throw new CloudflareProviderEvidenceError("apps/web/wrangler.jsonc must define a non-empty Worker name.");
}

function resolveHyperdrive(config: WranglerConfig): { binding: string | null; id: string | null } {
  const entries = Array.isArray(config.hyperdrive) ? config.hyperdrive : [];
  const entry = entries.find((candidate): candidate is Record<string, unknown> => {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }

    return (candidate as Record<string, unknown>).binding === "HYPERDRIVE";
  });

  if (!entry) {
    return { binding: null, id: null };
  }

  return {
    binding: typeof entry.binding === "string" && entry.binding.trim() ? entry.binding.trim() : null,
    id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : null
  };
}

function hasCronTrigger(config: WranglerConfig): boolean {
  const crons = config.triggers?.crons;
  return Array.isArray(crons) && crons.some((cron) => typeof cron === "string" && cron.trim());
}

export function buildCloudflareProviderEvidence(
  options: CloudflareProviderEvidenceOptions
): CloudflareProviderEvidence {
  const config = readWranglerConfig(options.repoRoot);
  const workerName = requireWorkerName(config);
  const hyperdrive = resolveHyperdrive(config);
  const cronEnabled = hasCronTrigger(config);

  return {
    provider: "cloudflare-workers",
    environment: options.environment?.trim() || "production",
    services: [
      {
        name: workerName,
        role: "web"
      },
      {
        name: cronEnabled ? `${workerName}-cron` : `${workerName}-worker`,
        role: "worker"
      }
    ],
    database: {
      engine: "postgres",
      configured: Boolean(hyperdrive.binding && hyperdrive.id),
      binding: hyperdrive.binding,
      hyperdriveId: hyperdrive.id
    },
    stableHttpsIngress: options.stableHttpsIngress ?? true,
    secretManagement: options.secretManagement ?? true,
    rollbackAuthority: options.rollbackAuthority?.trim() || "wrangler deployments rollback"
  };
}
