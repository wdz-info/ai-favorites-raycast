import { Action, ActionPanel, Detail, Icon, showToast, Toast } from "@raycast/api";
import { useCallback, useMemo } from "react";
import { useResource } from "../hooks";
import { runtime, perform } from "../runtime";
import { providerNames } from "../providers/registry";
import { ErrorDetail, UtilityActions } from "./common";

export function SyncStatus() {
  const { sync, preferences } = useMemo(runtime, []);
  const load = useCallback(() => sync.read(), [sync]);
  const { value, error, loading, reload } = useResource(load, preferences.autoSync === false ? 0 : 15000);
  if (error) return <ErrorDetail error={error} reload={reload} />;
  const counts = ["codex", "kiro", "grok"]
    .map(
      (provider) =>
        `- ${providerNames[provider as keyof typeof providerNames]}：${value?.sessions.filter((s) => s.provider === provider).length || 0} 个会话；最近完整同步：${value?.lastSuccessfulSync[provider as "codex"] ? new Date(value.lastSuccessfulSync[provider as "codex"]!).toLocaleString() : "尚未成功"}`,
    )
    .join("\n");
  return (
    <Detail
      isLoading={loading}
      markdown={`# 历史同步\n\n自动同步：${preferences.autoSync === false ? "已关闭" : "已开启"}\n\n后台每分钟扫描，浏览界面打开时每 15 秒刷新。Raycast 退出或电脑休眠时暂停，下次运行补全。\n\n最近扫描：${value ? new Date(value.lastSyncAt).toLocaleString() : "尚未扫描"}\n\n${counts}\n\n本轮新增 ${value?.changes.added.length || 0}、变化 ${value?.changes.changed.length || 0}、移除 ${value?.changes.removed.length || 0}。\n\n已收藏的内容快照不会被同步覆盖或删除。${value?.warnings.length ? `\n\n## 读取提示\n\n${value.warnings.join("\n\n")}` : ""}`}
      actions={
        <ActionPanel>
          <Action
            title="立即同步"
            icon={Icon.ArrowClockwise}
            onAction={() =>
              perform(async () => {
                const result = await sync.sync();
                reload();
                await showToast({
                  title: "同步完成",
                  message: `${result.sessions.length} 个会话，${result.warnings.length} 条读取提示。`,
                  style: result.warnings.length ? Toast.Style.Failure : Toast.Style.Success,
                });
              })
            }
          />
          <UtilityActions reload={reload} />
        </ActionPanel>
      }
    />
  );
}
