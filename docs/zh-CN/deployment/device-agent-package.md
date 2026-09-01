# ChatCockpit Device Agent macOS 自包含包

Phase 11.1 提供面向无界面/远程 ChatCockpit 节点的 macOS Self-contained Device Agent 包；Phase 11.2 在此基础上补齐 fail-closed 的公开分发与 Web Onboarding 合同。

目标 Mac **不需要预先安装 Node.js、npm，也不需要 ChatCockpit 源码工作区**。该包直接复用 ChatCockpit Desktop 已验证的 macOS Runtime Payload，内部包含固定版本 Node、编译后的 ChatCockpit Control Plane、Device Agent 服务管理脚本以及 Runtime 生命周期管理脚本。

## 信任与 Release 边界

现在明确区分两种包模式。

普通工程包继续固定为：

```text
distributionTrust=development
releaseEligible=false
```

它只用于本地工程验证，Web Cockpit 不会把这种包投影成可公开下载的 Native Package Bootstrap。

Release 包则使用：

```text
distributionTrust=release
releaseEligible=true
```

Release 模式采用 fail-closed：内嵌 Runtime 的 Build Provenance 必须是 clean，并且必须有明确 Build ID 与源码 Revision。公共分发 Publisher 还会要求 arm64 / x64 两个包来自同一源码 Revision、使用同一 Bundled Node 版本，重新验证 Archive SHA-256 后才生成公共 Distribution Manifest。

这里的 `distributionTrust=release` 只表示通过 **ChatCockpit 自身的 Release Eligibility 合同**，并不等于 Apple Developer ID 签名、Notarization、Stapling，也不等于存在独立的 Publisher 数字签名。HTTPS 与 SHA-256 解决当前 Bootstrap Channel 和 Artifact Integrity 问题；Apple Certification 仍属于另一条独立分发里程碑。

## 构建

普通工程包：

```bash
npm run build:macos-device-agent-package
```

也可以指定开发包架构：

```bash
bash ./scripts/build-macos-device-agent-package.sh --arch arm64
bash ./scripts/build-macos-device-agent-package.sh --arch x64
```

从**干净源码 Revision**构建双架构 Release Distribution：

```bash
npm run build:macos-device-agent-release
```

这个命令会依次生成 Release Mode 的 arm64 / x64 包，发布 Distribution Directory，并执行 Distribution Verifier。只要 Source Provenance 是 dirty，就会拒绝把制品标成 release-eligible。

Builder 会先生成并验证标准 Self-contained macOS Runtime Payload，然后再套上受限 Device Agent 入口。Runtime Builder 会明确排除生成的 `dist/device-agent`，防止旧 Device Agent 包或 Public Distribution Artifact 被递归带进新 Runtime Payload。

单架构输出结构：

```text
dist/device-agent/macos/<arch>/
├── ChatCockpitDeviceAgent/
│   ├── bin/chatcockpit-device
│   ├── manifest.json
│   └── runtime/TokenPilotRuntime/
├── ChatCockpit-Device-Agent-<version>-macos-<arch>.tar.gz
└── ChatCockpit-Device-Agent-<version>-macos-<arch>.tar.gz.sha256
```

Release Distribution 输出：

```text
dist/device-agent/distribution/
├── manifest.json
├── manifest.json.sha256
├── ChatCockpit-Device-Agent-<version>-macos-arm64.tar.gz
└── ChatCockpit-Device-Agent-<version>-macos-x64.tar.gz
```

`TokenPilotRuntime` 目前仍是内部兼容期 Payload 目录名，不影响对操作员暴露的正式产品/包身份；外部身份仍统一为 ChatCockpit。

## 公网分发配置

构建出 Release Distribution 并不会自动把它暴露到公网。Control Plane 必须显式配置本机 Distribution Directory，例如写入受管理 Runtime 的 `server.env`：

```text
CHATCOCKPIT_DEVICE_AGENT_DISTRIBUTION_DIR=/path/to/dist/device-agent/distribution
```

macOS Managed Runtime 生命周期会把这个设置只传给 Control Plane；Runner 与 Process Supervisor 不需要读取 Distribution Directory。

当配置目录通过完整校验后，Hub 只开放下面这些匿名分发路由：

```text
/downloads/device-agent/manifest.json
/downloads/device-agent/macos/arm64/<manifest-声明的-release-file>.tar.gz
/downloads/device-agent/macos/x64/<manifest-声明的-release-file>.tar.gz
```

Archive 文件名必须与已验证 Manifest 中的声明完全一致。Distribution Directory 里的其他文件不会因为这个功能被一并公开。

“添加设备”向导继续采用 fail-closed。只有下面条件**同时成立**时，`bootstrap.nativePackage.available` 才会变成 `true`：

