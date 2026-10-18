import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AIFavorite } from "./types";
import { FavoriteFilter, favoriteText, matchesFilter } from "./search";
import { sha256 } from "./favorite-service";
import { withDirectoryLock, writeJsonAtomically } from "./atomic-json";

export interface EmbeddingOptions {
  model?: string;
  endpoint?: string;
}
interface VectorEntry {
  hash: string;
  vector: number[];
}
interface VectorCache {
  version: 1;
  key: string;
  entries: Record<string, VectorEntry>;
}
function validVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 8192 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    value.some((n) => n !== 0)
  );
}
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("嵌入维度不一致，请重新建立语义缓存。");
  const norm = Math.sqrt(a.reduce((sum, n) => sum + n * n, 0) * b.reduce((sum, n) => sum + n * n, 0));
  return norm ? a.reduce((sum, n, i) => sum + n * b[i], 0) / norm : 0;
}
export class SemanticSearch {
  private endpoint: string;
  constructor(
    readonly directory: string,
    readonly options: EmbeddingOptions,
  ) {
    this.endpoint = (options.endpoint || "http://127.0.0.1:11434").replace(/\/$/, "");
  }
  private async embed(input: string[]): Promise<number[][]> {
    const endpoint = new URL(this.endpoint);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
      endpoint.username ||
      endpoint.password
    )
      throw new Error("本地嵌入服务仅支持 loopback 地址。");
    const response = await fetch(new URL("/api/embed", endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "error",
      body: JSON.stringify({ model: this.options.model, input, truncate: true }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`本地嵌入服务返回 ${response.status}，请检查模型是否已安装。`);
    const value = (await response.json()) as { embeddings?: unknown[] };
    if (
      !Array.isArray(value.embeddings) ||
      value.embeddings.length !== input.length ||
      !value.embeddings.every(validVector)
    )
      throw new Error("嵌入服务返回无效向量。");
    return value.embeddings;
  }
  async search(favorites: AIFavorite[], query: string, filter: FavoriteFilter = {}) {
    if (!this.options.model?.trim()) throw new Error("未配置本地嵌入模型，已使用词项检索。");
    const filePath = join(this.directory, "favorite-vectors.json");
    const key = JSON.stringify([this.endpoint, this.options.model]);
    let cache: VectorCache = { version: 1, key, entries: {} };
    try {
      const existing = JSON.parse(await readFile(filePath, "utf8")) as VectorCache;
      if (existing.version === 1 && existing.key === key && existing.entries && typeof existing.entries === "object")
        cache = existing;
    } catch {
      /* This derived cache can be rebuilt; permanent snapshots are untouched. */
    }
    const candidates = favorites.filter((favorite) => matchesFilter(favorite, filter));
    const inputs = candidates.map((favorite) => ({ favorite, text: favoriteText(favorite).slice(0, 12000) }));
    const missing = inputs.filter(
      ({ favorite, text }) =>
        cache.entries[favorite.id]?.hash !== sha256(text) || !validVector(cache.entries[favorite.id]?.vector),
    );
    const changed: Record<string, VectorEntry> = {};
    for (let start = 0; start < missing.length; start += 8) {
      const batch = missing.slice(start, start + 8);
      const vectors = await this.embed(batch.map((item) => item.text));
      batch.forEach((item, i) => {
        changed[item.favorite.id] = { hash: sha256(item.text), vector: vectors[i] };
      });
    }
    if (missing.length) {
      await withDirectoryLock(this.directory, ".vectors-lock", async () => {
        let entries = cache.entries;
        try {
          const latest = JSON.parse(await readFile(filePath, "utf8"));
          if (latest.key === key) entries = latest.entries || {};
        } catch {
          /* Rebuild. */
        }
        cache = { version: 1, key, entries: { ...entries, ...changed } };
        const ids = new Set(favorites.map((favorite) => favorite.id));
        cache.entries = Object.fromEntries(Object.entries(cache.entries).filter(([id]) => ids.has(id)));
        await writeJsonAtomically(this.directory, filePath, cache);
      });
    }
    const [vector] = await this.embed([query.slice(0, 2000)]);
    return candidates
      .map((favorite) => ({ favorite, score: cosine(vector, cache.entries[favorite.id].vector) }))
      .filter((hit) => hit.score >= 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }
}
