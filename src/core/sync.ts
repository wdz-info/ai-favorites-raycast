import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { withDirectoryLock, writeJsonAtomically } from "./atomic-json";
import { AIFavorite, SessionSummary, ProviderId } from "./types";
import { ProviderRegistry, sessionKey } from "../providers/registry";

export interface HistoryCatalog {
  version: 1;
  sessions: SessionSummary[];
  lastSyncAt: number;
  lastSuccessfulSync: Partial<Record<ProviderId, number>>;
  changes: { added: string[]; changed: string[]; removed: string[] };
  warnings: string[];
}

export class HistorySync {
  readonly filePath: string;
  constructor(
    readonly directory: string,
    readonly registry: ProviderRegistry,
  ) {
    this.filePath = join(directory, "history-catalog.json");
  }

  async read(): Promise<HistoryCatalog | undefined> {
    let value;
    try {
      value = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error(`无法读取历史同步目录：${(error as Error).message}`);
    }
    if (
      !value ||
      value.version !== 1 ||
      !Array.isArray(value.sessions) ||
      !value.sessions.every(
        (s: SessionSummary) =>
          s &&
          typeof s.id === "string" &&
          typeof s.provider === "string" &&
          typeof s.title === "string" &&
          typeof s.logPath === "string" &&
          Number.isFinite(s.updatedAt),
      ) ||
      !Number.isFinite(value.lastSyncAt) ||
      !value.lastSuccessfulSync ||
      !Array.isArray(value.warnings) ||
      !value.warnings.every((w: unknown) => typeof w === "string") ||
      !value.changes ||
      ![value.changes.added, value.changes.changed, value.changes.removed].every(
        (items) => Array.isArray(items) && items.every((item) => typeof item === "string"),
      )
    )
      throw new Error("历史同步目录损坏或版本不受支持，请备份后重建 history-catalog.json；收藏数据不受影响。");
    return value as HistoryCatalog;
  }

  async sync(): Promise<HistoryCatalog> {
    const now = Date.now();
    // Scan without holding the commit lock: UI refresh and background scans may overlap.
    const results = await Promise.allSettled(this.registry.adapters.map((adapter) => adapter.listSessions()));
    return withDirectoryLock(this.directory, ".sync-lock", async () => {
      const previous = await this.read(),
        warnings: string[] = [],
        next: SessionSummary[] = [];
      // A slow older scan must not replace a more recently started scan.
      if (previous && previous.lastSyncAt >= now) return previous;
      const lastSuccessfulSync = { ...previous?.lastSuccessfulSync };
      for (const [index, result] of results.entries()) {
        const provider = this.registry.adapters[index].id;
        const old = previous?.sessions.filter((s) => s.provider === provider) || [];
        if (result.status === "rejected") {
          warnings.push(
            `${provider} 同步失败：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          );
          next.push(...old);
          continue;
        }
        const current = result.value;
        warnings.push(...current.warnings);
        next.push(...current.sessions);
        if (current.warnings.length) {
          // A partial scan is not evidence that unreadable sessions were deleted.
          const keys = new Set(current.sessions.map(sessionKey));
          next.push(...old.filter((s) => !keys.has(sessionKey(s))));
        } else lastSuccessfulSync[provider] = now;
      }
      const unique = [...new Map(next.map((s) => [sessionKey(s), s])).values()].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
      const before = new Map(previous?.sessions.map((s) => [sessionKey(s), s]) || []),
        after = new Map(unique.map((s) => [sessionKey(s), s]));
      const changes = { added: [] as string[], changed: [] as string[], removed: [] as string[] };
      for (const [key, session] of after) {
        const old = before.get(key);
        if (!old) changes.added.push(key);
        else if (
          old.fingerprint !== session.fingerprint ||
          old.updatedAt !== session.updatedAt ||
          old.title !== session.title
        )
          changes.changed.push(key);
      }
      for (const key of before.keys()) if (!after.has(key)) changes.removed.push(key);
      const catalog: HistoryCatalog = {
        version: 1,
        sessions: unique,
        lastSyncAt: now,
        lastSuccessfulSync,
        changes,
        warnings,
      };
      await writeJsonAtomically(this.directory, this.filePath, catalog);
      return catalog;
    });
  }

  async listSessions() {
    const catalog = await this.sync();
    return { sessions: catalog.sessions, warnings: catalog.warnings, catalog };
  }
}

export function sourceStatus(favorite: AIFavorite, catalog?: HistoryCatalog): "changed" | "missing" | undefined {
  if (!catalog || !favorite.sessionId) return undefined;
  const summary = catalog.sessions.find(
    (s) =>
      s.provider === favorite.provider &&
      s.id === favorite.sessionId &&
      s.logPath === favorite.source.logPath &&
      (s.source?.recordKey || "") === (favorite.source.recordKey || ""),
  );
  if (!summary) return catalog.lastSuccessfulSync[favorite.provider] === catalog.lastSyncAt ? "missing" : undefined;
  if (favorite.snapshot.sourceFingerprint)
    return summary.fingerprint !== favorite.snapshot.sourceFingerprint ? "changed" : undefined;
  return summary.updatedAt > favorite.snapshot.capturedAt ? "changed" : undefined;
}
