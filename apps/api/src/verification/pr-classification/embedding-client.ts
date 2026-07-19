import { Injectable } from "@nestjs/common";

export interface EmbeddingClientMetadata {
  provider: "ollama";
  model: string;
}

export interface OllamaEmbeddingConfig extends EmbeddingClientMetadata {
  enabled: boolean;
  baseUrl: string;
  timeoutMs: number;
}

interface OllamaEmbeddingResponse {
  embeddings?: unknown;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function readOllamaEmbeddingConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OllamaEmbeddingConfig {
  return {
    enabled: environment.PR_CLASSIFIER_ENABLED === "true",
    provider: "ollama",
    model: environment.EMBEDDING_MODEL?.trim() || "all-minilm",
    baseUrl: (environment.EMBEDDING_BASE_URL?.trim() || "http://localhost:11434").replace(
      /\/$/,
      "",
    ),
    timeoutMs: parsePositiveInteger(environment.EMBEDDING_TIMEOUT_MS, 5_000),
  };
}

function validateEmbeddings(value: unknown, expectedCount: number): number[][] {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw new Error("Embedding provider returned an unexpected embedding count.");
  }

  const embeddings = value.map((embedding) => {
    if (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      !embedding.every((item) => typeof item === "number" && Number.isFinite(item))
    ) {
      throw new Error("Embedding provider returned an invalid embedding vector.");
    }
    return embedding as number[];
  });
  const dimension = embeddings[0]?.length ?? 0;
  if (embeddings.some((embedding) => embedding.length !== dimension)) {
    throw new Error("Embedding provider returned inconsistent vector dimensions.");
  }
  return embeddings;
}

export async function requestOllamaEmbeddings(
  inputs: string[],
  config: OllamaEmbeddingConfig,
  fetchImplementation: typeof fetch = fetch,
): Promise<number[][]> {
  if (inputs.length === 0) {
    return [];
  }
  const response = await fetchImplementation(`${config.baseUrl}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: config.model, input: inputs }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Embedding provider request failed with status ${response.status}.`);
  }
  const payload = (await response.json()) as OllamaEmbeddingResponse;
  return validateEmbeddings(payload.embeddings, inputs.length);
}

@Injectable()
export class OllamaEmbeddingClient {
  getConfig(): OllamaEmbeddingConfig {
    return readOllamaEmbeddingConfig();
  }

  getMetadata(): EmbeddingClientMetadata {
    const config = this.getConfig();
    return { provider: config.provider, model: config.model };
  }

  isEnabled(): boolean {
    return this.getConfig().enabled;
  }

  embed(inputs: string[]): Promise<number[][]> {
    return requestOllamaEmbeddings(inputs, this.getConfig());
  }
}
