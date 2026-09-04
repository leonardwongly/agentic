import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  vi.restoreAllMocks();
  vi.resetModules();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("model-runner timeout regression", () => {
  it("exports a default timeout constant of 30 seconds", async () => {
    const { DEFAULT_MODEL_TIMEOUT_MS } = await import("../packages/agents/src/model-runner");
    expect(DEFAULT_MODEL_TIMEOUT_MS).toBe(30_000);
  });

  it("throws a descriptive timeout error when Anthropic API call exceeds the timeout", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn((_params: unknown, options?: { signal?: AbortSignal }) => {
            // Simulate a hung connection: never resolve, but respect abort
            return new Promise<never>((_resolve, reject) => {
              if (options?.signal) {
                options.signal.addEventListener("abort", () => {
                  const err = new Error("aborted");
                  (err as unknown as { name: string }).name = "AbortError";
                  reject(err);
                });
              }
            });
          })
        };
      }
    }));

    const { runTextModel } = await import("../packages/agents/src/model-runner");

    await expect(
      runTextModel({ prompt: "test", maxTokens: 10 }, { timeoutMs: 50 })
    ).rejects.toThrow(/Anthropic.*timed out after 50ms/);
  }, 10_000);

  it("throws a descriptive timeout error when OpenAI API call exceeds the timeout", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";

    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        chat = {
          completions: {
            create: vi.fn((_params: unknown, options?: { signal?: AbortSignal }) => {
              return new Promise<never>((_resolve, reject) => {
                if (options?.signal) {
                  options.signal.addEventListener("abort", () => {
                    const err = new Error("aborted");
                    (err as unknown as { name: string }).name = "AbortError";
                    reject(err);
                  });
                }
              });
            })
          }
        };
      }
    }));

    const { runTextModel } = await import("../packages/agents/src/model-runner");

    await expect(
      runTextModel({ prompt: "test", maxTokens: 10 }, { timeoutMs: 50 })
    ).rejects.toThrow(/OpenAI.*timed out after 50ms/);
  }, 10_000);

  it("passes through non-timeout errors without wrapping them", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn(() => Promise.reject(new Error("Rate limit exceeded")))
        };
      }
    }));

    const { runTextModel } = await import("../packages/agents/src/model-runner");

    await expect(
      runTextModel({ prompt: "test", maxTokens: 10 }, { timeoutMs: 5000 })
    ).rejects.toThrow("Rate limit exceeded");
  });

  it("uses the default timeout when no custom timeout is provided", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn((_params: unknown, options?: { signal?: AbortSignal }) => {
            return new Promise<never>((_resolve, reject) => {
              if (options?.signal) {
                options.signal.addEventListener("abort", () => {
                  const err = new Error("aborted");
                  (err as unknown as { name: string }).name = "AbortError";
                  reject(err);
                });
              }
            });
          })
        };
      }
    }));

    const { runTextModel, DEFAULT_MODEL_TIMEOUT_MS } = await import(
      "../packages/agents/src/model-runner"
    );

    await expect(
      runTextModel({ prompt: "test", maxTokens: 10 })
    ).rejects.toThrow(`Anthropic API call timed out after ${DEFAULT_MODEL_TIMEOUT_MS}ms`);
  }, 60_000);

  it("passes an AbortController signal to the Anthropic SDK", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

    let capturedSignal: AbortSignal | null = null;

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn((_params: unknown, options?: { signal?: AbortSignal }) => {
            capturedSignal = options?.signal ?? null;
            return new Promise<never>((_resolve, reject) => {
              if (options?.signal) {
                options.signal.addEventListener("abort", () => {
                  const err = new Error("aborted");
                  (err as unknown as { name: string }).name = "AbortError";
                  reject(err);
                });
              }
            });
          })
        };
      }
    }));

    const { runTextModel } = await import("../packages/agents/src/model-runner");

    try {
      await runTextModel({ prompt: "test", maxTokens: 10 }, { timeoutMs: 50 });
    } catch {
      // expected timeout
    }

    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  }, 10_000);

  it("passes an AbortController signal to the OpenAI SDK", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";

    let capturedSignal: AbortSignal | null = null;

    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        chat = {
          completions: {
            create: vi.fn((_params: unknown, options?: { signal?: AbortSignal }) => {
              capturedSignal = options?.signal ?? null;
              return new Promise<never>((_resolve, reject) => {
                if (options?.signal) {
                  options.signal.addEventListener("abort", () => {
                    const err = new Error("aborted");
                    (err as unknown as { name: string }).name = "AbortError";
                    reject(err);
                  });
                }
              });
            })
          }
        };
      }
    }));

    const { runTextModel } = await import("../packages/agents/src/model-runner");

    try {
      await runTextModel({ prompt: "test", maxTokens: 10 }, { timeoutMs: 50 });
    } catch {
      // expected timeout
    }

    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  }, 10_000);
});
