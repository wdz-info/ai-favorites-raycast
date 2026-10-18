import { performance } from "node:perf_hooks";
import { FavoriteSearchIndex } from "../src/core/search";
import { capturedDraft } from "../src/core/capture";
import { AIFavorite } from "../src/core/types";

// Hand-labelled synthetic examples. These are not user history or a model benchmark.
const examples = [
  ["retry", "Network recovery", "RetryPolicy handles SocketTimeoutException with exponential retry backoff."],
  ["deadlock", "Database transactions", "Avoid deadlock by acquiring row locks in consistent order."],
  [
    "idempotency",
    "Repeated request safety",
    "Use an idempotency key and a unique constraint to process a payment once.",
  ],
  ["cache", "Caching", "Cache invalidation with TTL expires stale entries."],
  ["auth", "OAuth", "Authentication using OAuth token expiry and refresh."],
  ["pagination", "API lists", "Cursor-based pagination and stable ordering."],
  ["pool", "Database connections", "Hikari connection pool with bounded lifetime."],
  ["download", "Files", "Streaming download with resumable ranges."],
];
const favorites: AIFavorite[] = examples.map(([id, title, content]) => ({
  ...capturedDraft(title, content, "manual", { label: "synthetic evaluation" }),
  id,
  tags: [],
  createdAt: 1,
  updatedAt: 1,
}));
const cases = [
  ["RetryPolicy", "retry"],
  ["SocketTimeoutException", "retry"],
  ["deadlock", "deadlock"],
  ["idempotency", "idempotency"],
  ["TTL", "cache"],
  ["OAuth", "auth"],
  ["pagination", "pagination"],
  ["Hikari", "pool"],
  ["download", "download"],
  ["重试", "retry"],
  ["超时", "retry"],
  ["死锁", "deadlock"],
  ["重复提交", "idempotency"],
  ["缓存", "cache"],
  ["认证", "auth"],
  ["分页", "pagination"],
  ["连接池", "pool"],
  ["下载", "download"],
  ["retrypolcy", "retry"],
  ["pagintion", "pagination"],
  ["astronomy nebula", ""],
  ["quantum entanglement", ""],
  ["火星天气", ""],
  ["不存在的业务接口", ""],
];
const index = new FavoriteSearchIndex(favorites);
const output = (["exact", "smart"] as const).map((mode) => {
  const start = performance.now();
  const results = cases.map(([query, expected]) => {
    const ids = index
      .search(query, {}, mode)
      .slice(0, 5)
      .map((favorite) => favorite.id);
    return { query, expected: expected || null, ids, correct: expected ? ids.includes(expected) : ids.length === 0 };
  });
  const positive = results.filter((item) => item.expected),
    negative = results.filter((item) => !item.expected);
  return {
    mode,
    positiveHitAt5: positive.filter((item) => item.correct).length / positive.length,
    noResultCorrect: negative.filter((item) => item.correct).length / negative.length,
    elapsedMs: Number((performance.now() - start).toFixed(2)),
    results,
  };
});
process.stdout.write(
  JSON.stringify(
    {
      corpus: "24 manually labelled synthetic queries, 8 synthetic favorites",
      scope: "keyword expansion and bounded spelling tolerance; not semantic model quality",
      embeddingEvaluation: "not run: no local embedding model configured",
      output,
    },
    null,
    2,
  ) + "\n",
);
