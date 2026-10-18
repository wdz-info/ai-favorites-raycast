import { spawn } from "node:child_process";
import { chmod, mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { sqlString } from "../providers/sqlite";
import { ProviderRegistry, sessionKey } from "../providers/registry";
import { HistoryCatalog } from "./sync";
import { FavoriteDraft, SessionMessage, SessionSummary } from "./types";
import { messageDraft, sha256 } from "./favorite-service";
import { excerpt, matchText, normalize, queryGroups, SearchMode } from "./text-search";

export interface HistoryHit {
  key: string;
  summary: SessionSummary;
  message: SessionMessage;
  before?: SessionMessage;
  after?: SessionMessage;
  draft?: FavoriteDraft;
  matches: string[];
  snippet: string;
  score: number;
}
type IndexedMessage = Omit<HistoryHit, "key" | "matches" | "snippet" | "score">;

async function sql(path: string, query: string, readonly = false): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/bin/sqlite3",
      [...(readonly ? ["-readonly"] : []), "-cmd", ".timeout 3000", "-json", path],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "",
      failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error("历史索引操作超时，请重试。");
      child.kill();
    }, 30000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 8 * 1024 * 1024) {
        failure = new Error("索引返回内容过大，请缩小查询范围。");
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdin.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure || code !== 0)
        return reject(
          failure || new Error(`历史索引不可用：${stderr.slice(0, 400)}。可在操作菜单中重建索引；收藏快照不受影响。`),
        );
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : []);
      } catch {
        reject(new Error("历史索引返回格式无效。"));
      }
    });
    child.stdin.end(query);
  });
}

