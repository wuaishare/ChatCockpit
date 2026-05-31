# Local-First Safe Task Example

This example shows the intended beginner workflow.

1. Open the local UI at `http://127.0.0.1:4318/ui`.
2. Copy GPT Helper instructions.
3. Ask ChatGPT to run a safe read/status task.
4. For a tiny markdown change, let ChatGPT use `readFile` then `editFile`.
5. For a larger change, ask ChatGPT to create a `createCodexRun` job with `executionMode=develop` and a narrow task description.
6. Watch the job move from `queued` to `running` or a terminal state in the UI.
7. Inspect `codexDiff`, `codexReview`, and `codexSummary` before deciding whether to commit.

Expected UI states:

- Setup wizard shows pending items until runtime, runner, GPT handoff, and first task are ready.
- Jobs list shows compact summaries first.
- Selecting a job hydrates details and artifact previews.
- Large artifact previews can be continued with the Load more button.
