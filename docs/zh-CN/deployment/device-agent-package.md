# ChatCockpit Device Agent macOS 自包含包

Phase 11.1 新增面向无界面/远程 ChatCockpit 节点的 macOS Self-contained Device Agent 工程分发包。

目标 Mac **不需要预先安装 Node.js、npm，也不需要 ChatCockpit 源码工作区**。该包直接复用 ChatCockpit Desktop 已验证的 macOS Runtime Payload，内部包含固定版本 Node、编译后的 ChatCockpit Control Plane、Device Agent 服务管理脚本以及 Runtime 生命周期管理脚本。

## 当前信任边界

Phase 11.1 目前是工程与分发基础设施，不是已经公开上线的一键安装通道。

每个包的 Manifest 都明确固定为：

```text
distributionTrust=development
releaseEligible=false
```

在 Phase 11.2 真正提供公开、可验证的下载地址与元数据合同之前，Web Cockpit 的“添加设备”向导仍必须把原生包 Bootstrap 标记为不可用。不能因为本机已经能构建 tar.gz，就把它冒充成公网用户可执行的正式下载入口。

## 构建

在 macOS 上运行：

```bash
npm run build:macos-device-agent-package
```

也可以指定架构：

```bash
bash ./scripts/build-macos-device-agent-package.sh --arch arm64
bash ./scripts/build-macos-device-agent-package.sh --arch x64
```

Builder 会先生成并验证标准的 Self-contained macOS Runtime Payload，然后再套上受限的 Device Agent 入口。

输出结构：

```text
dist/device-agent/macos/<arch>/
├── ChatCockpitDeviceAgent/
│   ├── bin/chatcockpit-device
│   ├── manifest.json
│   └── runtime/TokenPilotRuntime/
├── ChatCockpit-Device-Agent-<version>-macos-<arch>.tar.gz
└── ChatCockpit-Device-Agent-<version>-macos-<arch>.tar.gz.sha256
```

`TokenPilotRuntime` 目前仍是内部兼容期 Payload 目录名，不影响对操作员暴露的正式产品/包身份；外部身份仍统一为 ChatCockpit。

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

Launcher 会把 Packaged Distribution Context 指向包内 Runtime，再调用编译后的 Device Agent CLI。当前已经完成从 tar.gz 重新解压后的真实 Live Proof：使用独立临时 HOME，并把 PATH 限制为标准 macOS 系统目录后，`status --json` 仍能正常执行，因此目标机不需要外部 `node`、`npm` 或源码仓库。

## 状态与设备身份

安装包属于不可写的应用/Runtime 材料，设备身份与可写状态不会写进包内。

默认 Packaged State 继续位于 ChatCockpit Application Support 状态根目录；需要完全隔离时可以显式设置 `CHATCOCKPIT_STATE_ROOT`。Enrollment 只在目标机实际运行时创建本地 Ed25519 设备身份；重新构建或替换安装包不会把现有设备私钥打包进去，也不会自动重置已授权身份。

后台 Device Agent 仍然是独立于 Control Plane / Runner / Process Supervisor 的单独 LaunchAgent。这样普通 Runtime 即使被停止，管理通道仍可以继续在线，为后续远程 Runtime Start 保留入口。

## 验证内容

Verifier 会检查：

- 包 Schema、架构、信任等级与 Release Eligibility；
- Device Agent Entry Point 的可执行权限与 SHA-256；
- 内嵌 Runtime Manifest 的 SHA-256；
- Runtime Manifest 声明的所有关键文件哈希；
- Bundled Node、CLI、Device Agent 服务管理脚本、Runtime 生命周期脚本是否齐全；
- 包内符号链接是否越出 Package Root；
- 当前原生架构下，在独立 HOME、无系统 Node PATH 条件下真实执行 `status --json`。

针对当前架构的包可以运行：

```bash
npm run verify:macos-device-agent-package
```

## Phase 11.2 边界

P11.2 应继续补齐“公开分发/Bootstrap 合同”，而不是降低 P11.1 的验证要求。至少需要有真实 HTTPS 下载位置、带校验和的公共元数据、架构选择、Trust/Release Eligibility 判定，以及 Web Cockpit Onboarding Projection。只有这些都成为真实可用能力之后，`bootstrap.nativePackage.available` 才应该变为 `true`。
