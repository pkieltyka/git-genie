import { getModels, stream, type KnownProvider, type Model, type Api } from "@mariozechner/pi-ai";
import { getApiKeyForProvider, resolveOAuthProviderId } from "./auth.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LlmOptions {
  provider: string;
  model: string;
  verbose?: boolean;
}

export interface LlmResult {
  content: string;
  tokenUsage?: {
    input: number;
    output: number;
    totalTokens: number;
    cost: number;
  };
}

// ---------------------------------------------------------------------------
// LLM streaming call
// ---------------------------------------------------------------------------

/**
 * Call the LLM with streaming output to stderr (so stdout stays clean for piping).
 * Returns the full generated text.
 */
export async function callLlm(
  systemPrompt: string,
  userMessage: string,
  options: LlmOptions
): Promise<LlmResult> {
  const oauthProviderId = resolveOAuthProviderId(options.provider);
  const apiKey = await getApiKeyForProvider(oauthProviderId);

  let model: Model<Api>;
  try {
    const models = getModels(options.provider as KnownProvider);
    const found = models.find((m) => m.id === options.model);
    if (!found) {
      throw new Error("Model not found");
    }
    model = found;
  } catch {
    console.error(
      `Error: unknown model '${options.model}' for provider '${options.provider}'.`
    );
    console.error("Run `gitgenie list-models` to see available models.");
    process.exit(1);
  }

  if (options.verbose) {
    console.error(`Using model: ${model.name} (${model.provider}/${model.id})`);
    console.error(`Context window: ${model.contextWindow} tokens`);
    console.error("");
  }

  const s = stream(
    model,
    {
      systemPrompt,
      messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
    },
    { apiKey }
  );

  let fullText = "";

  for await (const event of s) {
    if (event.type === "text_delta") {
      process.stdout.write(event.delta);
      fullText += event.delta;
    } else if (event.type === "error") {
      const errMsg =
        event.error.errorMessage || "Unknown LLM error";
      console.error(`\nLLM error: ${errMsg}`);
      process.exit(1);
    }
  }

  const result = await s.result();

  // Ensure trailing newline
  if (fullText && !fullText.endsWith("\n")) {
    process.stdout.write("\n");
    fullText += "\n";
  }

  const tokenUsage = result.usage
    ? {
        input: result.usage.input,
        output: result.usage.output,
        totalTokens: result.usage.totalTokens,
        cost: result.usage.cost.total,
      }
    : undefined;

  if (options.verbose && tokenUsage) {
    console.error("");
    console.error(`Tokens: ${tokenUsage.input} in + ${tokenUsage.output} out = ${tokenUsage.totalTokens} total`);
    console.error(`Cost: $${tokenUsage.cost.toFixed(4)}`);
  }

  return { content: fullText, tokenUsage };
}

/**
 * Get context window size for a model (for diff budget calculations).
 */
export function getModelContextWindow(
  provider: string,
  modelId: string
): number {
  try {
    const models = getModels(provider as KnownProvider);
    const found = models.find((m) => m.id === modelId);
    return found?.contextWindow ?? 128_000;
  } catch {
    // Default fallback
    return 128_000;
  }
}
