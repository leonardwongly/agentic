import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

/**
 * Provider-neutral model runner.
 *
 * Model IDs are deployment configuration: set ANTHROPIC_MODEL / OPENAI_MODEL to the
 * model deployed in your environment. The defaults below are real, current model
 * identifiers (the Anthropic `-latest` alias auto-tracks the newest snapshot) rather
 * than the previous placeholders, which would fail on the first live request.
 */
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

let anthropicClient: { apiKey: string; client: Anthropic } | null = null;
let openaiClient: { apiKey: string; client: OpenAI } | null = null;

function getAnthropicClient(apiKey: string): Anthropic {
  if (anthropicClient?.apiKey !== apiKey) {
    anthropicClient = { apiKey, client: new Anthropic({ apiKey }) };
  }
  return anthropicClient.client;
}

function getOpenAIClient(apiKey: string): OpenAI {
  if (openaiClient?.apiKey !== apiKey) {
    openaiClient = { apiKey, client: new OpenAI({ apiKey }) };
  }
  return openaiClient.client;
}

/**
 * Run a single-prompt text completion against the first configured provider
 * (Anthropic preferred, then OpenAI). Returns the trimmed text, or null when no
 * provider is configured or the provider returns no text content. Throws on
 * provider/transport errors so callers can fall back deterministically.
 */
export async function runTextModel(request: ModelTextRequest): Promise<string | null> {
  const config = getModelConfig();
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (anthropicApiKey) {
    const client = getAnthropicClient(anthropicApiKey);
    const response = await client.messages.create({
      model: config.anthropic,
      max_tokens: request.maxTokens,
      messages: [{ role: "user", content: request.prompt }]
    });
    return response.content.find((block) => block.type === "text")?.text?.trim() ?? null;
  }

  if (openaiApiKey) {
    const client = getOpenAIClient(openaiApiKey);
    const response = await client.chat.completions.create({
      model: config.openai,
      max_tokens: request.maxTokens,
      messages: [{ role: "user", content: request.prompt }]
    });
    return response.choices[0]?.message?.content?.trim() ?? null;
  }

  return null;
}
