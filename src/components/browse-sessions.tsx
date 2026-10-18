import { Action, ActionPanel, Detail, Icon, List } from "@raycast/api";
import { useCallback, useMemo, useState } from "react";
import { basename } from "node:path";
import { fileDraft, messageDraft, sessionDraft } from "../core/favorite-service";
import { fileMarkdown, sessionMarkdown } from "../core/markdown";
import { Session, SessionFile, SessionSummary } from "../core/types";
import { useResource } from "../hooks";
import { providerNames, sessionKey } from "../providers/registry";
import { SyncStatus } from "./sync-status";
import { runtime } from "../runtime";
import { ErrorDetail, favoriteShortcut, UtilityActions, WarningDetail } from "./common";
import { FavoriteEditor } from "./favorite-editor";
import { QuickSave } from "./quick-save";
import { FilePicker } from "./file-picker";
import { SourceActions } from "./source-actions";

function FilePreview({ file, session, onSaved }: { file: SessionFile; session: Session; onSaved?: () => void }) {
  const load = useCallback(() => fileDraft(file.path, session, file), [file, session]);
  const { value, loading, error, reload } = useResource(load);
  if (error) return <ErrorDetail error={error} reload={reload} />;
  return (
    <Detail
      isLoading={loading}
      markdown={value ? fileMarkdown(value.content, file.path) : undefined}
      actions={
        <ActionPanel>
          {value && (
            <Action.Push
              title="添加到收藏夹"
              icon={Icon.Star}
              shortcut={favoriteShortcut}
              target={<FavoriteEditor onSaved={onSaved} loadDraft={async () => value} />}
            />
          )}
          {value && <QuickSave draft={value} onSaved={onSaved} />}
          {value && <Action.CopyToClipboard title="复制文件内容" content={value.content} />}
          <UtilityActions reload={reload} />
        </ActionPanel>
      }
    />
  );
}

