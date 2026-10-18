import { Action, ActionPanel, Detail, Icon, List } from "@raycast/api";
import { HistoryHit } from "../core/history-index";
import { fileMarkdown } from "../core/markdown";
import { highlight } from "../core/text-search";
import { providerNames } from "../providers/registry";
import { QuickSave } from "./quick-save";
import { FavoriteEditor } from "./favorite-editor";
import { SourceActions } from "./source-actions";
import { SessionContents } from "./browse-sessions";

export function HistoryMessage({
  hit,
  onSaved,
  openCodexLinks,
}: {
  hit: HistoryHit;
  onSaved?: () => void;
  openCodexLinks: boolean;
}) {
  const { message, summary } = hit;
  const markdown = [
    `# ${summary.title}`,
    `来源：${providerNames[summary.provider]} · 消息 ${message.id} · 第 ${message.line} 行`,
    "历史索引中的原始文本，可在下方查看相邻消息或浏览完整会话。",
    `## 命中片段\n\n${highlight(hit.snippet, hit.matches)}`,
    hit.before ? `## 上一条消息\n\n${hit.before.content}` : "",
    `## 命中消息（原文）\n\n${message.content}`,
    hit.after ? `## 下一条消息\n\n${hit.after.content}` : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
  return (
    <Detail
      navigationTitle="历史消息定位"
      markdown={markdown}
      actions={
        <ActionPanel>
          {hit.draft && <QuickSave draft={hit.draft} onSaved={onSaved} />}
          {hit.draft && (
            <Action.Push
              title="编辑后收藏这条回复"
              target={<FavoriteEditor loadDraft={async () => hit.draft!} onSaved={onSaved} />}
            />
          )}
          <Action.CopyToClipboard title="复制命中消息" content={message.content} />
          <Action.Push
            title="浏览完整会话"
            target={<SessionContents summary={summary} focusMessageId={message.id} onSaved={onSaved} />}
          />
          <Action.Push
            title="按纯文本阅读命中消息"
            target={<Detail markdown={fileMarkdown(message.content, "txt")} />}
          />
          <SourceActions
            item={{
              provider: summary.provider,
              sessionId: summary.id,
              projectPath: summary.projectPath,
              source: message.source || { logPath: summary.logPath, line: message.line },
            }}
            openCodexLinks={openCodexLinks}
          />
        </ActionPanel>
      }
    />
  );
}
export function HistoryResults({
  hits,
  onSaved,
  openCodexLinks,
}: {
  hits: HistoryHit[];
  onSaved?: () => void;
  openCodexLinks: boolean;
}) {
  return (
    <List.Section title="历史会话（未自动加入收藏）" subtitle={`${hits.length} 个会话，每个显示最相关的消息`}>
      {hits.map((hit) => (
        <List.Item
          key={hit.key}
          id={`history:${hit.key}`}
          title={hit.summary.title}
          subtitle={`${providerNames[hit.summary.provider]} · ${hit.snippet.replace(/\s+/g, " ").slice(0, 80)}`}
          icon={Icon.Message}
          accessories={[{ text: `第 ${hit.message.line} 行` }]}
          detail={
            <List.Item.Detail
              markdown={`## 命中片段\n\n${highlight(hit.snippet, hit.matches)}\n\n项目：${hit.summary.projectPath || "无项目"}\n\n按 Enter 阅读消息与相邻上下文。`}
            />
          }
          actions={
            <ActionPanel>
              <Action.Push
                title="阅读命中消息与上下文"
                target={<HistoryMessage hit={hit} onSaved={onSaved} openCodexLinks={openCodexLinks} />}
              />
              {hit.draft && <QuickSave draft={hit.draft} onSaved={onSaved} />}
              <Action.CopyToClipboard title="复制命中消息" content={hit.message.content} />
            </ActionPanel>
          }
        />
      ))}
    </List.Section>
  );
}