const running = new Map<string, Promise<{ warnings: string[]; indexed: number }>>();
export class HistoryIndex {
  readonly filePath: string;
  constructor(
    readonly directory: string,
    readonly registry: ProviderRegistry,
  ) {
    this.filePath = join(directory, "history-search.sqlite3");
  }
  private async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const handle = await open(this.filePath, "wx", 0o600);
      await handle.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await chmod(this.filePath, 0o600);
    await sql(
      this.filePath,
      `CREATE TABLE IF NOT EXISTS sources(key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, scanned REAL NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(key UNINDEXED, data UNINDEXED, text, tokenize='trigram');`,
    );
  }
  async refresh(
    catalog: HistoryCatalog,
    onProgress?: (done: number, total: number) => void | Promise<void>,
    budgetMs?: number,
  ) {
    const pending = running.get(this.filePath);
    if (pending) {
      await pending;
    }
    const task = this.update(catalog, onProgress, budgetMs);
    running.set(this.filePath, task);
    try {
      return await task;
    } finally {
      if (running.get(this.filePath) === task) running.delete(this.filePath);
    }
  }
  private async update(
    catalog: HistoryCatalog,
    onProgress?: (done: number, total: number) => void | Promise<void>,
    budgetMs?: number,
  ) {
    await this.initialize();
    const started = catalog.lastSyncAt;
    const old = new Map(
      (await sql(this.filePath, "SELECT key,fingerprint FROM sources;", true)).map((r) => [
        String(r.key),
        String(r.fingerprint),
      ]),
    );
    const warnings = [...catalog.warnings];
    let indexed = 0,
      processed = 0;
    const deadline = budgetMs === undefined ? Infinity : Date.now() + budgetMs;
    for (const summary of catalog.sessions) {
      if (Date.now() >= deadline) break;
      await onProgress?.(++processed, catalog.sessions.length);
      const key = sessionKey(summary),
        fingerprint = summary.fingerprint || sha256(JSON.stringify(summary));
      if (old.get(key) === fingerprint) continue;
      try {
        const session = await this.registry.readSession(summary);
        if (session.warnings.length) {
          warnings.push(...session.warnings);
          continue;
        }
        // A per-session transaction keeps the previous readable generation on parse/write failure.
        const guard = `NOT EXISTS(SELECT 1 FROM sources WHERE key=${sqlString(key)} AND scanned>${started})`;
        const statements = [`BEGIN IMMEDIATE;`, `DELETE FROM messages WHERE key=${sqlString(key)} AND ${guard};`];
        for (const [index, message] of session.messages.entries()) {
          const draft = message.role === "assistant" ? messageDraft(session, message) : undefined;
          const data: IndexedMessage = {
            summary,
            message,
            before: session.messages[index - 1],
            after: session.messages[index + 1],
            draft,
          };
          const text = normalize(
            [summary.title, summary.id, summary.projectPath, message.content, draft?.context?.question]
              .filter(Boolean)
              .join("\n"),
          ).replace(/\0/g, " ");
          statements.push(
            `INSERT INTO messages(key,data,text) SELECT ${sqlString(key)},${sqlString(JSON.stringify(data))},${sqlString(text)} WHERE ${guard};`,
          );
        }
        statements.push(
          `INSERT INTO sources VALUES(${sqlString(key)},${sqlString(fingerprint)},${started}) ON CONFLICT(key) DO UPDATE SET fingerprint=excluded.fingerprint,scanned=excluded.scanned WHERE sources.scanned<=excluded.scanned; COMMIT;`,
        );
        await sql(this.filePath, statements.join("\n"));
        indexed++;
      } catch (error) {
        warnings.push(`${summary.provider} / ${summary.title} 索引保留旧版本：${(error as Error).message}`);
      }
    }
    const keys = catalog.sessions.map((s) => sqlString(sessionKey(s))).join(",");
    const condition = `scanned<=${started}${keys ? ` AND key NOT IN (${keys})` : ""}`;
    await sql(
      this.filePath,
      `BEGIN IMMEDIATE; DELETE FROM messages WHERE key IN (SELECT key FROM sources WHERE ${condition}); DELETE FROM sources WHERE ${condition}; COMMIT;`,
    );
    return { warnings: [...new Set(warnings)], indexed };
  }
  async search(
    query: string,
    options: { mode?: SearchMode; project?: string; provider?: string; limit?: number } = {},
  ): Promise<HistoryHit[]> {
    const groups = queryGroups(query, options.mode);
    if (!groups.length) return [];
    const terms = [...new Set(groups.flat())];
    const long = terms.filter((term) => term.length >= 3);
    const short = terms.filter((term) => term.length < 3);
    const clauses: string[] = [];
    if (long.length)
      clauses.push(
        `messages MATCH ${sqlString(long.map((term) => `"${(options.mode === "smart" ? term.slice(0, 3) : term).replace(/"/g, '""')}"`).join(" OR "))}`,
      );
    for (const term of short) clauses.push(`instr(text,${sqlString(term)})>0`);
    const filters = [
      options.provider ? `json_extract(data,'$.summary.provider')=${sqlString(options.provider)}` : "",
      options.project !== undefined
        ? `COALESCE(json_extract(data,'$.summary.projectPath'),'')=${sqlString(options.project)}`
        : "",
    ].filter(Boolean);
    // UNION avoids combining MATCH with non-FTS OR clauses, which SQLite rejects.
    const groupChecks = groups.map(
      (group) =>
        `(${group.map((term) => `instr(text,${sqlString(options.mode === "smart" && /^[a-z]{4,}$/.test(term) ? term.slice(0, 3) : term)})>0`).join(" OR ")})`,
    );
    const check =
      options.mode === "smart"
        ? `(${groupChecks.map((group) => `CASE WHEN ${group} THEN 1 ELSE 0 END`).join("+")})>=${Math.max(1, Math.ceil(groups.length * 0.6))}`
        : groupChecks.join(" AND ");
    const queries = clauses.map(
      (clause) =>
        `SELECT rowid,key,${clause.includes("MATCH") ? "bm25(messages)" : "0"} AS rank,json_extract(data,'$.summary.updatedAt') AS updated FROM messages WHERE ${clause} AND (${check})${filters.map((filter) => ` AND ${filter}`).join("")}`,
    );
    let rows: Record<string, unknown>[];
    try {
      rows = await sql(
        this.filePath,
        `WITH candidates AS MATERIALIZED (${queries.join(" UNION ")}) SELECT data FROM messages WHERE rowid IN (SELECT rowid FROM candidates GROUP BY key ORDER BY MIN(rank),MAX(updated) DESC LIMIT ${Math.min(400, (options.limit || 30) * 4)});`,
        true,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const best = new Map<string, HistoryHit>();
    for (const row of rows) {
      const data: IndexedMessage = JSON.parse(String(row.data));
      const text = [
        data.summary.title,
        data.summary.id,
        data.summary.projectPath,
        data.message.content,
        data.draft?.context?.question,
      ]
        .filter(Boolean)
        .join("\n");
      const result = matchText(text, groups, options.mode);
      if (!result.matched) continue;
      const key = sessionKey(data.summary);
      const score =
        result.matches.length * 10 +
        result.matches.filter((term) => normalize(data.message.content).includes(term)).length * 5;
      const hit: HistoryHit = {
        ...data,
        key,
        matches: result.matches,
        snippet: excerpt(data.message.content, result.matches),
        score,
      };
      if (!best.has(key) || best.get(key)!.score < score) best.set(key, hit);
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score || b.summary.updatedAt - a.summary.updatedAt)
      .slice(0, options.limit || 30);
  }
  async clear() {
    await running.get(this.filePath)?.catch(() => undefined);
    try {
      await this.initialize();
      await sql(this.filePath, "BEGIN IMMEDIATE; DELETE FROM messages; DELETE FROM sources; COMMIT;");
    } catch {
      // This file is a disposable index, never the permanent favorites store.
      await rm(this.filePath, { force: true });
      await this.initialize();
    }
  }
}
