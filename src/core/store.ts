import { randomUUID } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { withDirectoryLock, writeJsonAtomically } from "./atomic-json";
import { AIFavorite, FavoriteDraft, FavoriteMetadata, Verification } from "./types";
import { sha256 } from "./favorite-service";
import { naturalVersionKey, versionKey } from "./versions";
import { directoryHash, validDirectorySnapshot } from "./directory-snapshot";

export function validVerification(value: unknown): value is Verification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Verification;
  return (
    ["unverified", "verified", "invalid"].includes(v.status) &&
    [v.project, v.version, v.date, v.note].every((s) => s === undefined || typeof s === "string") &&
    (v.date === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v.date)) &&
    (v.status !== "verified" || !!(v.project?.trim() && v.version?.trim() && v.date))
  );
}

interface StoreDocument {
  version: 1;
  favorites: AIFavorite[];
}

function isFavorite(value: unknown): value is AIFavorite {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const f = value as AIFavorite;
  const optionalStrings = [
    f.note,
    f.projectPath,
    f.sessionId,
    f.messageId,
    f.filePath,
    f.applicability,
    f.versionGroupId,
  ];
  return (
    typeof f.id === "string" &&
    typeof f.title === "string" &&
    typeof f.content === "string" &&
    ["session", "message", "file"].includes(f.type) &&
    (f.directorySnapshot === undefined ||
      (f.type === "file" &&
        validDirectorySnapshot(f.directorySnapshot) &&
        directoryHash(f.directorySnapshot) === f.snapshot?.sha256)) &&
    ["codex", "claude", "kiro", "gemini", "opencode", "grok", "manual"].includes(f.provider) &&
    (f.verification === undefined || validVerification(f.verification)) &&
    (f.recommended === undefined || typeof f.recommended === "boolean") &&
    (f.reuseFeedback === undefined ||
      (f.reuseFeedback !== null &&
        typeof f.reuseFeedback === "object" &&
        Number.isInteger(f.reuseFeedback.helpful) &&
        f.reuseFeedback.helpful >= 0 &&
        Number.isInteger(f.reuseFeedback.unresolved) &&
        f.reuseFeedback.unresolved >= 0 &&
        ["helpful", "unresolved"].includes(f.reuseFeedback.lastResult) &&
        Number.isFinite(f.reuseFeedback.lastUsedAt))) &&
    Array.isArray(f.tags) &&
    f.tags.every((t) => typeof t === "string") &&
    optionalStrings.every((s) => s === undefined || typeof s === "string") &&
    Number.isFinite(f.createdAt) &&
    Number.isFinite(f.updatedAt) &&
    !!f.source &&
    typeof f.source === "object" &&
    !Array.isArray(f.source) &&
    [f.source.label, f.source.url, f.source.application].every((s) => s === undefined || typeof s === "string") &&
    (f.source.captureMethod === undefined || ["selection", "clipboard", "manual"].includes(f.source.captureMethod)) &&
    (f.source.logPath === undefined || typeof f.source.logPath === "string") &&
    (f.source.format === undefined || ["jsonl", "json", "sqlite"].includes(f.source.format)) &&
    (f.source.jsonPath === undefined ||
      (Array.isArray(f.source.jsonPath) &&
        f.source.jsonPath.every(
          (p) => typeof p === "string" || (typeof p === "number" && Number.isInteger(p) && p >= 0),
        ))) &&
    [f.source.recordKey, f.source.conversationId].every((s) => s === undefined || typeof s === "string") &&
    (f.source.table === undefined || ["conversations", "conversations_v2"].includes(f.source.table)) &&
    (f.source.line === undefined || (Number.isInteger(f.source.line) && f.source.line > 0)) &&
    !!f.snapshot &&
    typeof f.snapshot === "object" &&
    !Array.isArray(f.snapshot) &&
    typeof f.snapshot.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(f.snapshot.sha256) &&
    Number.isFinite(f.snapshot.capturedAt) &&
    (f.snapshot.sourceFingerprint === undefined ||
      (typeof f.snapshot.sourceFingerprint === "string" && /^[a-f0-9]{64}$/.test(f.snapshot.sourceFingerprint))) &&
    (f.snapshot.fileModifiedAt === undefined || Number.isFinite(f.snapshot.fileModifiedAt)) &&
    (f.context === undefined ||
      (!!f.context &&
        typeof f.context === "object" &&
        !Array.isArray(f.context) &&
        (f.context.question === undefined || typeof f.context.question === "string") &&
        (f.context.previousAssistant === undefined || typeof f.context.previousAssistant === "string")))
  );
}

