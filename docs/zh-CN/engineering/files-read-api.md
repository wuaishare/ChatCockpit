# Files Read API

Files Read API 用于让 GPT Actions 受控读取仓库文本文件。

## 目标

- 只通过 `repoId` 暴露仓库身份。
- 不暴露本机绝对路径。
- 支持分页读取大文件。
- 阻止读取 `.env`、运行态、日志和本地私有目录。

## 常用能力

- `readFile`：读取单个文本文件。
- `readFiles`：批量读取多个文本文件。
- `listDirectory`：列目录。
- `searchCode`：用 ripgrep 搜索代码。

`readFiles` 支持：

- `offset`
- `limit`
- `nextOffset`
- `eof`

读取大文件时，如果返回 `truncated=true`，调用方应继续用 `offset/limit` 读取，直到 `nextOffset=null` 或 `eof=true`。

## 路径规则

- 使用相对路径。
- 禁止绝对路径。
- 禁止 `..` 穿越。
- 禁止读取本地运行态目录。
- 输出中不复述本机绝对路径。

## 与写操作的关系

写入前应先读取当前内容：

1. `searchCode` 定位。
2. `readFiles` 精读。
3. 小改动使用 `editFile`。
4. 新文件或整文件生成才使用 `writeFile`。

这样可以减少 token 消耗，也能降低误写风险。
