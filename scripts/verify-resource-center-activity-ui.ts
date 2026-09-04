import assert from "node:assert/strict";
import fs from "node:fs";

function read(relative: string): string {
  return fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

const panel = read("web/src/components/resources/OperationalActivityPanel.tsx");
const view = read("web/src/components/resources/ResourceCenterView.tsx");
const css = read("web/src/components/resources/resource-center.css");
const api = read("web/src/api.ts");
const copy = read("web/src/i18n/resources.ts");
const statusLanguage = read("web/src/status-language.ts");

for (const required of [
  "fetchOperationalActivities",
  "fetchExecutionTrajectory",
  "fetchContinuityCapsule",
  "fetchProductActions",
  "hasLocalProductActionPath",
  'new EventSource("/api/activities/stream", { withCredentials: true })',
  'source.addEventListener("activity.snapshot"',
  'source.addEventListener("activity.event"',
  "source.close()",
  "activity.authorizationGrantId",
  "activity.traceId",
  "activity.workerInstanceId",
  "activity.directProcessSummary",
  "activity.controls.interrupt",
  "activity.controls.pause",
  "activity.controls.resume",
  "activity.controls.terminate",
  'hasLocalProductActionPath(productActions, "job.control")',
  'hasLocalProductActionPath(productActions, "runtime.codex.turn.interrupt")',
  "disabled={Boolean(controllingAction) || !canControlJobs}",
  "disabled={interrupting || !canInterruptCodex}",
  "activity.runtime.runRevision",
  "activity.job?.processRevision",
  'activity.kind === "device-operation"',
  "activity.deviceOperation.deviceDisplayName",
  "activity.deviceOperation.actorType",
  'event.source === "device-operation"',
  "event.deviceAction",
  "event.deviceOperationState",
  "interruptCodexRuntimeTurn",
  "controlJob(",
  "crypto.randomUUID()",
  "Popconfirm",
  "slice(0, 6)",
  "activityTimelineShow",
  "resource-center__activity-timeline-list",
  'role="log"',
  "timelineByActivity",
  "navigator.clipboard.writeText(response.capsule.markdown)",
  "onCopyCapsule(activity)",
  "codex://threads/${encodeURIComponent(activity.runtime.externalThreadId)}"
]) {
  assert.equal(panel.includes(required), true, `Operational Activity UI must retain ${required}`);
}

assert.match(api, /fetchOperationalActivities[\s\S]*?"\/api\/activities"/);
assert.match(api, /fetchExecutionTrajectory[\s\S]*?`\/api\/trajectories\/\$\{encodeURIComponent\(activityId\)\}\?limit=50`/);
assert.match(api, /fetchContinuityCapsule[\s\S]*?`\/api\/continuity\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}\/capsule\$\{suffix\}`/);
for (const metric of ["active", "running", "waitingApproval", "paused", "total"]) {
  assert.equal(
    panel.includes(`snapshot?.counts.${metric} ?? "—"`),
    true,
    `Unavailable Activity snapshots must never masquerade as a real zero for ${metric}`
  );
}
assert.match(
  api,
  /controlJob[\s\S]*?`\/api\/jobs\/\$\{encodeURIComponent\(id\)\}\/control`/,
  "Operational Activity must reuse the stable revision-bound Job control contract"
);
assert.equal(
  panel.includes("control/${action}") || panel.includes("/api/jobs/${encodeURIComponent(id)}/${action}"),
  false,
  "Operational Activity must never fall back to the deprecated legacy Job control path"
);
for (const requiredControl of [
  "expectedRevision: job.processRevision",
  "idempotencyKey",
  "activityTerminateConfirmTitle",
  "onJobControl(activity, \"pause\")",
  "onJobControl(activity, \"resume\")",
  "onJobControl(activity, \"terminate\")"
]) {
  assert.equal(panel.includes(requiredControl), true, `Activity Job controls must retain ${requiredControl}`);
}
assert.match(
  panel,
  /if \(!canControlJobs \|\| !job\?\.processRevision \|\| !activity\.controls\[action\]\) return;/,
  "Activity Job control handlers must fail closed without a verified Product Action path"
);
assert.match(
  panel,
  /if \(!canInterruptCodex \|\| !activity\.controls\.interrupt/,
  "Activity Codex interrupt handlers must fail closed without a verified Product Action path"
);
assert.match(
  api,
  /interruptCodexRuntimeTurn[\s\S]*?"\/api\/runtime\/codex\/turns\/interrupt"/,
  "Operational Activity must reuse the governed Codex interrupt contract"
);
assert.equal(
  panel.includes("stdout") || panel.includes("privatePath") || panel.includes("instructions"),
  false,
  "Activity cards must not depend on private execution payloads"
);
assert.equal(
  panel.includes("latestEvent.method"),
  false,
  "Activity cards must render normalized product event kinds instead of runtime-native methods"
);

const activityIndex = view.indexOf("<OperationalActivityPanel");
const providerIndex = view.indexOf('className="resource-center__management panel"');
const profileIndex = view.indexOf('className="resource-center__profiles panel"');
assert.ok(providerIndex >= 0 && activityIndex > providerIndex && profileIndex > activityIndex);

for (const requiredCss of [
  "resource-center__activity-grid",
  "resource-center__activity-card--running",
  "resource-center__activity-metrics",
  "resource-center__activity-card-actions",
  "resource-center__activity-timeline-list",
  "resource-center__activity-timeline-item",
  "resource-center__activity-recent-list",
  "@media (max-width: 650px)",
  "@media (prefers-reduced-motion: reduce)"
]) {
  assert.equal(css.includes(requiredCss), true, `Activity UI CSS must retain ${requiredCss}`);
}

for (const requiredStatus of [
  'paused: { "zh-CN": "已暂停", "en-US": "Paused" }',
  'interrupted: { "zh-CN": "已中断", "en-US": "Interrupted" }'
]) {
  assert.equal(
    statusLanguage.includes(requiredStatus),
    true,
    `Operational status language must retain ${requiredStatus}`
  );
}

for (const requiredCopy of [
  'activityTitle: "运行活动"',
  'activityLive: "实时"',
  'activityUnknownAuthority: "未绑定授权"',
  'activityEventApprovalRequired: "等待操作员批准"',
  'activityEventRunCompleted: "运行已完成"',
  'activityEventJobPaused: "作业已暂停"',
  'activityEventJobResumed: "作业已继续"',
  'activityEventJobTerminated: "作业已终止"',
  'activityKindDeviceOperation: "设备运行栈操作"',
  'activityEventDeviceOperation: "设备运行栈状态已更新"',
  'activityPause: "暂停作业"',
  'activityResume: "继续作业"',
  'activityTerminate: "终止作业"',
  'activityInterrupt: "中断运行"',
  'activityInterruptFailed: "中断运行失败，可安全重试。"',
  'activityControlUnavailable: "当前没有可验证的本机执行路径；运行活动仍可正常查看。"',
  'activityTitle: "Operational Activity"',
  'activityLive: "Live"',
  'activityUnknownAuthority: "No grant bound"',
  'activityEventApprovalRequired: "Waiting for operator approval"',
  'activityEventRunCompleted: "Run completed"',
  'activityEventJobPaused: "Job paused"',
  'activityEventJobResumed: "Job resumed"',
  'activityEventJobTerminated: "Job terminated"',
  'activityKindDeviceOperation: "Device Runtime operation"',
  'activityEventDeviceOperation: "Device Runtime state updated"',
  'activityPause: "Pause job"',
  'activityResume: "Resume job"',
  'activityTerminate: "Terminate job"',
  'activityInterrupt: "Interrupt run"',
  'activityInterruptFailed: "Interrupt failed. It is safe to retry."',
  'activityControlUnavailable: "No verified local execution path is available. Operational Activity remains readable."',
  'activityTimelineShow: "执行轨迹"',
  'activityTimelineTitle: "执行轨迹"',
  'activityCopyCapsule: "复制接力胶囊"',
  'activityOpenCodex: "在 Codex 中打开"',
  'activityTimelineShow: "Execution trajectory"',
  'activityTimelineTitle: "Execution trajectory"',
  'activityCopyCapsule: "Copy continuity capsule"',
  'activityOpenCodex: "Open in Codex"'
]) {
  assert.equal(copy.includes(requiredCopy), true, `Activity UI i18n must retain ${requiredCopy}`);
}

process.stdout.write("VERIFY_RESOURCE_CENTER_ACTIVITY_UI_OK\n");
