import { AIFavorite } from "./types";
import { codeBlocks, favoriteMarkdown, fileMarkdown, heading } from "./markdown";
import { providerNames } from "../providers/registry";

export const verificationLabels = { unverified: "未验证", verified: "已验证", invalid: "已失效" };

export function verificationText(f: AIFavorite): string {
  const v = f.verification;
  return [
    verificationLabels[v?.status || "unverified"],
    v?.project && `项目：${v.project}`,
    v?.version && `版本：${v.version}`,
    v?.date && `日期：${v.date}`,
    v?.note,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function sourceMarkdown(f: AIFavorite): string {
  const s = f.source;
  return [
    `- Agent：${providerNames[f.provider]}`,
    s.label && `- 来源说明：${heading(s.label)}`,
    s.application && `- 应用：${heading(s.application)}`,
    s.url && `- 原始链接：${heading(s.url)}`,
    f.sessionId && `- 会话：${heading(f.sessionId)}`,
    f.messageId && `- 消息：${heading(f.messageId)}`,
    f.projectPath && `- 项目：${heading(f.projectPath)}`,
    f.filePath && `- 文件：${heading(f.filePath)}`,
    s.logPath && `- 历史记录：${heading(s.logPath)}${s.line ? `（第 ${s.line} 行）` : ""}`,
    s.jsonPath && `- 记录定位：${heading(JSON.stringify(s.jsonPath))}`,
    s.table && `- 数据库记录：${s.table} / ${heading(s.recordKey || "")} / ${heading(s.conversationId || "")}`,
    `- 收藏 ID：${f.id}`,
    `- 快照：${f.snapshot.sha256}`,
    `- 保存时间：${new Date(f.snapshot.capturedAt).toISOString()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function contextPack(favorites: AIFavorite[], task = ""): string {
  if (!favorites.length) throw new Error("请至少选择一条收藏。");
  return [
    `# AI 编程上下文包`,
    task.trim() && `## 当前任务\n\n${task.trim()}`,
    "以下内容为历史收藏的原始快照。使用时结合适用条件和验证记录重新判断。",
    ...favorites.map((f, index) => {
      const question =
        f.context?.question ||
        (f.type === "session"
          ? [...f.content.matchAll(/^## (?:用户|User)\n\n([\s\S]*?)(?=\n\n---\n\n|$)/gm)].map((m) => m[1]).join("\n\n")
          : "");
      const code = f.type === "file" ? fileMarkdown(f.content, f.filePath || "text") : codeBlocks(f.content);
      return [
        `## ${index + 1}. ${heading(f.title)}`,
        `### 问题\n\n${question || "未记录用户问题。"}`,
        `### 方案\n\n${f.type === "file" ? fileMarkdown(f.content, f.filePath || "text") : f.content}`,
        f.context?.previousAssistant && `### 相邻上下文\n\n${f.context.previousAssistant}`,
        `### 适用条件\n\n${f.applicability || "未记录，请结合项目环境验证。"}\n\n验证记录：${verificationText(f)}${f.recommended ? "\n\n手动标记：推荐版本" : ""}`,
        `### 代码\n\n${code ? (f.type === "file" ? code : fileMarkdown(code, "code.txt")) : "此快照没有独立代码块。"}`,
        f.note && `### 个人备注\n\n${f.note}`,
        f.tags.length && `### 标签\n\n${f.tags.join("、")}`,
        `### 来源\n\n${sourceMarkdown(f)}`,
      ]
        .filter(Boolean)
        .join("\n\n");
    }),
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export function obsidianMarkdown(f: AIFavorite): string {
  const properties: Record<string, unknown> = {
    title: f.title,
    tags: f.tags,
    favorite_id: f.id,
    provider: f.provider,
    type: f.type,
    session_id: f.sessionId,
    message_id: f.messageId,
    project_path: f.projectPath,
    file_path: f.filePath,
    source_url: f.source.url,
    source_label: f.source.label,
    source_application: f.source.application,
    source_record: f.source.logPath,
    source_line: f.source.line,
    source_format: f.source.format,
    source_pointer: f.source.jsonPath,
    source_table: f.source.table,
    source_key: f.source.recordKey,
    source_conversation: f.source.conversationId,
    capture_method: f.source.captureMethod,
    snapshot_sha256: f.snapshot.sha256,
    captured_at: new Date(f.snapshot.capturedAt).toISOString(),
    verification_status: f.verification?.status || "unverified",
    verification_project: f.verification?.project,
    verification_version: f.verification?.version,
    verification_date: f.verification?.date,
    recommended: !!f.recommended,
    version_group: f.versionGroupId,
  };
  // JSON strings and arrays are valid YAML flow values and preserve punctuation/newlines.
  const yaml = Object.entries(properties)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  return `---\n${yaml}\n---\n\n${favoriteMarkdown(f)}\n\n## 验证记录\n\n${verificationText(f)}\n\n## 来源\n\n${sourceMarkdown(f)}\n`;
}