export function parseTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

export class FavoriteStore {
  readonly filePath: string;
  constructor(readonly directory: string) {
    this.filePath = join(directory, "favorites.json");
  }

  async list(): Promise<AIFavorite[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    let document: StoreDocument;
    try {
      document = JSON.parse(raw);
    } catch {
      throw new Error(`收藏资料库不是有效的 JSON。请恢复 ${this.filePath} 的备份，原文件未修改。`);
    }
    if (
      !document ||
      typeof document !== "object" ||
      document.version !== 1 ||
      !Array.isArray(document.favorites) ||
      !document.favorites.every(isFavorite) ||
      new Set(document.favorites.map((f) => f.id)).size !== document.favorites.length
    ) {
      throw new Error(`收藏资料库格式不受支持或已损坏：${this.filePath}。原文件未修改。`);
    }
    return document.favorites;
  }

  private async mutate<T>(operation: (favorites: AIFavorite[]) => T): Promise<T> {
    return withDirectoryLock(this.directory, ".write-lock", async () => {
      const favorites = await this.list();
      const result = operation(favorites);
      const document: StoreDocument = { version: 1, favorites };
      await writeJsonAtomically(this.directory, this.filePath, document);
      return result;
    });
  }

  async add(draft: FavoriteDraft, metadata: FavoriteMetadata): Promise<{ favorite: AIFavorite; existed: boolean }> {
    if (!metadata.title.trim()) throw new Error("请填写标题。");
    return this.mutate((favorites) => {
      const existing = favorites.find(
        (f) =>
          f.type === draft.type &&
          f.provider === draft.provider &&
          f.sessionId === draft.sessionId &&
          f.messageId === draft.messageId &&
          f.filePath === draft.filePath &&
          f.snapshot.sha256 === draft.snapshot.sha256 &&
          f.projectPath === draft.projectPath,
      );
      if (existing) return { favorite: existing, existed: true };
      const now = Date.now();
      const versionGroupId = favorites.find(
        (f) => f.versionGroupId && naturalVersionKey(f) === naturalVersionKey(draft),
      )?.versionGroupId;
      const favorite: AIFavorite = {
        ...draft,
        versionGroupId,
        id: randomUUID(),
        title: metadata.title.trim(),
        tags: parseTags(metadata.tags.join(",")),
        note: metadata.note.trim(),
        applicability: metadata.applicability?.trim(),
        createdAt: now,
        updatedAt: now,
      };
      favorites.push(favorite);
      return { favorite, existed: false };
    });
  }

  async edit(id: string, metadata: FavoriteMetadata): Promise<void> {
    if (!metadata.title.trim()) throw new Error("请填写标题。");
    await this.mutate((favorites) => {
      const favorite = favorites.find((f) => f.id === id);
      if (!favorite) throw new Error("该收藏已不存在，请刷新列表。");
      Object.assign(favorite, {
        title: metadata.title.trim(),
        tags: parseTags(metadata.tags.join(",")),
        note: metadata.note.trim(),
        applicability: metadata.applicability?.trim(),
        updatedAt: Date.now(),
      });
    });
  }

  async remove(id: string): Promise<void> {
    await this.mutate((favorites) => {
      const index = favorites.findIndex((f) => f.id === id);
      if (index >= 0) favorites.splice(index, 1);
    });
  }

  async setVerification(id: string, verification: Verification): Promise<void> {
    if (!validVerification(verification)) throw new Error("已验证状态需填写验证项目、版本和日期。");
    await this.mutate((favorites) => {
      const favorite = favorites.find((f) => f.id === id);
      if (!favorite) throw new Error("该收藏已不存在，请刷新列表。");
      favorite.verification = { ...verification };
      favorite.updatedAt = Date.now();
    });
  }

