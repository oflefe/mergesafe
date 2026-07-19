import {
  readOllamaEmbeddingConfig,
  requestOllamaEmbeddings,
} from "../../../../src/verification/pr-classification/embedding-client";

describe("Ollama embedding client", () => {
  it("reads safe defaults and stays disabled unless explicitly enabled", () => {
    expect(readOllamaEmbeddingConfig({})).toEqual({
      enabled: false,
      provider: "ollama",
      model: "all-minilm",
      baseUrl: "http://localhost:11434",
      timeoutMs: 5000,
    });
  });

  it("sends batch inputs to the Ollama embed endpoint", async () => {
    const fetchImplementation = jest.fn(async () =>
      new Response(JSON.stringify({ embeddings: [[1, 0], [0, 1]] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      requestOllamaEmbeddings(
        ["first", "second"],
        {
          enabled: true,
          provider: "ollama",
          model: "all-minilm",
          baseUrl: "http://embeddings:11434",
          timeoutMs: 1000,
        },
        fetchImplementation as unknown as typeof fetch,
      ),
    ).resolves.toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://embeddings:11434/api/embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "all-minilm",
          input: ["first", "second"],
        }),
      }),
    );
  });

  it("rejects malformed or inconsistent vectors", async () => {
    const fetchImplementation = jest.fn(async () =>
      new Response(JSON.stringify({ embeddings: [[1, 0], [1]] }), {
        status: 200,
      }),
    );

    await expect(
      requestOllamaEmbeddings(
        ["first", "second"],
        {
          enabled: true,
          provider: "ollama",
          model: "all-minilm",
          baseUrl: "http://localhost:11434",
          timeoutMs: 1000,
        },
        fetchImplementation as unknown as typeof fetch,
      ),
    ).rejects.toThrow("inconsistent vector dimensions");
  });
});
