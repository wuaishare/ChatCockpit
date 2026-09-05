import type { LocaleCode } from "../i18n";

export interface RuntimeCopy {
  title: string;
  description: string;
  currentTitle: string;
  currentDescription: string;
  health: string;
  mode: string;
  build: string;
  exposure: string;
  healthy: string;
  unavailable: string;
  public: string;
  localOnly: string;
  targetsTitle: string;
  targetsDescription: string;
  refresh: string;
  platform: string;
  local: string;
  remote: string;
  lifecycle: string;
  runtimeState: string;
  running: string;
  stopped: string;
  unknown: string;
  unsupported: string;
  start: string;
  stop: string;
  restart: string;
  stopTitle: string;
  stopDescription: string;
  restartTitle: string;
  restartDescription: string;
  confirm: string;
  cancel: string;
  noTargets: string;
  loadFailed: string;
  actionFailed: string;
  reasonReady: string;
  reasonLocalHost: string;
  reasonOffline: string;
  reasonAgentUpdate: string;
  reasonNotAttested: string;
  reasonNotImplemented: string;
  reasonForbidden: string;
  reasonNoPath: string;
  reasonApproval: string;
  liveExecutionTitle: string;
  liveExecutionDescription: string;
  noLiveExecution: string;
  noLiveExecutionDescription: string;
  processTerminate: string;
  processTerminateTitle: string;
  processTerminateDescription: string;
  processTerminateFailed: string;
  processControlUnavailable: string;
  processInputPlaceholder: string;
  processInputSend: string;
  processInputFailed: string;
  processInputClose: string;
  processInputCloseTitle: string;
  processInputCloseDescription: string;
  processResize: string;
  processResizeFailed: string;
  processPty: string;
  processStream: string;
  processConsoleTitle: string;
  processConsoleDescription: string;
  sessionConsoleTitle: string;
  sessionConsoleDescription: string;
  sessionConsoleDevice: string;
  sessionConsoleSession: string;
  sessionConsoleExecutor: string;
  sessionConsoleWaitingOutput: string;
  sessionConsoleOutputUnavailable: string;
  sessionConsoleAdHoc: string;
  sessionConsoleLive: string;
  sessionConsoleRecent: string;
  unknownProject: string;
}

const zhCN: RuntimeCopy = {
  title: "运行时",
  description: "查看当前 Runtime 健康状态，并从同一工作台管理具备合法执行路径的目标 Runtime。",
  currentTitle: "当前 Runtime",
  currentDescription: "这里显示当前控制台连接到的 Runtime API 事实；本机生命周期执行仍需要真实的本机 Host 能力。",
  health: "API 健康",
  mode: "模式",
  build: "构建",
  exposure: "网络暴露",
  healthy: "健康",
  unavailable: "不可用",
  public: "已公网暴露",
  localOnly: "未公网暴露",
  targetsTitle: "Runtime 目标",
  targetsDescription: "可用性来自 Product Action / Device capability 真源；任何 Surface 都不会自行推断或伪造 Machine Authority。",
  refresh: "刷新",
  platform: "平台",
  local: "本机",
  remote: "远端",
  lifecycle: "生命周期可用性",
  runtimeState: "Runtime 状态",
  running: "运行中",
  stopped: "已停止",
  unknown: "未知",
  unsupported: "不支持",
  start: "启动",
  stop: "停止",
  restart: "重启",
  stopTitle: "停止目标 Runtime？",
  stopDescription: "这会停止所选设备上的受管 Runtime。",
  restartTitle: "重启目标 Runtime？",
  restartDescription: "这会通过目标 Device Agent 的受治理 lifecycle RPC 重启 Runtime。",
  confirm: "确认",
  cancel: "取消",
  noTargets: "当前没有可投影的 Runtime 目标。",
  loadFailed: "Runtime 状态加载失败",
  actionFailed: "Runtime 生命周期操作失败",
  reasonReady: "可执行",
  reasonLocalHost: "需要本机 ChatCockpit Host",
  reasonOffline: "目标设备离线",
  reasonAgentUpdate: "需要更新 Device Agent",
  reasonNotAttested: "当前 Agent 未证明 Runtime 管理能力",
  reasonNotImplemented: "目标尚未实现 Runtime 管理能力",
  reasonForbidden: "当前策略不允许",
  reasonNoPath: "当前没有合法执行路径",
  reasonApproval: "需要审批",
  liveExecutionTitle: "实时会话与执行",
  liveExecutionDescription: "跨项目查看 MCP 连接、Task / Session、Runtime 活动与本机命令进程；每条执行保留 Project、Repo 与 Session provenance。",
  noLiveExecution: "当前没有实时执行",
  noLiveExecutionDescription: "新的 MCP 调用、Task / Session 或本机进程启动后会自动出现在这里。",
  processTerminate: "终止进程",
  processTerminateTitle: "终止这个受管进程？",
  processTerminateDescription: "这会向该工作区受管进程请求终止；不会终止 Host Process 或其他会话中的进程。",
  processTerminateFailed: "进程终止请求失败，可安全重试。",
  processControlUnavailable: "当前没有可验证的本机进程控制路径。",
  processInputPlaceholder: "向当前进程输入内容，回车发送",
  processInputSend: "发送",
  processInputFailed: "进程输入发送失败；内容已保留，可安全重试。",
  processInputClose: "EOF",
  processInputCloseTitle: "关闭这个进程的标准输入？",
  processInputCloseDescription: "这相当于关闭当前进程的 stdin；部分命令会因此结束。",
  processResize: "适配终端",
  processResizeFailed: "终端尺寸同步失败，可安全重试。",
  processPty: "PTY",
  processStream: "输出流",
  processConsoleTitle: "命令与进程",
  processConsoleDescription: "按会话聚合受管命令的实时与保留输出；这里用于观察一次性命令/进程，不再冒充持久 PTY 终端。",
  sessionConsoleTitle: "会话终端",
  sessionConsoleDescription: "每个活跃开发会话可拥有一个由独立 Process Supervisor 持有的真实 PTY；4318 控制台关闭或重启后可重新附着到同一终端并继续读取 scrollback、输入与尺寸状态。",
  sessionConsoleDevice: "设备",
  sessionConsoleSession: "会话",
  sessionConsoleExecutor: "执行器",
  sessionConsoleWaitingOutput: "等待进程输出…",
  sessionConsoleOutputUnavailable: "当前没有可显示的保留输出；进程与会话元数据仍然保留。",
  sessionConsoleAdHoc: "临时执行",
  sessionConsoleLive: "实时",
  sessionConsoleRecent: "最近",
  unknownProject: "未关联项目"
};

