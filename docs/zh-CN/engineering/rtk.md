# RTK 使用说明

RTK 用于压缩高噪声命令输出，减少日志和 token 消耗。

适合：

```bash
rtk npm test
rtk npm run verify
rtk git status
rtk git log -n 30
rtk find . -name '*.ts'
```

不适合：

```bash
git diff
git show
sed -n '1,200p' file
tail -n 200 log
```

原则：

- 高噪声摘要命令用 `rtk`。
- 精确 diff、精确文件读取、事故日志保留原始输出。
