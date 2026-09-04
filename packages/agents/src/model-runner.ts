/**
 * Provider-neutral model runner.
 *
 * Model IDs are deployment configuration: set ANTHROPIC_MODEL / OPENAI_MODEL to the
 * model deployed in your environment. The defaults below are real, current model
 * identifiers (the Anthropic `-latest` alias auto-tracks the newest snapshot) rather
 * than the previous placeholders, which would fail on the first live request.
 *
 * SDK imports are lazy-loaded via dynamic import() to reduce bundle size and
 * improve cold start times, especially for Cloudflare Workers deployments.
 */

// Type-only imports for type checking without runtime cost
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";

export const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
export const DEFAULT_OPENAI_MODEL = "gpt-4o";

export type ModelConfig = { anthropic: string; openai: string };

export function getModelConfig(): ModelConfig {
  return {
    anthropic: process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
    openai: process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL
  };
}

export function isModelConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

export type ModelTextRequest = { prompt: string; maxTokens: number };

export const DEFAULT_MODEL_TIMEOUT_MS = 30_000;

// Lazy-loaded client caches
let anthropicClient: { apiKey: string; client: Anthropic } | null = null;
let openaiClient: { apiKey: string; client: OpenAI } | null = null;

// Module-level cache for loaded SDK modules
let anthropicModule: typeof import("@anthropic-ai/sdk") | null = null;
let openaiModule: typeof import("openai") | null = null;

/**
 * Lazily load the Anthropic SDK module.
 * Uses dynamic import to avoid bundling the SDK unless actually needed.
 */
async function loadAnthropicModule(): Promise<typeof import("@anthropic-ai/sdk")> {
  if (!anthropicModule) {
    anthropicModule = await import("@anthropic-ai/sdk");
  }
  return anthropicModule;
}

/**
 * Lazily load the OpenAI SDK module.
 * Uses dynamic import to avoid bundling the SDK unless actually needed.
 */
async function loadOpenAIModule(): Promise<typeof import("openai")> {
  if (!openaiModule) {
    openaiModule = await import("openai");
  }
  return openaiModule;
}

async function getAnthropicClient(apiKey: string): Promise<Anthropic> {
  if (anthropicClient?.apiKey !== apiKey) {
    const AnthropicClass = (await loadAnthropicModule()).default;
    anthropicClient = { apiKey, client: new AnthropicClass({ apiKey }) };
  }
  return anthropicClient!.client;
}

async function getOpenAIClient(apiKey: string): Promise<OpenAI> {
  if (openaiClient?.apiKey !== apiKey) {
    const OpenAIClass = (await loadOpenAIModule()).default;
    openaiClient = { apiKey, client: new OpenAIClass({ apiKey }) };
  }
  return openaiClient!.client;
}

/**
 * Run a single-prompt text completion against the first configured provider
 * (Anthropic preferred, then OpenAI). Returns the trimmed text, or null when no
 * provider is configured or the provider returns no text content. Throws on
 * provider/transport errors so callers can fall back deterministically.
 */
export async function runTextModel(
  request: ModelTextRequest,
  options?: { timeoutMs?: number }
): Promise<string | null> {
  const config = getModelConfig();
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;

  if (anthropicApiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const client = await getAnthropicClient(anthropicApiKey);
      const response = await client.messages.create(
        {
          model: config.anthropic,
          max_tokens: request.maxTokens,
          messages: [{ role: "user", content: request.prompt }]
        },
        { signal: controller.signal }
      );
      return response.content.find((block) => block.type === "text")?.text?.trim() ?? null;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `Anthropic API call timed out after ${timeoutMs}ms for model ${config.anthropic}.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  if (openaiApiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const client = await getOpenAIClient(openaiApiKey);
      const response = await client.chat.completions.create(
        {
          model: config.openai,
          max_tokens: request.maxTokens,
          messages: [{ role: "user", content: request.prompt }]
        },
        { signal: controller.signal }
      );
      return response.choices[0]?.message?.content?.trim() ?? null;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `OpenAI API call timed out after ${timeoutMs}ms for model ${config.openai}.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}
