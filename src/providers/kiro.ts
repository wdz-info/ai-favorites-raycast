import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ProviderAdapter, Session, SessionFile, SessionMessage, SessionSummary, SourceLocation } from "../core/types";
import { sha256 } from "../core/favorite-service";
import { collectFiles, discover, fingerprint, lines, record } from "./history-files";
import { queryDatabase, readDatabaseRecord } from "./sqlite";

export interface KiroLocations {
  home: string;
  cliDatabase: string;
  legacyIde: string;
}

function visibleText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => record(item))
    .filter((item) => item.kind === "text" || item.type === "text")
    .map((item) => (typeof item.data === "string" ? item.data : typeof item.text === "string" ? item.text : ""))
    .join("\n");
}

export class KiroProvider implements ProviderAdapter {
  readonly id = "kiro" as const;
  constructor(readonly locations: KiroLocations) {}

  async listSessions() {
    const sessions: SessionSummary[] = [],
      warnings: string[] = [];
    const root = join(this.locations.home, "sessions"),
      cliRoot = join(root, "cli");
    const metadata = (await discover(root, warnings, ".json")).filter(
      (path) => dirname(path) === cliRoot || path.endsWith("/session.json"),
    );
    for (const path of metadata) {
      try {
        const cli = dirname(path) === cliRoot,
          meta = record(JSON.parse(await readFile(path, "utf8")));
        const id = cli ? meta.session_id : meta.id;
        if (typeof id !== "string") throw new Error("缺少会话 ID。");
        const logPath = cli ? path.replace(/\.json$/, ".jsonl") : join(dirname(path), "messages.jsonl");
        const info = await stat(logPath),
          metaInfo = await stat(path);
        const projects =
          Array.isArray(meta.workspacePaths) && meta.workspacePaths.length ? meta.workspacePaths : meta.rootPaths;
        const projectPath = cli ? meta.cwd : Array.isArray(projects) ? projects[0] : undefined;
        sessions.push({
          id,
          provider: "kiro",
          sourceKind: cli ? "kiro-cli" : "kiro-ide",
          title: String(meta.title || `Kiro ${id}`),
          projectPath: typeof projectPath === "string" ? projectPath : undefined,
          logPath,
          archived: false,
          createdAt: Date.parse(String(cli ? meta.created_at : meta.createdAt)) || info.birthtimeMs,
          updatedAt: Math.max(
            Date.parse(String(cli ? meta.updated_at : meta.lastModifiedAt)) || 0,
            info.mtimeMs,
            metaInfo.mtimeMs,
          ),
          fingerprint: await fingerprint([path, logPath], id),
        });
      } catch (error) {
        warnings.push(`无法读取 Kiro 会话 ${path}：${(error as Error).message}`);
      }
    }

    // Legacy IDE workspace histories are still present after an IDE upgrade.
    const indexes = (await discover(join(this.locations.legacyIde, "workspace-sessions"), warnings, ".json")).filter(
      (path) => basename(path) === "sessions.json",
    );
    for (const path of indexes) {
      try {
        const entries: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!Array.isArray(entries)) throw new Error("会话索引不是数组。");
        for (const item of entries) {
          const meta = record(item);
          if (typeof meta.sessionId !== "string" || meta.hidden) continue;
          try {
            const logPath = join(dirname(path), `${meta.sessionId}.json`),
              info = await stat(logPath);
            const data = record(JSON.parse(await readFile(logPath, "utf8")));
            sessions.push({
              id: meta.sessionId,
              provider: "kiro",
              sourceKind: "kiro-ide",
              title: String(meta.title || data.title || `Kiro ${meta.sessionId}`),
              projectPath:
                String(data.workspacePath || data.workspaceDirectory || meta.workspaceDirectory || "") || undefined,
              logPath,
              source: { logPath, format: "json" },
              archived: false,
              createdAt: Number(meta.dateCreated) || info.birthtimeMs,
              updatedAt: info.mtimeMs,
              fingerprint: await fingerprint([path, logPath], meta.sessionId),
            });
          } catch (error) {
            warnings.push(`无法读取 Kiro IDE 会话 ${meta.sessionId}：${(error as Error).message}`);
          }
        }
      } catch (error) {
        warnings.push(`无法读取 Kiro IDE 历史 ${path}：${(error as Error).message}`);
      }
    }

