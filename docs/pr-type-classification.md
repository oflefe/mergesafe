# Advisory PR-type classification

MergeSafe can optionally classify pull requests with a lightweight open-source embedding model. The classifier is advisory: it never changes the deterministic risk score, policy outcome, CI decision, or verdict.

## Architecture

1. High-precision structural types are detected deterministically from changed paths and file metadata.
2. MergeSafe creates a bounded PR document from title, body, branch, commit messages, scope, and changed paths.
3. Raw patches and repository file contents are not sent to the embedding model.
4. Semantic prototypes are embedded lazily and cached in memory.
5. The PR document is embedded and compared to prototypes with cosine similarity.
6. Results below the configured threshold are omitted and the classifier abstains.
7. Model errors fail open: deterministic verification continues unchanged.

Deterministic types include documentation, test-only, dependency-update, database-migration, configuration, infrastructure, security-sensitive paths, and generated code.

Embedding prototypes cover the ambiguous intent labels feature, bug-fix, refactor, and security.

## Local model

The default provider is an Ollama server using `all-minilm`, a small embedding-only model.

```bash
docker run -d \
  --name mergesafe-ollama \
  -p 11434:11434 \
  -v mergesafe-ollama:/root/.ollama \
  ollama/ollama

docker exec mergesafe-ollama ollama pull all-minilm
```

Enable classification in `.env`:

```env
PR_CLASSIFIER_ENABLED=true
EMBEDDING_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=all-minilm
EMBEDDING_TIMEOUT_MS=5000
PR_CLASSIFIER_MIN_SIMILARITY=0.62
PR_CLASSIFIER_MAX_LABELS=3
```

For a containerized API, set `EMBEDDING_BASE_URL` to the model service hostname instead of `localhost`.

## Output

The optional classification is stored under:

```text
decisionTrace.prClassification
```

It records:

- deterministic and embedding labels
- cosine similarity for embedding labels
- provider and model
- prototype and input versions
- a hash of the canonical PR document
- disabled, classified, abstained, or unavailable status

The document hash allows classification runs to be compared without persisting the embedded input text.

## Calibration

`PR_CLASSIFIER_MIN_SIMILARITY` is an initial operating threshold, not a calibrated probability. Before classification influences policy, build a labeled historical-PR dataset and measure precision, recall, multi-label F1, abstention rate, and deterministic/semantic disagreement.
