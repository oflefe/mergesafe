---
description: Any time a task is run, these instructions will be loaded into the request context. The instructions will be applied to all files in the request context.
# applyTo: 'Describe when these instructions should be loaded by the agent based on task context' # when provided, instructions will automatically be added to the request context when the pattern matches an attached file
---

<!-- Tip: Use /create-instructions in chat to generate content with agent assistance -->

- dont explain workflow. 
- prioritize readability, reviewability, testability.
- work in smallest possible increments, unless instructed otherwise.
- no code comments, write simple to follow code.
- 100% test coverage always. 
- Test docstrings in GIVEN WHEN THEN format.
- Choose simplest approach. If a task is failing constantly, stop and report. 
- Minimum output tokens. 
- variable, function, method names should stay explicit and clear. I should be able to understand the purpose of that function exactly.
- functions/methods single responsibility, use abstractions for side-effects

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
