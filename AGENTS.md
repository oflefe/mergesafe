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
