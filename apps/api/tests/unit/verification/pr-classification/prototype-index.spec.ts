import { OllamaEmbeddingClient } from "./embedding-client";
import { PullRequestTypePrototypeIndex } from "./prototype-index";

describe("PullRequestTypePrototypeIndex", () => {
  it("ingests semantic prototypes once and reuses the cached index", async () => {
    const client = {
      embed: jest.fn(async (inputs: string[]) =>
        inputs.map((_, index) => [index + 1, 1]),
      ),
    } as unknown as OllamaEmbeddingClient;
    const index = new PullRequestTypePrototypeIndex(client);

    const first = await index.ingest();
    const second = await index.ingest();

    expect(first).toBe(second);
    expect(first.map((item) => item.type)).toEqual([
      "feature",
      "bug-fix",
      "refactor",
      "security",
    ]);
    expect(client.embed).toHaveBeenCalledTimes(1);
  });
});
