# RTK Trial For TokenPilot

Only use `rtk` in this repo for commands that usually emit long, noisy output.

Good default candidates:

```bash
rtk ls
rtk tree
rtk find . -name '*.ts'
rtk env
rtk git status
rtk git log -n 30
rtk pytest -q
rtk npm test
rtk eslint .
```

Do not force `rtk` for commands where exact fidelity matters:

```bash
git diff
git show
cat path/to/file
sed -n '1,200p' path/to/file
tail -n 200 logfile
docker logs <container>
kubectl logs <pod>
```

Heuristic:

- Use `rtk` for noisy listings, summaries, test runners, and environment dumps.
- Prefer raw commands for exact diffs, exact file reads, and incident logs.
