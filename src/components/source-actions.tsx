import { Action, ActionPanel, Detail, Icon, open } from "@raycast/api";
import { useCallback } from "react";
import { AIFavorite, SourceLocation } from "../core/types";
import { resumeCommand } from "../core/resume";
import { readSource } from "../core/source";
import { fileMarkdown } from "../core/markdown";
import { useResource } from "../hooks";
import { perform } from "../runtime";
import { ErrorDetail } from "./common";
import { materializeDirectory } from "../core/directory-snapshot";
import { runtime } from "../runtime";
import { join } from "node:path";

function SourceRecord({ source }: { source: SourceLocation }) {
  const load = useCallback(() => readSource(source), [source]);
  const { value, error, loading, reload } = useResource(load);
  if (error) return <ErrorDetail error={`${error}\n\n已收藏的快照仍可阅读。`} reload={reload} />;
  return (
    <Detail
      isLoading={loading}
      markdown={
        value
          ? `# 原始记录${source.format === "json" || source.format === "sqlite" ? "" : ` · 第 ${source.line || 1} 行`}\n\n${fileMarkdown(value, "record.json")}`
          : undefined
      }
      actions={
        <ActionPanel>
          {value && <Action.CopyToClipboard title="复制原始记录" content={value} />}
          {source.format !== "sqlite" && <Action.Open title="打开历史记录文件" target={source.logPath!} />}
        </ActionPanel>
      }
    />
  );
}

export function SourceActions({
  item,
  openCodexLinks,
}: {
  item: Pick<AIFavorite, "sessionId" | "source" | "filePath" | "projectPath" | "provider"> &
    Partial<Pick<AIFavorite, "directorySnapshot" | "snapshot">>;
  openCodexLinks: boolean;
}) {
  return (
    <ActionPanel.Section title="原始来源">
      {item.directorySnapshot && item.snapshot && (
        <Action
          title={item.directorySnapshot.entryPath ? "打开已收藏的网页快照" : "打开已收藏的目录快照"}
          icon={Icon.Folder}
          onAction={() =>
            perform(async () => {
              const target = await materializeDirectory(
                item.directorySnapshot!,
                item.snapshot!.sha256,
                runtime().store.directory,
              );
              await open(target);
            })
          }
        />
      )}
      {item.source.label && <Action.CopyToClipboard title="复制来源说明" content={item.source.label} />}
      {item.source.url && /^(https?:|codex:|obsidian:)\/\//i.test(item.source.url) && (
        <Action.Open title="打开原始链接" target={item.source.url} />
      )}
      {resumeCommand(item) && <Action.CopyToClipboard title="复制会话恢复命令" content={resumeCommand(item)!} />}
      {item.sessionId && item.provider === "kiro" && (
        <Action.CopyToClipboard title="复制 Kiro 会话 ID" content={item.sessionId} />
      )}
      {item.sessionId && item.provider === "codex" && openCodexLinks && (
        <Action
          title="在 Codex 中打开会话"
          icon={Icon.Message}
          onAction={() => perform(() => open(`codex://threads/${encodeURIComponent(item.sessionId!)}`))}
        />
      )}
      {item.source.logPath && (
        <Action.Push
          title={item.source.line || item.source.jsonPath ? "定位原始消息记录" : "查看会话源记录"}
          icon={Icon.MagnifyingGlass}
          target={<SourceRecord source={item.source} />}
        />
      )}
      {item.source.logPath && item.source.format !== "sqlite" && (
        <Action.Open title="打开历史记录文件" target={item.source.logPath} />
      )}
      {item.filePath && (
        <Action.Open
          title={item.directorySnapshot ? "打开当前原始目录入口" : "打开当前文件"}
          target={
            item.directorySnapshot?.entryPath ? join(item.filePath, item.directorySnapshot.entryPath) : item.filePath
          }
        />
      )}
      {item.filePath && <Action.ShowInFinder title="在访达中显示当前文件" path={item.filePath} />}
      {item.filePath && <Action.CopyToClipboard title="复制文件路径" content={item.filePath} />}
      {item.source.logPath && (
        <Action.CopyToClipboard
          title="复制源记录位置"
          content={`${item.source.logPath}${item.source.format === "sqlite" ? `#${item.source.table}/${item.source.recordKey}/${item.source.conversationId || ""}` : ""}${item.source.jsonPath ? `#/${item.source.jsonPath.join("/")}` : ""}${item.source.line ? `:${item.source.line}` : ""}`}
        />
      )}
      {item.projectPath && <Action.CopyToClipboard title="复制项目路径" content={item.projectPath} />}
    </ActionPanel.Section>
  );
}
