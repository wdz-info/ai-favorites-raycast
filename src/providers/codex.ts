import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { sha256 } from "../core/favorite-service";
import { record, lines, discover, collectFiles, fingerprint, RecordValue } from "./history-files";
import { ProviderAdapter, Session, SessionFile, SessionMessage, SessionSummary } from "../core/types";

function textContent(payload: RecordValue): string {
  if (!Array.isArray(payload.content)) return "";
  return payload.content
    .map((v) => record(v))
    .filter((v) => ["input_text", "output_text", "text"].includes(String(v.type)))
    .map((v) => (typeof v.text === "string" ? v.text : ""))
    .filter((s) => !/^\s*(<environment_context>|<external_codex_apps_open_page>|# AGENTS\.md instructions)/.test(s))
    .join("\n\n")
    .trim();
}

export class CodexProvider implements ProviderAdapter {
  readonly id = "codex" as const;
  constructor(readonly home: string) {}

  async listSessions(): Promise<{ sessions: SessionSummary[]; warnings: string[] }> {
    const warnings: string[] = [];
    // A missing home is different from a valid but empty history directory.
    try {
      const info = await stat(this.home);
      if (!info.isDirectory()) throw new Error("Codex 历史路径必须是目录。");
    } catch (error) {
      throw new Error(`无法访问 Codex 历史目录 ${this.home}： ${(error as Error).message}`);
    }
    const titles = new Map<string, string>();
    try {
      for await (const row of lines(join(this.home, "session_index.jsonl"))) {
        try {
          const entry = record(JSON.parse(row.text));
          if (typeof entry.id === "string" && typeof entry.thread_name === "string")
            titles.set(entry.id, entry.thread_name);
        } catch {
          warnings.push(`会话索引第 ${row.line} 行无法解析。`);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        warnings.push(`无法读取会话标题： ${(error as Error).message}`);
    }
    const active = await discover(join(this.home, "sessions"), warnings);
    const archived = await discover(join(this.home, "archived_sessions"), warnings);
    const pending = [
      ...active.map((path) => ({ path, archived: false })),
      ...archived.map((path) => ({ path, archived: true })),
    ];
    const sessions: SessionSummary[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(12, pending.length) }, async () => {
        while (next < pending.length) {
          const item = pending[next++];
          try {
            let metadata: RecordValue | undefined;
            for await (const row of lines(item.path)) {
              const entry = record(JSON.parse(row.text));
              if (entry.type === "session_meta") {
                metadata = record(entry.payload);
                break;
              }
              if (row.line >= 20) break;
            }
            if (!metadata || typeof metadata.id !== "string") throw new Error("缺少会话元数据。");
            const info = await stat(item.path);
            const timestamp = Date.parse(String(metadata.timestamp));
            sessions.push({
              id: metadata.id,
              provider: "codex",
              title:
                titles.get(metadata.id) ||
                (typeof metadata.title === "string" ? metadata.title : `Codex ${metadata.id}`),
              projectPath: typeof metadata.cwd === "string" ? metadata.cwd : undefined,
              logPath: item.path,
              createdAt: Number.isFinite(timestamp) ? timestamp : info.birthtimeMs,
              updatedAt: info.mtimeMs,
              archived: item.archived,
              fingerprint: await fingerprint([item.path], [metadata.id, titles.get(metadata.id), metadata.cwd]),
            });
          } catch (error) {
            warnings.push(`跳过 ${basename(item.path)}： ${(error as Error).message}`);
          }
        }
      }),
    );
    const unique = new Map<string, SessionSummary>();
    for (const session of sessions.sort((a, b) => Number(a.archived) - Number(b.archived)))
      if (!unique.has(session.id)) unique.set(session.id, session);
    return { sessions: [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt), warnings };
  }

  async readSession(summary: SessionSummary): Promise<Session> {
    const messages: SessionMessage[] = [],
      fallback: { message: SessionMessage; cwd?: string }[] = [],
      warnings: string[] = [];
    const files = new Map<string, SessionFile>();
    let cwd = summary.projectPath;
    let unreadable = 0;
    for await (const row of lines(summary.logPath)) {
      if (!row.text.trim()) continue;
      let entry: RecordValue;
      try {
        entry = record(JSON.parse(row.text));
      } catch {
        unreadable++;
        continue;
      }
      const payload = record(entry.payload);
      const timestamp = Date.parse(String(entry.timestamp));
      if (entry.type === "turn_context" && typeof payload.cwd === "string") cwd = payload.cwd;
      if (
        entry.type === "response_item" &&
        payload.type === "message" &&
        (payload.role === "user" || payload.role === "assistant")
      ) {
        const content = textContent(payload);
        if (content && payload.channel !== "analysis") {
          messages.push({
            id:
              typeof payload.id === "string" ? payload.id : `${summary.id}:${row.line}:${sha256(content).slice(0, 12)}`,
            role: payload.role,
            content,
            line: row.line,
            timestamp: Number.isFinite(timestamp) ? timestamp : summary.createdAt,
            phase: typeof payload.phase === "string" ? payload.phase : undefined,
          });
          if (payload.role === "assistant") collectFiles(content, cwd, row.line, files);
        }
      }
      if (
        entry.type === "event_msg" &&
        (payload.type === "user_message" || payload.type === "agent_message") &&
        typeof payload.message === "string" &&
        payload.message.trim()
      ) {
        fallback.push({
          cwd,
          message: {
            id: `${summary.id}:${row.line}:${sha256(payload.message).slice(0, 12)}`,
            role: payload.type === "user_message" ? "user" : "assistant",
            content: payload.message,
            timestamp: Number.isFinite(timestamp) ? timestamp : summary.createdAt,
            line: row.line,
          },
        });
      }
      if (entry.type === "response_item" && (payload.type === "custom_tool_call" || payload.type === "function_call")) {
        const input =
          typeof payload.input === "string"
            ? payload.input
            : typeof payload.arguments === "string"
              ? payload.arguments
              : "";
        collectFiles(input, cwd, row.line, files);
      }
    }
    for (const { message: event, cwd: eventCwd } of fallback) {
      if (
        !messages.some(
          (m) => m.role === event.role && m.content === event.content && Math.abs(m.timestamp - event.timestamp) < 5000,
        )
      ) {
        messages.push(event);
        if (event.role === "assistant") collectFiles(event.content, eventCwd, event.line, files);
      }
    }
    messages.sort((a, b) => a.line - b.line);
    if (unreadable) warnings.push(`已跳过 ${unreadable} 条无效或尚未写完的记录，预览与快照仅包含可读消息。`);
    return { ...summary, messages, files: [...files.values()], warnings };
  }
}
