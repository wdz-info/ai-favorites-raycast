import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SourceLocation } from "../core/types";

const execute = promisify(execFile);
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function queryDatabase(path: string, query: string): Promise<Record<string, unknown>[]> {
  // Use the macOS SQLite executable in read-only mode, never a shell or a DB copied without its WAL.
  const { stdout } = await execute("/usr/bin/sqlite3", ["-readonly", "-cmd", ".timeout 3000", "-json", path, query], {
    maxBuffer: 128 * 1024 * 1024,
    timeout: 15000,
  });
  const result: unknown = stdout.trim() ? JSON.parse(stdout) : [];
  if (!Array.isArray(result)) throw new Error("SQLite 查询结果格式无效。");
  return result as Record<string, unknown>[];
}

export async function readDatabaseRecord(source: SourceLocation): Promise<unknown> {
  if (!source.logPath || !source.recordKey || !["conversations", "conversations_v2"].includes(source.table || ""))
    throw new Error("数据库来源信息不完整。");
  const condition = `key=${sqlString(source.recordKey)}${source.table === "conversations_v2" ? ` AND conversation_id=${sqlString(source.conversationId || "")}` : ""}`;
  const rows = await queryDatabase(source.logPath, `SELECT value FROM ${source.table} WHERE ${condition};`);
  if (!rows.length) throw new Error("原始会话已不存在，已收藏的快照仍可阅读。");
  return JSON.parse(String(rows[0].value));
}
