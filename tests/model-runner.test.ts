import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  getModelConfig,
  isModelConfigured,
  runTextModel
} from "../packages/agents/src/model-runner";

const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_MODEL", "OPENAI_MODEL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("model-runner", () => {
  it("reports unconfigured when no provider key is present", () => {
    expect(isModelConfigured()).toBe(false);
  });

  it("reports configured when any provider key is present", () => {
    process.env.OPENAI_API_KEY = "test-key";
    expect(isModelConfigured()).toBe(true);
  });

  it("returns default model ids and honors env overrides", () => {
    expect(getModelConfig()).toEqual({ anthropic: DEFAULT_ANTHROPIC_MODEL, openai: DEFAULT_OPENAI_MODEL });
    process.env.ANTHROPIC_MODEL = "custom-anthropic";
    process.env.OPENAI_MODEL = "custom-openai";
    expect(getModelConfig()).toEqual({ anthropic: "custom-anthropic", openai: "custom-openai" });
  });

  it("does not ship the legacy placeholder model ids", () => {
    expect(DEFAULT_ANTHROPIC_MODEL).not.toBe("claude-opus-4-6");
    expect(DEFAULT_OPENAI_MODEL).not.toBe("gpt-5.4");
  });

  it("returns null without invoking a provider when unconfigured", async () => {
    await expect(runTextModel({ prompt: "hi", maxTokens: 8 })).resolves.toBeNull();
  });
});
