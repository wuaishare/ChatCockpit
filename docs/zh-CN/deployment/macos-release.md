# ChatCockpit macOS 分发与发布

ChatCockpit 明确把 **分发工程能力** 与 **Apple 正式发行认证** 拆成两条独立链路。这样可以在尚未加入付费 Apple Developer Program 的阶段继续完善 DMG、Manifest 与更新体验，同时不会把 unsigned / unnotarized 产物冒充成正式生产发行版。

## 当前状态

仓库当前已经实现 Secretless Engineering Lane：

- Xcode Distribution Project 与 Archive Boundary；
- Hardened Runtime entitlement policy contract；
- fail-closed Developer ID signing 入口；
- fail-closed `notarytool` / stapling contract；
- arm64 / x64 development DMG 构建；
- 真实 `hdiutil verify` + 只读挂载 / 内容检查；
- SHA-256 绑定的 Release Manifest；
- 显式 `distributionTrust` / `releaseEligible` 信任状态；
- macOS Public Update Metadata Contract；
- Desktop Settings 中的 Manual Verified Update v1；
- 显式、Tag-only 的 credentialed GitHub release workflow contract。

ChatCockpit 当前还没有使用 Apple Developer Program 下的正式 Developer ID Application identity。因此项目**不会声称**公开 ChatCockpit DMG 已经：

- Developer ID 正式签名；
- 通过 Gatekeeper 生产发行验收；
- Apple Notarized；
- Stapled；
- Production / Release Eligible。

Apple 正式认证只是延后，并没有从产品路线中删除。

## 两条分发链

```text
reviewed commit
  |
  +-- Secretless Engineering Lane
  |     -> unsigned distribution app/archive
  |     -> development DMG
  |     -> hdiutil + mount/content verification
  |     -> release manifest
  |     -> distributionTrust=development
  |     -> releaseEligible=false
  |     -> update-contract tests
  |
  +-- Certification Lane（等未来具备 Apple membership + credential）
        -> Developer ID Application signing
        -> Hardened Runtime verification
        -> Gatekeeper assessment
        -> Apple notarization
        -> stapling
        -> Developer ID-signed DMG
        -> DMG notarization + stapling
        -> certified release manifest
        -> releaseEligible=true
        -> production update metadata
        -> explicit release publication
```

Development Artifact 不能靠“改一段 JSON”变成 Production。Certified Release Manifest Generator 会把认证证据绑定到**同一 commit、同一 architecture、同一 filename、同一 SHA-256**。

## 构建 Development DMG

Development DMG 用于在没有 Apple Credential 时完成真实 Packaging QA。先构建本地 App，再显式选择 development mode：

```bash
npm ci
npm run build:macos-desktop -- --arch arm64
npm run build:macos-dmg -- \
  --mode development \
  --arch arm64 \
  --version 0.1.0 \
  --app dist/macos/ChatCockpit.app
```

Intel 构建使用 `--arch x64`，并传入 x64 App。

输出命名合同：

```text
dist/macos-dmg/development/arm64/ChatCockpit-<version>-macos-arm64.dmg
dist/macos-dmg/development/x64/ChatCockpit-<version>-macos-x64.dmg
```

Builder / Verifier 会检查：

- 顶层可见内容严格为 `ChatCockpit.app` + Applications Folder Symlink；
- Bundle Identifier；
- App Architecture；
- `hdiutil verify`；
- Read-only Mount Inspection；
- SHA-256。

Development DMG 永远输出：

```text
distributionTrust=development
releaseEligible=false
```

它不是正式 Production Release。

## Release Manifest 信任合同

`generate:macos-release-manifest` 只生成 public-safe 的发行元数据、文件名与 hash，不保存证书导出物、Apple Account Credential、Private Key 或本机绝对路径。

Development 模式强制：

```text
distributionTrust=development
releaseEligible=false
certification=<absent>
```

Certified 模式只有在同一 Artifact 的全部认证证据都为真时才允许生成：

```text
developerIdSigned=true
hardenedRuntime=true
gatekeeperAccepted=true
notarizationAccepted=true
appStapled=true
dmgVerified=true
dmgNotarized=true
dmgStapled=true
```

证据同时绑定：

```text
commit
architecture
kind
dmg filename
sha256
```

任何字段缺失、为 false、hash/filename/architecture 不一致，或拿另一份 Artifact 的证据来复用，Generator 都会 fail closed。

## Manual Verified Update v1

Desktop Settings 新增 **Updates** 区域，显示：