- Distribution Directory 已配置且可读取；
- Manifest Checksum、Release Eligibility、Metadata、Archive Size 与 Archive SHA-256 全部有效；
- arm64 与 x64 两个架构的 Artifact 都存在；
- 已配置 Canonical Public Origin，并且必须是 HTTPS；
- 当前 Public Route Verification Evidence 与这个 Canonical Origin 精确匹配且状态为 verified。

任一条件不满足，UI 都会隐藏 Native Package 下载动作并给出有限、可解释的 unavailable reason，而不是展示一个可能失效、不可执行或尚未真正发布的 URL。

## 使用方式

解压后统一通过一个入口操作：

```bash
./ChatCockpitDeviceAgent/bin/chatcockpit-device status --json
./ChatCockpitDeviceAgent/bin/chatcockpit-device connect https://hub.example.com --json
./ChatCockpitDeviceAgent/bin/chatcockpit-device discover --json
./ChatCockpitDeviceAgent/bin/chatcockpit-device route status --json
./ChatCockpitDeviceAgent/bin/chatcockpit-device workspace set /path/to/development-workspace --json
./ChatCockpitDeviceAgent/bin/chatcockpit-device workspace status --json
./ChatCockpitDeviceAgent/bin/chatcockpit-device service start
./ChatCockpitDeviceAgent/bin/chatcockpit-device service status
./ChatCockpitDeviceAgent/bin/chatcockpit-device runtime start
./ChatCockpitDeviceAgent/bin/chatcockpit-device runtime status
```

这个入口只暴露 Device Agent 与受控 Runtime 生命周期能力，不是把完整 ChatCockpit CLI 任意透传出来。

Headless 包没有 GUI Workspace Picker，因此持久执行默认采用 fail-closed。`workspace set` 只接受真实存在的目录，解析 canonical path 后仅把这个路径写入 ChatCockpit State 下 mode 0600 的 JSON 配置。没有有效 Workspace 时，persistent `agent`、`service start/restart`、`runtime start/restart` 都会拒绝运行；Embedded Runtime 自己也不能被选为开发 Workspace。一次性的 Enrollment、状态查询和 Discovery 在尚未选择 Workspace 时仍可使用，因此可以先完成设备配对，再配置实际开发目录。

## 不依赖系统 Node

入口只使用包内 Node：

```text
runtime/TokenPilotRuntime/node/bin/node
```

Launcher 会把 Packaged Distribution Context 指向包内 Runtime，再调用编译后的 Device Agent CLI。Clean Archive Live Proof 会在独立临时 HOME、只包含标准 macOS 系统目录的 PATH 下执行，因此目标机不依赖外部 `node`、`npm` 或源码仓库。

## 状态与设备身份

安装包属于不可写的应用/Runtime 材料，设备身份与可写状态不会写进包内。

默认 Packaged State 继续位于 ChatCockpit Application Support 状态根目录；需要完全隔离时可以显式设置 `CHATCOCKPIT_STATE_ROOT`。Enrollment 只在目标机实际运行时创建本地 Ed25519 设备身份；重新构建或替换安装包不会把现有设备私钥打包进去，也不会自动重置已授权身份。

后台 Device Agent 仍然是独立于 Control Plane / Runner / Process Supervisor 的单独 LaunchAgent。这样普通 Runtime 即使被停止，管理通道仍可以继续在线，为后续远程 Runtime Start 保留入口。

## 验证内容

Package 与 Distribution Verifier 会检查：

- 包 Schema、架构、信任等级与 Release Eligibility；
- Device Agent Entry Point 可执行权限与 SHA-256；
- Embedded Runtime Manifest 与关键文件 Hash；
- Release Package 内嵌 Build Provenance 必须 clean；
- Bundled Node、CLI、Device Agent Service Manager、Runtime Lifecycle Manager 是否齐全；
- Package Root 内的 Symlink Containment；
- Embedded Runtime 中不能带有生成的 Device Agent Package / Distribution Output；
- 当前原生架构下，在独立 HOME、无系统 Node PATH 条件下真实执行 `status --json`；
- Public Distribution Manifest 自身 SHA-256；
- 双架构 Archive Size 与 SHA-256；
- Archive 内 Package Manifest Checksum 以及 Build Provenance 与 Public Manifest 是否一致；
- arm64 / x64 是否来自同一 Source Revision、同一 Bundled Node 版本；
- Published Distribution Directory 是否存在 Manifest 未声明的额外文件。

常用专项验证命令：

```bash
npm run verify:macos-device-agent-package
npm run verify:macos-device-agent-package-contract
npm run verify:device-agent-distribution-catalog
npm run verify:device-agent-distribution
```

Catalog / Onboarding 合同也已经进入常规 Protocol 与 CI Gate，避免后续修改悄悄退回到“本机能构建，但公网 Bootstrap 真值并不可靠”的状态。
