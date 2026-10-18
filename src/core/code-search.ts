import { AIFavorite } from "./types";

const ignored = new Set(
  "public private protected static void new return class interface const let var import package true false null undefined this function async await string number boolean throws throw final if else for while try catch console error exception get set int long java at".split(
    " ",
  ),
);
export function codeTerms(query: string): { term: string; kind: "异常" | "类名" | "关键词"; weight: number }[] {
  const identifiers = query.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|[\p{Script=Han}]{2,}/gu) || [];
  const terms = new Map<string, { term: string; kind: "异常" | "类名" | "关键词"; weight: number }>();
  for (const identifier of identifiers) {
    const segments = identifier.split(".");
    for (const term of new Set([...segments.filter((part) => /^[A-Z]/.test(part)), segments.at(-1)!])) {
      if (term.length < 2 || ignored.has(term.toLowerCase())) continue;
      const kind = /(?:Exception|Error)$/.test(term) ? "异常" : /^[A-Z][a-zA-Z0-9_$]*$/.test(term) ? "类名" : "关键词";
      const weight = kind === "异常" ? 12 : kind === "类名" ? 6 : 2;
      terms.set(term.toLowerCase(), { term, kind, weight });
    }
  }
  return [...terms.values()].sort((a, b) => b.weight - a.weight).slice(0, 60);
}

export function searchByCode(favorites: AIFavorite[], query: string, options: { includeInvalid?: boolean } = {}) {
  const terms = codeTerms(query);
  return favorites
    .filter((favorite) => options.includeInvalid || favorite.verification?.status !== "invalid")
    .map((favorite) => {
      const text = [
        favorite.title,
        favorite.content,
        favorite.context?.question,
        favorite.context?.previousAssistant,
        favorite.filePath,
        favorite.note,
        favorite.applicability,
        ...favorite.tags,
      ]
        .filter(Boolean)
        .join("\n")
        .normalize("NFKC")
        .toLowerCase();
      const tokens = new Set(text.match(/[\p{L}\p{N}_$]+/gu) || []);
      const matches = terms.filter((t) =>
        /[\p{Script=Han}]/u.test(t.term) ? text.includes(t.term) : tokens.has(t.term.toLowerCase()),
      );
      return { favorite, matches, score: matches.reduce((sum, t) => sum + t.weight, 0) };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || b.favorite.updatedAt - a.favorite.updatedAt);
}
