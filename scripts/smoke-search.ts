import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createServices } from "../src/services";

async function main() {
  const root = await mkdtemp(join(tmpdir(), "ai-favorites-search-smoke-"));
  try {
    const services = createServices({ storageDirectory: root, openCodexLinks: false });
    const catalog = await services.sync.sync();
    const counts = Object.fromEntries(
      services.provider.adapters.map((adapter) => [
        adapter.id,
        catalog.sessions.filter((s) => s.provider === adapter.id).length,
      ]),
    );
    process.stdout.write(JSON.stringify({ phase: "discovered", counts, warnings: catalog.warnings.length }) + "\n");
    let start = performance.now();
    const cold = await services.historyIndex.refresh(catalog, (done, total) => {
      if (done % 100 === 0 || done === total)
        process.stdout.write(JSON.stringify({ phase: "indexing", done, total }) + "\n");
    });
    const coldMs = performance.now() - start;
    start = performance.now();
    const warm = await services.historyIndex.refresh({ ...catalog, lastSyncAt: Date.now() });
    const warmMs = performance.now() - start;
    const queries = [];
    for (const query of ["timeout", "重试", "idempotency"]) {
      start = performance.now();
      const hits = await services.historyIndex.search(query);
      queries.push({ query, hits: hits.length, ms: Math.round(performance.now() - start) });
    }
    process.stdout.write(
      JSON.stringify({
        phase: "complete",
        coldMs: Math.round(coldMs),
        warmMs: Math.round(warmMs),
        changedOnWarm: warm.indexed,
        warnings: cold.warnings.length,
        indexBytes: (await stat(services.historyIndex.filePath)).size,
        queries,
      }) + "\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  process.stderr.write((error as Error).message + "\n");
  process.exitCode = 1;
});