const enUS: RuntimeCopy = {
  title: "Runtime",
  description: "Inspect current Runtime health and manage target Runtimes that have a legitimate execution path from one workbench.",
  currentTitle: "Current Runtime",
  currentDescription: "This is the Runtime API truth for the current Cockpit connection; local lifecycle execution still requires a real local Host capability.",
  health: "API health",
  mode: "Mode",
  build: "Build",
  exposure: "Network exposure",
  healthy: "Healthy",
  unavailable: "Unavailable",
  public: "Publicly exposed",
  localOnly: "Not publicly exposed",
  targetsTitle: "Runtime targets",
  targetsDescription: "Availability comes from Product Action and Device capability truth; no Surface infers or fabricates Machine Authority on its own.",
  refresh: "Refresh",
  platform: "Platform",
  local: "Local",
  remote: "Remote",
  lifecycle: "Lifecycle availability",
  runtimeState: "Runtime state",
  running: "Running",
  stopped: "Stopped",
  unknown: "Unknown",
  unsupported: "Unsupported",
  start: "Start",
  stop: "Stop",
  restart: "Restart",
  stopTitle: "Stop target Runtime?",
  stopDescription: "This stops the managed Runtime on the selected Device.",
  restartTitle: "Restart target Runtime?",
  restartDescription: "This restarts Runtime through the target Device Agent's governed lifecycle RPC.",
  confirm: "Confirm",
  cancel: "Cancel",
  noTargets: "No Runtime targets are currently projected.",
  loadFailed: "Failed to load Runtime status",
  actionFailed: "Runtime lifecycle action failed",
  reasonReady: "Executable",
  reasonLocalHost: "Requires a local ChatCockpit Host",
  reasonOffline: "Target Device is offline",
  reasonAgentUpdate: "Device Agent update required",
  reasonNotAttested: "Current Agent did not attest Runtime management capability",
  reasonNotImplemented: "Target does not implement Runtime management yet",
  reasonForbidden: "Current policy forbids this action",
  reasonNoPath: "No legitimate execution path is available",
  reasonApproval: "Approval required",
  liveExecutionTitle: "Live sessions and execution",
  liveExecutionDescription: "Observe MCP connections, Tasks / Sessions, Runtime activity, and local command processes across Projects with Project, Repo, and Session provenance.",
  noLiveExecution: "No live execution",
  noLiveExecutionDescription: "New MCP calls, Tasks / Sessions, and local processes will appear here automatically.",
  processTerminate: "Terminate process",
  processTerminateTitle: "Terminate this managed process?",
  processTerminateDescription: "This requests termination of this workspace-managed process only. Host Processes and processes owned by other sessions are not controlled through this action.",
  processTerminateFailed: "Process termination request failed. It is safe to retry.",
  processControlUnavailable: "No verified local process-control path is available.",
  processInputPlaceholder: "Type process input and press Enter to send",
  processInputSend: "Send",
  processInputFailed: "Process input failed. The draft is preserved and can be retried safely.",
  processInputClose: "EOF",
  processInputCloseTitle: "Close stdin for this process?",
  processInputCloseDescription: "This closes the current process stdin. Some commands will exit as a result.",
  processResize: "Fit terminal",
  processResizeFailed: "Terminal resize failed. It is safe to retry.",
  processPty: "PTY",
  processStream: "Stream",
  processConsoleTitle: "Commands and processes",
  processConsoleDescription: "Observe live and retained output from managed one-shot commands grouped by session. This is process observability, not a persistent PTY terminal.",
  sessionConsoleTitle: "Session terminals",
  sessionConsoleDescription: "Each active development session can own a real PTY held by the independent Process Supervisor. The same terminal can be reattached after the 4318 control plane closes or restarts, retaining scrollback, input, and terminal size state.",
  sessionConsoleDevice: "Device",
  sessionConsoleSession: "Session",
  sessionConsoleExecutor: "Executor",
  sessionConsoleWaitingOutput: "Waiting for process output…",
  sessionConsoleOutputUnavailable: "No retained output is currently available. Process and session metadata remain available.",
  sessionConsoleAdHoc: "Ad-hoc execution",
  sessionConsoleLive: "Live",
  sessionConsoleRecent: "Recent",
  unknownProject: "Unassociated project"
};

export function getRuntimeCopy(locale: LocaleCode): RuntimeCopy {
  return locale === "zh-CN" ? zhCN : enUS;
}