    try {
      await stat(this.locations.cliDatabase);
      const tables = (
        await queryDatabase(
          this.locations.cliDatabase,
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('conversations','conversations_v2');",
        )
      ).map((r) => r.name);
      for (const table of ["conversations_v2", "conversations"] as const) {
        if (!tables.includes(table)) continue;
        const rows = await queryDatabase(
          this.locations.cliDatabase,
          table === "conversations_v2"
            ? "SELECT key, conversation_id, created_at, updated_at, value FROM conversations_v2;"
            : "SELECT key, value FROM conversations;",
        );
        for (const row of rows) {
          try {
            const data = record(JSON.parse(String(row.value))),
              id = String(row.conversation_id || data.conversation_id || sha256(String(row.key)));
            // The same CLI session can exist both in SQLite and in the newer flat-file format.
            if (sessions.some((s) => s.id === id && s.sourceKind === "kiro-cli")) continue;
            const source: SourceLocation = {
              format: "sqlite",
              logPath: this.locations.cliDatabase,
              table,
              recordKey: String(row.key),
              conversationId: table === "conversations_v2" ? id : undefined,
            };
            sessions.push({
              id,
              provider: "kiro",
              sourceKind: "kiro-cli",
              projectPath: String(row.key),
              logPath: this.locations.cliDatabase,
              source,
              title: String(data.title || `Kiro ${id}`),
              archived: false,
              createdAt: Number(row.created_at) || 0,
              updatedAt: Number(row.updated_at) || 0,
              fingerprint: sha256(JSON.stringify([row.key, row.value])),
            });
          } catch (error) {
            warnings.push(
              `无法读取 Kiro CLI 会话 ${String(row.conversation_id || row.key)}：${(error as Error).message}`,
            );
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        warnings.push(`无法读取 Kiro CLI 数据库：${(error as Error).message}`);
    }
    return { sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt), warnings };
  }

  async readSession(summary: SessionSummary): Promise<Session> {
    const messages: SessionMessage[] = [],
      files = new Map<string, SessionFile>(),
      warnings: string[] = [];
    const add = (
      id: string,
      role: SessionMessage["role"],
      content: string,
      line: number,
      timestamp: number,
      source?: SourceLocation,
    ) => {
      if (!content.trim() || content.trim() === "...") return;
      const message = { id, role, content, line, timestamp, source };
      const previous = messages.findIndex((m) => m.id === id);
      if (previous >= 0) messages[previous] = message;
      else messages.push(message);
      if (role === "assistant") collectFiles(content, summary.projectPath, line, files);
    };
    if (summary.source?.format === "sqlite" || summary.source?.format === "json") {
      const value =
        summary.source.format === "sqlite"
          ? await readDatabaseRecord(summary.source)
          : JSON.parse(await readFile(summary.logPath, "utf8"));
      const data = record(value);
      if (!Array.isArray(data.history)) throw new Error("Kiro 历史记录格式不受支持：缺少 history 数组。");
      for (const [index, item] of data.history.entries()) {
        const entry = record(item),
          user = record(entry.user),
          assistant = record(entry.assistant),
          message = record(entry.message);
        const prompt = record(record(user.content).Prompt),
          response = record(assistant.Response || assistant.ToolUse);
        const pointer = (jsonPath: (string | number)[]) => ({ ...summary.source!, jsonPath });
        if (typeof prompt.prompt === "string")
          add(
            `${summary.id}:user:${index}`,
            "user",
            prompt.prompt,
            index * 2 + 1,
            Date.parse(String(user.timestamp)) || summary.createdAt,
            pointer(["history", index, "user"]),
          );
        if (typeof response.content === "string")
          add(
            String(response.message_id || `${summary.id}:assistant:${index}`),
            "assistant",
            response.content,
            index * 2 + 2,
            summary.createdAt,
            pointer(["history", index, "assistant"]),
          );
        if (message.role === "user" || message.role === "assistant")
          add(
            String(message.id || `${summary.id}:${index}`),
            message.role,
            visibleText(message.content),
            index + 1,
            summary.createdAt,
            pointer(["history", index, "message"]),
          );
        if (Array.isArray(response.tool_uses))
          for (const tool of response.tool_uses) this.collectTool(record(record(tool).args), summary, index + 1, files);
      }
    } else {
      let unreadable = 0;
      for await (const row of lines(summary.logPath)) {
        if (!row.text.trim()) continue;
        let entry;
        try {
          entry = record(JSON.parse(row.text));
        } catch {
          unreadable++;
          continue;
        }
        const cli = summary.sourceKind === "kiro-cli",
          data = record(cli ? entry.data : entry.payload);
        const kind = cli ? entry.kind : data.type;
        const timestamp = Date.parse(String(entry.timestamp)) || summary.createdAt;
        if (kind === "Prompt" || kind === "AssistantMessage") {
          const content = visibleText(data.content);
          add(
            String(data.message_id || `${summary.id}:${row.line}`),
            kind === "Prompt" ? "user" : "assistant",
            content,
            row.line,
            timestamp,
          );
          if (Array.isArray(data.content))
            for (const block of data.content)
              if (record(block).kind === "toolUse")
                this.collectTool(record(record(record(block).data).input), summary, row.line, files);
        } else if (kind === "user" || kind === "assistant") {
          if (kind === "assistant" && ["reasoning", "thinking"].includes(String(data.operationType).toLowerCase()))
            continue;
          add(String(entry.id || `${summary.id}:${row.line}`), kind, visibleText(data.content), row.line, timestamp);
        } else if (kind === "tool_call") this.collectTool(record(data.args), summary, row.line, files);
      }
      if (unreadable) warnings.push(`${unreadable} 条无效或尚未写完的记录被跳过。`);
    }
    return { ...summary, messages, files: [...files.values()], warnings };
  }

  private collectTool(
    input: Record<string, unknown>,
    summary: SessionSummary,
    line: number,
    files: Map<string, SessionFile>,
  ) {
    collectFiles(JSON.stringify(input), summary.projectPath, line, files);
    for (const name of ["path", "file", "file_path", "target_file"]) {
      const path = input[name];
      if (typeof path === "string")
        collectFiles(`\`${path.startsWith("/") ? path : `./${path}`}\``, summary.projectPath, line, files);
    }
  }
}
