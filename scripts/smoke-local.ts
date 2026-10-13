import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexProvider } from "../src/providers/codex";
import { codexHome, kiroHome, kiroDatabase, kiroLegacyIde, grokHome } from "../src/core/paths";
import { KiroProvider } from "../src/providers/kiro";
import { GrokProvider } from "../src/providers/grok";
import { ProviderRegistry } from "../src/providers/registry";
import { HistorySync } from "../src/core/sync";
import { contextPack } from "../src/core/knowledge";
import { exportFavorites } from "../src/core/export";
import { fileDraft, messageDraft, sessionDraft } from "../src/core/favorite-service";
import { FavoriteStore } from "../src/core/store";
import { FavoriteSearchIndex } from "../src/core/search";
import { favoriteMarkdown } from "../src/core/markdown";
import assert from "node:assert/strict";

async function main() {
  const registry = new ProviderRegistry([
    new CodexProvider(codexHome()),
    new KiroProvider({ home: kiroHome(), cliDatabase: kiroDatabase(), legacyIde: kiroLegacyIde() }),
    new GrokProvider(grokHome()),
  ]);
  const root = await mkdtemp(join(tmpdir(), "ai-favorites-smoke-"));
  try {
    const sync = new HistorySync(root, registry);
    const catalog = await sync.sync();
    const store = new FavoriteStore(root);
    const metadata = { title: "Local Smoke Verification", tags: ["smoke-check"], note: "isolated temporary storage" };
    for (const adapter of registry.adapters) {
      const summaries = catalog.sessions.filter((s) => s.provider === adapter.id);
      console.log(`${adapter.id}: ${summaries.length} discovered sessions.`);
      if (!summaries.length) throw new Error(`${adapter.id}: no local sessions available for verification.`);
      let selected;
      for (const summary of summaries.slice(0, 20)) {
        const session = await adapter.readSession(summary);
        if (session.messages.some((m) => m.role === "assistant")) {
          selected = session;
          break;
        }
      }
      if (!selected) throw new Error(`${adapter.id}: no readable reply in recent histories.`);
      const reply = selected.messages.findLast((m) => m.role === "assistant")!;
      for (const draft of [
        sessionDraft(selected),
        messageDraft(selected, reply),
        await fileDraft(join(process.cwd(), "README.md"), selected),
      ])
        await store.add(draft, metadata);
      console.log(
        `${adapter.id}: parsed ${selected.messages.length} visible messages, ${selected.files.length} file references; snapshot round-trip passed.`,
      );
    }
    const reopened = await new FavoriteStore(root).list();
    assert.equal(reopened.length, 9);
    assert.equal(new FavoriteSearchIndex(reopened).search("smoke-check").length, 9);
    assert.ok(reopened.every((f) => favoriteMarkdown(f).length > 0));
    const pack = contextPack(reopened);
    assert.ok(pack.includes("### 来源"));
    const exported = await exportFavorites(reopened, root, "export");
    assert.equal(exported.files.length, 9);
    assert.equal(exported.errors.length, 0);
    console.log(
      `Read warnings: ${catalog.warnings.length}; clean-provider sync: ${Object.keys(catalog.lastSuccessfulSync).join(", ")}.`,
    );
    console.log(
      "PASS: three real local providers, isolated sync catalog, session/reply/file snapshots, persistence, search, context pack and Markdown export. No original histories or production favorites changed.",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