- 当前 App Version；
- 当前 Build Number；
- **Check for Updates**；
- `Up to date` / `Version <x> available` / `Unable to check`；
- 只有当前架构存在 certified + release-eligible 更新时才出现 **Download Update**。

默认 Public Metadata Endpoint 对应 Latest GitHub Release 中名为：

```text
macos-update.json
```

Update Checker 强制要求：

- Metadata / Release / Download URL 都是 HTTPS；
- Schema 与 Version 合法；
- `releaseEligible=true`；
- SHA-256 合法；
- 每个 Architecture 最多一份 Artifact；
- DMG Filename 与版本、架构精确匹配；
- 当前 macOS 满足 `minimumMacOSVersion`。

更新检查**只由用户显式触发**。启动或创建 Desktop App Model 不会自动联网检查更新。

**Download Update** 只会把已经通过上述信任校验的 HTTPS Release Asset URL 交给系统浏览器打开。ChatCockpit 不会静默下载、替换、Patch、重启 App，也不会自动 Stop / Restart Control Plane、Runner 或 Process Supervisor。

## 正式认证 Workflow Contract

`.github/workflows/macos-release.yml` 与普通 PR/Push Verify 完全分离。

它具备以下硬边界：

- 只允许 `workflow_dispatch`；
- Runtime 要求当前 Ref 必须是与 Version 匹配的 `v<version>` Tag；
- Checkout / Build 必须精确对应触发时的 `GITHUB_SHA`；
- 使用受保护的 `macos-production-release` GitHub Environment；
- 任一必要 Credential Reference 缺失时，在 Release Build / Publication 前 fail closed；
- App / DMG / Manifest / Update Metadata 全部 Gate 通过后才允许发布；
- 无论成功还是失败，都通过 always-run Cleanup 删除 Ephemeral Keychain 与临时 Credential Files。

普通 PR / Push 验证不会读取 Apple Release Secret。

### 未来 GitHub Environment Secrets

真正准备打开 Apple 正式认证时，只在受保护的 `macos-production-release` Environment 配置：

```text
CHATCOCKPIT_MACOS_CERTIFICATE_P12_BASE64
CHATCOCKPIT_MACOS_CERTIFICATE_PASSWORD
CHATCOCKPIT_SIGNING_IDENTITY
CHATCOCKPIT_NOTARY_API_KEY_BASE64
CHATCOCKPIT_NOTARY_KEY_ID
CHATCOCKPIT_NOTARY_ISSUER_ID
```

这里只记录 Secret **名称/引用合同**。不要把真实证书、Private Key、Password、Apple Account Credential、导出的 Keychain 提交到 Repository、Documentation、Issue、PR Comment 或 CI Log。

Workflow 会把 Developer ID identity 导入临时 file-based keychain，并把 `notarytool` credential profile 存入同一临时 keychain。实际 release script 只接收 identity / profile / keychain reference。

## Production Workflow Gate 顺序

未来具备合法 Credential 后，正式链路设计为：

```text
explicit versioned tag + exact SHA
  -> credential preflight
  -> ephemeral keychain
  -> arm64/x64 distribution app build
  -> Developer ID app signing
  -> app notarization + stapling + Gatekeeper verification
  -> production-mode DMG build
  -> Developer ID DMG signing
  -> DMG notarization + stapling
  -> hdiutil + Gatekeeper + mounted-app verification
  -> hash-bound certification evidence
  -> certified release manifest
  -> production macos-update.json
  -> final manifest re-verification
  -> explicit GitHub Release publication
  -> always-run credential cleanup
```

任何更早阶段都不能发布 Production Asset。

## Apple Certification Boundary

Apple 当前针对 Mac App Store 之外的软件分发使用 Developer ID + Notarization 信任链。ChatCockpit 的 Production Workflow 保留并遵循这条路线，只使用 `notarytool`，不使用已经退出 Notarization 服务支持的 `altool` 路线。

官方参考：

- [Developer ID](https://developer.apple.com/support/developer-id/)
- [Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)

这些链接描述的是**未来 Certification Lane**，并不意味着 ChatCockpit 当前已经完成正式认证。

## Secretless Verification

```bash
npm run verify:macos-signing-contract
npm run verify:macos-notarization
npm run verify:macos-dmg
npm run verify:macos-release-manifest
npm run verify:macos-update-manifest
npm run verify:macos-manual-update
npm run verify:macos-release-workflow
swift test --package-path desktop/macos
```

这些 Gate 在没有 Apple Release Credential 时就应该持续全绿。真实 Developer ID、Gatekeeper、Notarization 与 Stapling Proof 是未来单独的 Certification Event。