  async recommend(id: string, comparedId?: string): Promise<void> {
    await this.mutate((favorites) => {
      const chosen = favorites.find((f) => f.id === id);
      const compared = comparedId ? favorites.find((f) => f.id === comparedId) : undefined;
      if (!chosen || (comparedId && !compared)) throw new Error("比较的收藏已不存在，请刷新列表。");
      const keys = new Set([versionKey(chosen), ...(compared ? [versionKey(compared)] : [])]);
      const group = chosen.versionGroupId || compared?.versionGroupId || randomUUID();
      for (const favorite of favorites) {
        if (!keys.has(versionKey(favorite))) continue;
        favorite.versionGroupId = group;
        favorite.recommended = favorite.id === id;
        favorite.updatedAt = Date.now();
      }
    });
  }
  async recordReuse(id: string, result: "helpful" | "unresolved") {
    if (!["helpful", "unresolved"].includes(result)) throw new Error("复用结果无效。");
    await this.mutate((favorites) => {
      const favorite = favorites.find((f) => f.id === id);
      if (!favorite) throw new Error("该收藏已不存在，请刷新列表。");
      const old = favorite.reuseFeedback;
      favorite.reuseFeedback = {
        helpful: (old?.helpful || 0) + Number(result === "helpful"),
        unresolved: (old?.unresolved || 0) + Number(result === "unresolved"),
        lastResult: result,
        lastUsedAt: Date.now(),
      };
    });
  }

  async backup(path: string) {
    const favorites = await this.list();
    const document = {
      format: "ai-favorites-backup",
      version: 1,
      createdAt: Date.now(),
      sha256: sha256(JSON.stringify(favorites)),
      favorites,
    };
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(document, null, 2) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return favorites.length;
  }

  private async readBackup(path: string): Promise<AIFavorite[]> {
    const document = JSON.parse(await readFile(path, "utf8"));
    if (
      !document ||
      document.format !== "ai-favorites-backup" ||
      document.version !== 1 ||
      !Array.isArray(document.favorites) ||
      !document.favorites.every(isFavorite) ||
      new Set(document.favorites.map((f: AIFavorite) => f.id)).size !== document.favorites.length ||
      document.sha256 !== sha256(JSON.stringify(document.favorites))
    )
      throw new Error("备份格式或校验和无效，收藏资料库未修改。");
    return document.favorites;
  }

  async previewRestore(path: string) {
    const backup = await this.readBackup(path);
    return { count: backup.length, titles: backup.slice(0, 20).map((f) => f.title) };
  }

  async restore(path: string) {
    const backup = await this.readBackup(path);
    return this.mutate((favorites) => {
      let added = 0,
        skipped = 0,
        conflicts = 0;
      const groups = new Map<string, string>();
      const duplicate = (original: AIFavorite) =>
        favorites.find(
          (f) =>
            (f.id === original.id && JSON.stringify(f) === JSON.stringify(original)) ||
            (f.type === original.type &&
              f.provider === original.provider &&
              f.sessionId === original.sessionId &&
              f.messageId === original.messageId &&
              f.filePath === original.filePath &&
              f.projectPath === original.projectPath &&
              f.snapshot.sha256 === original.snapshot.sha256),
        );
      for (const original of backup) {
        const same = duplicate(original);
        if (original.versionGroupId && same?.versionGroupId && !groups.has(original.versionGroupId))
          groups.set(original.versionGroupId, same.versionGroupId);
      }
      for (const original of backup) {
        const same = duplicate(original);
        if (same) {
          if (original.versionGroupId && !same.versionGroupId) {
            if (!groups.has(original.versionGroupId)) groups.set(original.versionGroupId, randomUUID());
            same.versionGroupId = groups.get(original.versionGroupId);
          }
          skipped++;
          continue;
        }
        const favorite = structuredClone(original);
        if (favorites.some((f) => f.id === favorite.id)) {
          favorite.id = randomUUID();
          conflicts++;
        }
        if (favorite.versionGroupId) {
          const group = favorite.versionGroupId;
          if (!groups.has(group)) groups.set(group, randomUUID());
          favorite.versionGroupId = groups.get(group);
          if (favorites.some((f) => f.versionGroupId === favorite.versionGroupId && f.recommended))
            favorite.recommended = false;
        }
        favorites.push(favorite);
        added++;
      }
      return { added, skipped, conflicts };
    });
  }
}
