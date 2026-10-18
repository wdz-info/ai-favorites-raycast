export type SearchMode = "exact" | "smart";

export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const stop = new Set([
  "我",
  "的",
  "了",
  "之前",
  "那个",
  "这个",
  "如何",
  "怎么",
  "什么",
  "查找",
  "搜索",
  "方案",
  "一下",
  "a",
  "the",
  "how",
  "to",
  "is",
  "with",
  "for",
]);
// Explicit query expansion, not embeddings or generated answers.
const synonyms = [
  ["超时", "timeout", "timed out", "等太久", "sockettimeoutexception"],
  ["重试", "retry", "retrypolicy", "恢复"],
  ["死锁", "deadlock"],
  ["幂等", "idempotent", "idempotency", "重复提交"],
  ["锁", "lock", "分布式锁", "redisson"],
  ["缓存", "cache", "caching"],
  ["鉴权", "认证", "authentication", "oauth", "登录"],
  ["限流", "rate limit", "ratelimit", "throttle"],
  ["连接池", "connection pool", "hikari"],
  ["事务", "transaction"],
  ["分页", "pagination", "paging"],
  ["下载", "download"],
];

export function queryGroups(query: string, mode: SearchMode = "exact"): string[][] {
  const text = normalize(query).trim();
  if (!text) return [];
  if (mode === "exact") return text.split(/\s+/).map((term) => [term]);
  const groups = synonyms.filter((group) => group.some((word) => text.includes(word)));
  const covered = new Set(groups.flatMap((group) => group.filter((word) => text.includes(word))));
  const words = [...segmenter.segment(text)].filter((part) => part.isWordLike).map((part) => part.segment);
  const tokens = words.filter(
    (word) => word.length > 1 && !stop.has(word) && ![...covered].some((term) => term.includes(word)),
  );
  return [...groups, ...tokens.map((word) => [word])].slice(0, 32);
}

export function editDistanceOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1;
}

export function matchText(text: string, groups: string[][], mode: SearchMode = "exact") {
  const value = normalize(text);
  const tokens = mode === "smart" ? value.match(/[a-z0-9_$]+/g) || [] : [];
  const matches: string[] = [];
  let fuzzy = false;
  for (const group of groups) {
    const literal = group.find((word) => value.includes(word));
    if (literal) matches.push(literal);
    else if (mode === "smart") {
      const word = group.find(
        (term) => /^[a-z]{4,}$/.test(term) && tokens.some((token) => editDistanceOne(term, token)),
      );
      if (word) {
        matches.push(word);
        fuzzy = true;
      }
    }
  }
  const count = matches.length;
  return {
    matches,
    fuzzy,
    matched:
      groups.length > 0 &&
      (mode === "exact" ? count === groups.length : count >= Math.max(1, Math.ceil(groups.length * 0.6))),
  };
}

export function excerpt(text: string, terms: string[], length = 260): string {
  const normalized = normalize(text);
  const position = Math.min(...terms.map((term) => normalized.indexOf(term)).filter((i) => i >= 0));
  const start = Number.isFinite(position) ? Math.max(0, position - 70) : 0;
  return `${start ? "…" : ""}${text.slice(start, start + length)}${text.length > start + length ? "…" : ""}`;
}

export function highlight(text: string, terms: string[]): string {
  const escaped = terms
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return escaped.length ? text.replace(new RegExp(escaped.join("|"), "gi"), "**$&**") : text;
}