export function SessionContents({
  summary,
  onSaved,
  focusMessageId,
}: {
  summary: SessionSummary;
  onSaved?: () => void;
  focusMessageId?: string;
}) {
  const [selected, setSelected] = useState<string | undefined>(focusMessageId);
  const { provider, sync, preferences } = useMemo(runtime, []);
  const load = useCallback(async () => {
    const catalog = preferences.autoSync === false ? await sync.read() : await sync.sync();
    const current = catalog?.sessions.find((s) => sessionKey(s) === sessionKey(summary)) || summary;
    return provider.readSession(current);
  }, [provider, sync, preferences.autoSync, summary]);
  const { value: session, loading, error, reload } = useResource(load, preferences.autoSync === false ? 0 : 15000);
  const [view, setView] = useState("all");
  if (error) return <ErrorDetail error={error} reload={reload} />;
  const generalActions = session ? (
    <>
      <ActionPanel.Section title="会话">
        <Action.Push
          title="收藏整个会话"
          icon={Icon.Star}
          shortcut={{ modifiers: ["cmd", "shift"], key: "return" }}
          target={<FavoriteEditor onSaved={onSaved} loadDraft={async () => sessionDraft(session)} />}
        />
        <Action.Push
          title="阅读完整对话"
          icon={Icon.Document}
          target={<Detail markdown={sessionMarkdown(session)} />}
        />
        <Action.Push
          title="收藏本项目文件"
          icon={Icon.NewDocument}
          target={<FilePicker onSaved={onSaved} session={session} />}
        />
        {session.warnings.length > 0 && (
          <Action.Push
            title="查看读取提示"
            icon={Icon.Warning}
            target={<WarningDetail warnings={session.warnings} />}
          />
        )}
      </ActionPanel.Section>
      <SourceActions
        item={{
          sessionId: session.id,
          provider: session.provider,
          source: session.source || { logPath: session.logPath },
          projectPath: session.projectPath,
        }}
        openCodexLinks={preferences.openCodexLinks}
      />
      <UtilityActions reload={reload} />
    </>
  ) : (
    <UtilityActions reload={reload} />
  );
  return (
    <List
      isLoading={loading}
      isShowingDetail
      selectedItemId={selected}
      onSelectionChange={(id) => setSelected(id || undefined)}
      navigationTitle={summary.title}
      searchBarPlaceholder="搜索回复和文件路径…"
      searchBarAccessory={
        <List.Dropdown tooltip="内容类型" onChange={setView} value={view}>
          <List.Dropdown.Item title="全部内容" value="all" />
          <List.Dropdown.Item title="AI 回复" value="replies" />
          <List.Dropdown.Item title="文件" value="files" />
        </List.Dropdown>
      }
      actions={<ActionPanel>{generalActions}</ActionPanel>}
    >
      <List.EmptyView
        title={loading ? "正在读取会话…" : "没有匹配的内容"}
        description="在操作菜单中收藏会话，或选择本项目的文件。"
      />
      {session?.warnings.length ? (
        <List.Section title="读取提示">
          <List.Item
            title="部分历史记录暂时无法读取"
            icon={Icon.Warning}
            detail={<List.Item.Detail markdown={session.warnings.join("\n\n")} />}
            actions={<ActionPanel>{generalActions}</ActionPanel>}
          />
        </List.Section>
      ) : null}
      {view !== "files" && (
        <List.Section title="对话内容" subtitle={`${session?.messages.length || 0} 条消息`}>
          {session?.messages
            .filter((m) => view !== "replies" || m.role === "assistant")
            .map((m) => {
              const draft = m.role === "assistant" ? messageDraft(session, m) : undefined;
              const markdown = `${draft?.context?.question ? `## 用户问题\n\n${draft.context.question}\n\n---\n\n` : ""}${m.content}`;
              return (
                <List.Item
                  key={m.id}
                  id={m.id}
                  title={m.content.replace(/\s+/g, " ").slice(0, 100)}
                  icon={m.role === "assistant" ? Icon.Message : Icon.Person}
                  keywords={[m.content, draft?.context?.question || ""]}
                  accessories={[{ text: m.role === "assistant" ? "AI 回复" : "用户" }, { text: `第 ${m.line} 行` }]}
                  detail={<List.Item.Detail markdown={markdown} />}
                  actions={
                    <ActionPanel>
                      <Action.Push
                        title="阅读消息"
                        icon={Icon.Document}
                        target={
                          <Detail
                            markdown={markdown}
                            actions={
                              <ActionPanel>
                                {draft && (
                                  <Action.Push
                                    title="添加到收藏夹"
                                    icon={Icon.Star}
                                    shortcut={favoriteShortcut}
                                    target={<FavoriteEditor onSaved={onSaved} loadDraft={async () => draft} />}
                                  />
                                )}
                                <Action.CopyToClipboard title="复制消息" content={m.content} />
                                <SourceActions
                                  item={{
                                    provider: session.provider,
                                    sessionId: session.id,
                                    source: m.source || { logPath: session.logPath, line: m.line },
                                  }}
                                  openCodexLinks={preferences.openCodexLinks}
                                />
                              </ActionPanel>
                            }
                          />
                        }
                      />
                      {draft && <QuickSave draft={draft} onSaved={onSaved} />}
                      {draft && (
                        <Action.Push
                          title="收藏这条回复"
                          icon={Icon.Star}
                          shortcut={favoriteShortcut}
                          target={<FavoriteEditor onSaved={onSaved} loadDraft={async () => draft} />}
                        />
                      )}
                      <Action.CopyToClipboard title="复制消息" content={m.content} />
                      <SourceActions
                        item={{
                          provider: session.provider,
                          sessionId: session.id,
                          source: m.source || { logPath: session.logPath, line: m.line },
                        }}
                        openCodexLinks={preferences.openCodexLinks}
                      />
                      {generalActions}
                    </ActionPanel>
                  }
                />
              );
            })}
        </List.Section>
      )}
      {view !== "replies" && (
        <List.Section title="关联文件" subtitle="当前磁盘版本">
          {session?.files.map((file) => (
            <List.Item
              key={file.path}
              title={basename(file.path)}
              subtitle={file.path}
              icon={Icon.Document}
              keywords={[file.path]}
              accessories={[{ tag: file.origin === "patch" ? "文件修改" : "文件引用" }]}
              detail={
                <List.Item.Detail
                  markdown={`# ${basename(file.path)}\n\n${file.path}\n\n${file.origin === "patch" ? "来自文件修改操作。" : "来自明确的文件引用。"}\n\n预览或收藏当前磁盘文件版本。不会根据修改补丁重建历史文件内容。`}
                />
              }
              actions={
                <ActionPanel>
                  <Action.Push
                    title="预览当前文件"
                    icon={Icon.Eye}
                    target={<FilePreview onSaved={onSaved} file={file} session={session} />}
                  />
                  <Action.Push
                    title="收藏这个文件版本"
                    icon={Icon.Star}
                    shortcut={favoriteShortcut}
                    target={<FavoriteEditor onSaved={onSaved} loadDraft={() => fileDraft(file.path, session, file)} />}
                  />
                  <Action.CopyToClipboard title="复制文件路径" content={file.path} />
                  {generalActions}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}

export function BrowseSessions({
  mode = "browse",
  onSaved,
}: {
  mode?: "browse" | "session" | "message";
  onSaved?: () => void;
}) {
  const { provider, sync, preferences } = useMemo(runtime, []);
  const load = useCallback(() => sync.listSessions(), [sync]);
  const { value, error, loading, reload } = useResource(load, preferences.autoSync === false ? 0 : 15000);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("all");
  const [agent, setAgent] = useState("all");
  if (error) return <ErrorDetail error={error} reload={reload} />;
  const projects = [...new Set(value?.sessions.map((s) => s.projectPath || "") || [])].sort();
  const sessions = value?.sessions.filter(
    (s) =>
      (agent === "all" || s.provider === agent) &&
      (project === "all" || JSON.stringify(s.projectPath || "") === project) &&
      [s.title, s.id, s.projectPath || ""].join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <List
      isLoading={loading}
      filtering={false}
      onSearchTextChange={setQuery}
      searchText={query}
      navigationTitle={mode === "message" ? "选择会话，再选择 AI 回复" : "浏览 AI 会话"}
      searchBarPlaceholder="搜索会话、ID 或项目…"
      searchBarAccessory={
        <List.Dropdown tooltip="项目" value={project} onChange={setProject}>
          <List.Dropdown.Item title="全部项目" value="all" />
          {projects.map((p) => (
            <List.Dropdown.Item key={p} title={p || "无项目"} value={JSON.stringify(p)} />
          ))}
        </List.Dropdown>
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section title="来源 Agent">
            {(["all", "codex", "kiro", "grok"] as const).map((id) => (
              <Action
                key={id}
                title={id === "all" ? "全部 Agent" : `仅看 ${providerNames[id]}`}
                onAction={() => setAgent(id)}
              />
            ))}
            <Action.Push title="同步状态" target={<SyncStatus />} />
          </ActionPanel.Section>
          <UtilityActions reload={reload} />
          {value?.warnings.length ? (
            <Action.Push title="查看读取提示" target={<WarningDetail warnings={value.warnings} />} />
          ) : null}
        </ActionPanel>
      }
    >
      <List.EmptyView
        title={loading ? "正在发现 AI 会话…" : "没有匹配的会话"}
        description="检查设置中的历史目录，或等待自动同步发现新会话。"
      />
      {value?.warnings.length ? (
        <List.Section title="读取提示">
          <List.Item
            title={`${value.warnings.length} 条历史读取提示`}
            icon={Icon.Warning}
            actions={
              <ActionPanel>
                <Action.Push title="查看提示" target={<WarningDetail warnings={value.warnings} />} />
                <UtilityActions reload={reload} />
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}
      <List.Section
        title="AI 会话"
        subtitle={`${sessions?.length || 0} · ${agent === "all" ? "全部 Agent" : providerNames[agent as "codex"]}`}
      >
        {sessions?.map((session) => (
          <List.Item
            key={sessionKey(session)}
            title={session.title}
            subtitle={`${providerNames[session.provider]}${session.projectPath ? ` · ${basename(session.projectPath)}` : ""}`}
            icon={Icon.Message}
            accessories={[...(session.archived ? [{ tag: "已归档" }] : []), { date: new Date(session.updatedAt) }]}
            actions={
              <ActionPanel>
                {mode === "session" ? (
                  <Action.Push
                    title="收藏这个会话"
                    icon={Icon.Star}
                    shortcut={favoriteShortcut}
                    target={
                      <FavoriteEditor
                        onSaved={onSaved}
                        loadDraft={async () => sessionDraft(await provider.readSession(session))}
                      />
                    }
                  />
                ) : null}
                <Action.Push
                  title="浏览回复与文件"
                  icon={Icon.List}
                  target={<SessionContents onSaved={onSaved} summary={session} />}
                />
                {mode !== "session" && (
                  <Action.Push
                    title="收藏这个会话"
                    icon={Icon.Star}
                    shortcut={favoriteShortcut}
                    target={
                      <FavoriteEditor
                        onSaved={onSaved}
                        loadDraft={async () => sessionDraft(await provider.readSession(session))}
                      />
                    }
                  />
                )}
                <QuickSave
                  loadDraft={async () => sessionDraft(await provider.readSession(session))}
                  onSaved={onSaved}
                />
                <SourceActions
                  item={{
                    provider: session.provider,
                    sessionId: session.id,
                    source: session.source || { logPath: session.logPath },
                    projectPath: session.projectPath,
                  }}
                  openCodexLinks={preferences.openCodexLinks}
                />
                <UtilityActions reload={reload} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
