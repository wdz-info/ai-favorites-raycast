import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ProviderAdapter, Session, SessionSummary, SessionMessage, SessionFile } from "../core/types";
import { collectFiles, discover, fingerprint, lines, record } from "./history-files";

export class GrokProvider implements ProviderAdapter {
  readonly id = "grok" as const;
  constructor(readonly home: string) {}
  async listSessions() {
    const warnings: string[] = [],
      sessions: SessionSummary[] = [];
    const paths = (await discover(join(this.home, "sessions"), warnings, ".json")).filter((p) =>
      p.endsWith("/summary.json"),
    );
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(12, paths.length) }, async () => {
        while (next < paths.length) {
          const path = paths[next++];
          try {
            const metadata = record(JSON.parse(await readFile(path, "utf8"))),
              info = record(metadata.info);
            if (typeof info.id !== "string") throw new Error("缺少会话 ID。");
            const logPath = join(dirname(path), "updates.jsonl"),
              stats = await stat(path);
            sessions.push({
              id: info.id,
              provider: "grok",
              title: String(metadata.generated_title || metadata.session_summary || `Grok ${info.id}`),
              projectPath: typeof info.cwd === "string" ? info.cwd : undefined,
              logPath,
              archived: false,
              createdAt: Date.parse(String(metadata.created_at)) || stats.birthtimeMs,
              updatedAt: Math.max(
                Date.parse(String(metadata.updated_at)) || 0,
                stats.mtimeMs,
                (await stat(logPath)).mtimeMs,
              ),
              fingerprint: await fingerprint([path, logPath], info.id),
            });
          } catch (error) {
            warnings.push(`无法读取 Grok 会话 ${path}：${(error as Error).message}`);
          }
        }
      }),
    );
    return { sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt), warnings };
  }

  async readSession(summary: SessionSummary): Promise<Session> {
    const messages: SessionMessage[] = [],
      files = new Map<string, SessionFile>(),
      warnings: string[] = [];
    let pending: SessionMessage | undefined,
      unreadable = 0;
    const flush = () => {
      if (pending?.content.trim()) {
        messages.push(pending);
        if (pending.role === "assistant") collectFiles(pending.content, summary.projectPath, pending.line, files);
      }
      pending = undefined;
    };
    for await (const row of lines(summary.logPath)) {
      if (!row.text.trim()) continue;
      let entry;
      try {
        entry = record(JSON.parse(row.text));
      } catch {
        unreadable++;
        continue;
      }
      const params = record(entry.params),
        update = record(params.update),
        kind = update.sessionUpdate;
      if (typeof params.sessionId === "string" && params.sessionId !== summary.id) continue;
      if (kind === "user_message_chunk" || kind === "agent_message_chunk") {
        const content = record(update.content);
        if (content.type !== "text" || typeof content.text !== "string") continue;
        const role = kind === "user_message_chunk" ? "user" : "assistant";
        if (pending && pending.role !== role) flush();
        if (!pending)
          pending = {
            id: `${summary.id}:${row.line}`,
            role,
            content: "",
            line: row.line,
            timestamp: typeof entry.timestamp === "number" ? entry.timestamp : summary.createdAt,
          };
        pending.content += content.text;
      } else if (kind === "tool_call" || kind === "tool_call_update") {
        if (kind === "tool_call") flush();
        collectFiles(JSON.stringify(update.rawInput || {}), summary.projectPath, row.line, files);
        const input = record(update.rawInput);
        for (const field of ["target_file", "file_path", "path"])
          if (typeof input[field] === "string")
            collectFiles(
              `\`${String(input[field]).startsWith("/") ? input[field] : `./${input[field]}`}\``,
              summary.projectPath,
              row.line,
              files,
            );
        if (Array.isArray(update.locations))
          for (const location of update.locations) {
            const path = record(location).path;
            if (typeof path === "string")
              collectFiles(`\`${path.startsWith("/") ? path : `./${path}`}\``, summary.projectPath, row.line, files);
          }
      } else if (kind === "turn_completed" || kind === "turn_cancelled") flush();
      // agent_thought_chunk and tool output are intentionally excluded from visible replies.
    }
    flush();
    if (unreadable) warnings.push(`${unreadable} 条无效或尚未写完的记录被跳过。`);
    return { ...summary, messages, files: [...files.values()], warnings };
  }
}
