import { AIFavorite, FavoriteType, ProviderId } from "./types";

export interface FavoriteFilter {
  type?: FavoriteType;
  provider?: ProviderId;
  project?: string;
  tag?: string;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

// An in-memory full-text index; snapshots stay in the durable JSON store.
// Trigram postings narrow long terms, followed by exact substring verification.
export class FavoriteSearchIndex {
  private text = new Map<string, string>();
  private postings = new Map<string, Set<string>>();
  constructor(private favorites: AIFavorite[]) {
    for (const f of favorites) {
      const text = normalize(
        [
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
          .join("\n"),
      );
      this.text.set(f.id, text);
      for (let i = 0; i <= text.length - 3; i++) {
        const gram = text.slice(i, i + 3);
        const posting = this.postings.get(gram) || new Set<string>();
        posting.add(f.id);
        this.postings.set(gram, posting);
      }
    }
  }
  search(query: string, filter: FavoriteFilter = {}): AIFavorite[] {
    const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
    let candidates: Set<string> | undefined;
    for (const term of terms) {
      for (let i = 0; i <= term.length - 3; i++) {
        const posting = this.postings.get(term.slice(i, i + 3)) || new Set<string>();
        candidates = candidates ? new Set([...candidates].filter((id) => posting.has(id))) : new Set(posting);
        if (candidates.size === 0) return [];
      }
    }
    return this.favorites
      .filter(
        (f) =>
          (!candidates || candidates.has(f.id)) &&
          terms.every((term) => this.text.get(f.id)!.includes(term)) &&
          (!filter.provider || f.provider === filter.provider) &&
          (!filter.type || f.type === filter.type) &&
          (filter.project === undefined || (f.projectPath || "") === filter.project) &&
          (!filter.tag || f.tags.includes(filter.tag)),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
