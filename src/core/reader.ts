import { FavoriteStore } from "./store";
import { FavoriteFilter, FavoriteHit, FavoriteSearchIndex } from "./search";
import { EmbeddingOptions, SemanticSearch } from "./semantic";
import { excerpt } from "./text-search";
import { contextPack, PackOptions, sourceMarkdown, verificationText } from "./knowledge";

function verificationSummary(favorite: import("./types").AIFavorite) {
  const v = favorite.verification;
  return v
    ? {
        status: v.status,
        project: v.project?.slice(0, 500),
        version: v.version?.slice(0, 100),
        date: v.date,
        note: v.note?.slice(0, 1000),
      }
    : { status: "unverified" };
}

export type RetrievalMode = "exact" | "smart" | "hybrid";
export class FavoriteReader {
  constructor(
    readonly store: FavoriteStore,
    readonly embedding: EmbeddingOptions = {},
  ) {}
  async search(query: string, filter: FavoriteFilter = {}, mode: RetrievalMode = "exact", limit = 30) {
    const favorites = await this.store.list();
    const index = new FavoriteSearchIndex(favorites);
    const hits = index.results(query, { includeInvalid: false, ...filter }, mode === "exact" ? "exact" : "smart");
    const warnings: string[] = [];
    if (mode === "hybrid" && query.trim()) {
      // Exact lexical hits remain first; embeddings only supplement absent results.
      const exact = index.results(query, { includeInvalid: false, ...filter });
      const seen = new Set(exact.map((hit) => hit.favorite.id));
      const ordered = [...exact, ...hits.filter((hit) => !seen.has(hit.favorite.id))];
      hits.splice(0, hits.length, ...ordered);
      try {
        const semantic = await new SemanticSearch(this.store.directory, this.embedding).search(favorites, query, {
          includeInvalid: false,
          ...filter,
        });
        for (const { favorite, score } of semantic) {
          if (hits.some((hit) => hit.favorite.id === favorite.id)) continue;
          hits.push({
            favorite,
            score,
            matches: [],
            snippet: excerpt(favorite.content, []),
            reasons: [`本地语义相似：${score.toFixed(2)}（实验）`, verificationText(favorite)],
          });
        }
      } catch (error) {
        warnings.push(`${(error as Error).message} 当前结果来自词项检索。`);
      }
    }
    return { hits: hits.slice(0, Math.min(100, Math.max(1, limit))), warnings };
  }
  async get(id: string, offset = 0, maxChars = 12000) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(maxChars) || maxChars < 1 || maxChars > 50000)
      throw new Error("分页参数无效。");
    const favorite = (await this.store.list()).find((f) => f.id === id);
    if (!favorite) throw new Error("该收藏不存在。");
    return {
      id,
      title: favorite.title.slice(0, 200),
      verification: verificationSummary(favorite),
      recommended: !!favorite.recommended,
      source: sourceMarkdown(favorite).slice(0, 4000),
      snapshot: favorite.snapshot,
      context: favorite.context
        ? {
            question: favorite.context.question?.slice(0, 2000),
            previousAssistant: favorite.context.previousAssistant?.slice(0, 2000),
          }
        : undefined,
      applicability: favorite.applicability?.slice(0, 1000),
      note: favorite.note?.slice(0, 1000),
      content: favorite.content.slice(offset, offset + maxChars),
      totalChars: favorite.content.length,
      nextOffset: offset + maxChars < favorite.content.length ? offset + maxChars : undefined,
      historicalData: true,
    };
  }
  async pack(ids: string[], task = "", options: PackOptions = {}) {
    const favorites = await this.store.list();
    const selected = [...new Set(ids)].map((id) => {
      const favorite = favorites.find((f) => f.id === id);
      if (!favorite) throw new Error(`收藏不存在：${id}`);
      return favorite;
    });
    return contextPack(selected, task, options);
  }
}
export function summarizeHit(hit: FavoriteHit) {
  const f = hit.favorite;
  return {
    id: f.id,
    title: f.title.slice(0, 200),
    provider: f.provider,
    type: f.type,
    snippet: hit.snippet,
    matches: hit.matches,
    reasons: hit.reasons,
    project: f.projectPath?.slice(0, 1000),
    verification: verificationSummary(f),
    recommended: !!f.recommended,
  };
}
