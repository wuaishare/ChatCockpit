# First Task: Safe Doc Edit

Ask ChatGPT:

```text
Use ChatCockpit direct-drive mode to read README.md, make a tiny documentation wording edit with editFile, then run git diff and summarize the change. Do not commit.
```

Expected result:

- ChatGPT reads the target file before editing
- `editFile` changes one markdown file
- `getGitDiff` shows only public-safe diff output
- no `.env`, `.chatcockpit`, legacy `.tokenpilot`, logs, or private paths appear
