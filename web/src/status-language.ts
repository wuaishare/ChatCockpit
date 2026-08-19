import type { LocaleCode } from "./i18n";

export type OperationalStatusTone = "success" | "processing" | "warning" | "error" | "default";

const STATUS_LABELS: Record<string, Record<LocaleCode, string>> = {
  active: { "zh-CN": "活跃", "en-US": "Active" },
  archived: { "zh-CN": "已归档", "en-US": "Archived" },
  ready: { "zh-CN": "就绪", "en-US": "Ready" },
  missing: { "zh-CN": "缺失", "en-US": "Missing" },
  blocked: { "zh-CN": "受阻", "en-US": "Blocked" },
  backlog: { "zh-CN": "待规划", "en-US": "Backlog" },
  queued: { "zh-CN": "排队中", "en-US": "Queued" },
  "in-progress": { "zh-CN": "进行中", "en-US": "In progress" },
  review: { "zh-CN": "待审查", "en-US": "In review" },
  completed: { "zh-CN": "已完成", "en-US": "Completed" },
  cancelled: { "zh-CN": "已取消", "en-US": "Cancelled" },
  draft: { "zh-CN": "草稿", "en-US": "Draft" },
  approved: { "zh-CN": "已批准", "en-US": "Approved" },
  superseded: { "zh-CN": "已取代", "en-US": "Superseded" },
  idle: { "zh-CN": "空闲", "en-US": "Idle" },
  running: { "zh-CN": "运行中", "en-US": "Running" },
  paused: { "zh-CN": "已暂停", "en-US": "Paused" },
  "waiting-approval": { "zh-CN": "等待批准", "en-US": "Waiting approval" },
  "handoff-ready": { "zh-CN": "可交接", "en-US": "Handoff ready" },
  failed: { "zh-CN": "失败", "en-US": "Failed" },
  interrupted: { "zh-CN": "已中断", "en-US": "Interrupted" },
  accepted: { "zh-CN": "已接受", "en-US": "Accepted" },
  passed: { "zh-CN": "通过", "en-US": "Passed" },
  skipped: { "zh-CN": "已跳过", "en-US": "Skipped" },
  "not-run": { "zh-CN": "未执行", "en-US": "Not run" },
  verified: { "zh-CN": "已验证", "en-US": "Verified" },
  incomplete: { "zh-CN": "不完整", "en-US": "Incomplete" },
  partial: { "zh-CN": "部分可用", "en-US": "Partial" },
  degraded: { "zh-CN": "降级", "en-US": "Degraded" },
  pending: { "zh-CN": "待处理", "en-US": "Pending" },
  stale: { "zh-CN": "已过期", "en-US": "Stale" },
  released: { "zh-CN": "已释放", "en-US": "Released" },
  expired: { "zh-CN": "已失效", "en-US": "Expired" },
  revoked: { "zh-CN": "已撤销", "en-US": "Revoked" },
  collecting: { "zh-CN": "采集中", "en-US": "Collecting" },
  complete: { "zh-CN": "完整", "en-US": "Complete" },
  prepared: { "zh-CN": "已准备", "en-US": "Prepared" },
  applied: { "zh-CN": "已应用", "en-US": "Applied" },
  unavailable: { "zh-CN": "不可用", "en-US": "Unavailable" },
  "auth-required": { "zh-CN": "需要认证", "en-US": "Authentication required" },
  "version-unsupported": { "zh-CN": "版本不受支持", "en-US": "Version unsupported" },
  "protocol-incompatible": { "zh-CN": "协议不兼容", "en-US": "Protocol incompatible" },
  unsupported: { "zh-CN": "不支持", "en-US": "Unsupported" },
  unknown: { "zh-CN": "未知", "en-US": "Unknown" },
  responded: { "zh-CN": "已响应", "en-US": "Responded" },
  resolved: { "zh-CN": "已解决", "en-US": "Resolved" },
  starting: { "zh-CN": "启动中", "en-US": "Starting" },
  exited: { "zh-CN": "已退出", "en-US": "Exited" },
  terminated: { "zh-CN": "已终止", "en-US": "Terminated" },
  rejected: { "zh-CN": "已拒绝", "en-US": "Rejected" }
};

export function getOperationalStatusLabel(locale: LocaleCode, status: string): string {
  return STATUS_LABELS[status]?.[locale] ?? status;
}

export function getOperationalStatusTone(status: string): OperationalStatusTone {
  if (["ready", "approved", "completed", "accepted", "passed", "verified", "complete", "applied"].includes(status)) {
    return "success";
  }
  if (["active", "running", "in-progress", "prepared", "collecting", "starting"].includes(status)) {
    return "processing";
  }
  if (["partial", "degraded", "blocked", "missing", "incomplete", "waiting-approval", "review", "pending", "stale", "paused"].includes(status)) {
    return "warning";
  }
  if (["failed", "rejected", "revoked", "expired", "terminated", "interrupted"].includes(status)) {
    return "error";
  }
  return "default";
}
