import { AIFavorite, FavoriteType, ProviderId, Verification } from "./types";
import { excerpt, matchText, normalize, queryGroups, SearchMode } from "./text-search";

export interface FavoriteFilter {
  type?: FavoriteType;
  provider?: ProviderId;
  project?: string;
  tag?: string;
  verification?: Verification["status"];
  includeInvalid?: boolean;
  version?: string;
}
export interface FavoriteHit {
  favorite: AIFavorite;
  score: number;
  matches: string[];
  snippet: string;
  reasons: string[];
}
export function favoriteText(f: AIFavorite): string {
  return [
    f.title,
    f.content,
    f.note,
    f.applicability,
    f.source.label,
    f.verification?.project,
    f.verification?.version,
    f.verification?.note,
    f.tags.join(" "),
    f.projectPath,
    f.filePath,
    f.context?.question,
    f.context?.previousAssistant,
  ]
    .filter(Boolean)
    .join("\n");
}
export function matchesFilter(f: AIFavorite, filter: FavoriteFilter): boolean {
  return (
    (!filter.provider || f.provider === filter.provider) &&
    (!filter.type || f.type === filter.type) &&
    (filter.project === undefined || (f.projectPath || "") === filter.project) &&
    (!filter.tag || f.tags.includes(filter.tag)) &&
    (!filter.verification || (f.verification?.status || "unverified") === filter.verification) &&
    (filter.includeInvalid !== false || filter.verification === "invalid" || f.verification?.status !== "invalid")
  );
}

export class FavoriteSearchIndex {
  constructor(private favorites: AIFavorite[]) {}
  results(query: string, filter: FavoriteFilter = {}, mode: SearchMode = "exact"): FavoriteHit[] {
    const groups = queryGroups(query, mode);
    return this.favorites
      .filter((f) => matchesFilter(f, filter))
      .flatMap((favorite) => {
        const text = favoriteText(favorite),
          result = matchText(text, groups, mode);
        if (query.trim() && !result.matched) return [];
        const titleMatches = result.matches.filter((term) => normalize(favorite.title).includes(term)).length;
        const tagMatches = result.matches.filter((term) => normalize(favorite.tags.join(" ")).includes(term)).length;
        const score = result.matches.length * 10 + titleMatches * 8 + tagMatches * 5 - (result.fuzzy ? 4 : 0);
        const reasons = [titleMatches ? "标题命中" : result.matches.length ? "正文或元数据命中" : "最近收藏"];
        if (result.fuzzy) reasons.push("近似拼写");
        if (mode === "smart") reasons.push("词项扩展（非向量语义）");
        if (favorite.recommended) reasons.push("手动推荐版本");
        const v = favorite.verification;
        if (v?.status === "verified")
          reasons.push(
            `验证范围：${v.project} / ${v.version}${filter.project && filter.project !== v.project ? "（其他项目）" : ""}${filter.version && filter.version !== v.version ? "（版本不同）" : ""}`,
          );
        if (v?.status === "invalid") reasons.push("已失效");
        return [
          { favorite, matches: result.matches, score, snippet: excerpt(favorite.content, result.matches), reasons },
        ];
      })
      .sort((a, b) => {
        const quality = (f: AIFavorite) =>
          filter.project &&
          filter.version &&
          f.verification?.project === filter.project &&
          filter.version === f.verification.version
            ? Number(!!f.recommended) + Number(f.verification.status === "verified")
            : 0;
        return (
          b.score - a.score || quality(b.favorite) - quality(a.favorite) || b.favorite.updatedAt - a.favorite.updatedAt
        );
      });
  }
  search(query: string, filter: FavoriteFilter = {}, mode: SearchMode = "exact"): AIFavorite[] {
    return this.results(query, filter, mode).map((hit) => hit.favorite);
  }
}
