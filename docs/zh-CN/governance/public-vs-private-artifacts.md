# 公共与私有产物边界

TokenPilot 是本地优先工具，但它会生成供 GPT 查看和审查的 public-safe artifacts。因此必须区分哪些内容可以进入公开仓库或 GPT 输出，哪些只能留在本地配置中。

## 可以进入公开仓库

- 源码
- OpenAPI 模板
- README 和公开文档
- 示例配置
- 不含真实域名和 token 的占位示例
- public-safe 测试 fixtures
- release notes

## 不应进入 Git

- API keys
- Bearer tokens
- cookies
- 真实部署域名
- tunnel tokens
- private IPs
- internal hostnames
- 本机绝对路径
- `.tokenpilot/runtime/`
- `.codex/`
- `.servbay/`
- 本地日志
- GPT Builder 导入记录、验证截图和个人账号相关操作记录

## 占位示例

公开文档使用：

```text
https://tokenpilot.example.com
replace-with-a-strong-token
```

实际部署时换成你自己的 HTTPS 地址和 token，但不要提交到 Git。

## 扫描命令

提交前运行：

```bash
npm run verify:web:safety
npm run privacy:scan:history
```

`verify:web:safety` 检查当前工作树。`privacy:scan:history` 检查 Git 历史。历史泄露不能靠普通清理提交彻底删除，需要经过审查的 history rewrite。
