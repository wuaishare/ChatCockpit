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
  'new EventSource("/api/activities/stream", { withCredentials: true })',
  'source.addEventListener("activity.snapshot"',
  'source.addEventListener("activity.event"',
  "source.close()",
  "activity.authorizationGrantId",
  "activity.traceId",
  "activity.workerInstanceId",
  "activity.directProcessSummary",
  "activity.controls.interrupt",
  "activity.runtime.runRevision",
  "interruptCodexRuntimeTurn",
  "crypto.randomUUID()",
  "Popconfirm",
  "slice(0, 6)"
]) {
  assert.equal(panel.includes(required), true, `Operational Activity UI must retain ${required}`);
}

assert.match(api, /fetchOperationalActivities[\s\S]*?"\/api\/activities"/);
for (const metric of ["active", "running", "waitingApproval", "paused", "total"]) {
  assert.equal(
    panel.includes(`snapshot?.counts.${metric} ?? "—"`),
    true,
    `Unavailable Activity snapshots must never masquerade as a real zero for ${metric}`
  );
}
assert.equal(
  panel.includes("controlJob(") || panel.includes("/api/jobs/") || panel.includes("activity.controls.pause") || panel.includes("activity.controls.resume") || panel.includes("activity.controls.terminate"),
  false,
  "Operational Activity must not promote legacy Job process controls into the cockpit surface"
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
  'activityInterrupt: "中断运行"',
  'activityInterruptFailed: "中断运行失败，可安全重试。"',
  'activityTitle: "Operational Activity"',
  'activityLive: "Live"',
  'activityUnknownAuthority: "No grant bound"',
  'activityEventApprovalRequired: "Waiting for operator approval"',
  'activityEventRunCompleted: "Run completed"',
  'activityInterrupt: "Interrupt run"',
  'activityInterruptFailed: "Interrupt failed. It is safe to retry."'
]) {
  assert.equal(copy.includes(requiredCopy), true, `Activity UI i18n must retain ${requiredCopy}`);
}

process.stdout.write("VERIFY_RESOURCE_CENTER_ACTIVITY_UI_OK\n");
