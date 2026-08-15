# First Task: Read Status

Ask ChatGPT:

```text
Use ChatCockpit to check health, list recent jobs, and summarize whether the local control plane and runner look ready. Do not write files.
```

Expected result:

- ChatGPT calls health first
- ChatGPT lists jobs with the compact summary API
- no file writes occur
- the Web UI Jobs view remains unchanged except for normal refreshes
