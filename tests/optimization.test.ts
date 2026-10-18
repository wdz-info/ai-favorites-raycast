import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { FavoriteStore } from "../src/core/store";
import { capturedDraft } from "../src/core/capture";
import { searchByCode } from "../src/core/code-search";
import { FavoriteSearchIndex } from "../src/core/search";
import { HistoryIndex } from "../src/core/history-index";
import { ProviderRegistry } from "../src/providers/registry";
import { HistoryCatalog } from "../src/core/sync";
import { contextPack } from "../src/core/knowledge";
import { FavoriteReader } from "../src/core/reader";
import { sha256 } from "../src/core/favorite-service";
import { Session } from "../src/core/types";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ai-favorites-upgrade-"));
  const store = new FavoriteStore(join(root, "store"));
  const add = async (title: string, content: string) =>
    (
      await store.add(capturedDraft(title, content, "manual", { label: "合成测试", captureMethod: "manual" }), {
        title,
        tags: [],
        note: "",
      })
    ).favorite;
  return { root, store, add };
}

test("ranked favorites preserve relevance, apply verification filters and only prefer matching verified environments", async () => {
  const f = await fixture();
  try {
    const title = await f.add("RetryPolicy", "original answer");
    const body = await f.add("Other", "RetryPolicy");
    const invalid = await f.add("RetryPolicy invalid", "RetryPolicy failed");
    await f.store.setVerification(invalid.id, { status: "invalid" });
    await f.store.setVerification(body.id, {
      status: "verified",
      project: "/project",
      version: "2",
      date: "2026-10-18",
    });
    const loaded = await f.store.list();
    assert.ok(!searchByCode(loaded, "RetryPolicy").some((hit) => hit.favorite.id === invalid.id));
    assert.ok(
      searchByCode(loaded, "RetryPolicy", { includeInvalid: true }).some((hit) => hit.favorite.id === invalid.id),
    );
    const index = new FavoriteSearchIndex(loaded);
    assert.equal(index.search("RetryPolicy", { includeInvalid: false })[0].id, title.id);
    assert.equal(index.search("", { verification: "verified" })[0].id, body.id);
    assert.equal(index.search("", { verification: "unverified" }).length, 1);
    assert.equal(index.search("", { includeInvalid: false }).length, 2);
    assert.equal(index.search("", { verification: "invalid", includeInvalid: false })[0].id, invalid.id);
    assert.ok(
      index
        .results("RetryPolicy", { version: "3" })
        .find((hit) => hit.favorite.id === body.id)
        ?.reasons.join()
        .includes("版本不同"),
    );
    const newer = { ...title, id: "newer", updatedAt: 200, projectPath: "/project" };
    const older = {
      ...title,
      id: "older",
      updatedAt: 1,
      projectPath: "/project",
      recommended: true,
      verification: { status: "verified" as const, project: "/project", version: "2", date: "2026-10-18" },
    };
    const scoped = new FavoriteSearchIndex([older, newer]);
    assert.equal(scoped.search("RetryPolicy", { project: "/project" })[0].id, "newer");
    assert.equal(scoped.search("RetryPolicy", { project: "/project", version: "2" })[0].id, "older");
    assert.equal(scoped.search("RetryPolicy", { project: "/project", version: "3" })[0].id, "newer");
    const typo = index.search("retrypolcy", {}, "smart");
    assert.ok(typo.some((item) => item.id === title.id));
    assert.equal(index.search("retrypolcy").length, 0);
    assert.equal(index.search("死锁").length, 0);
    const deadlock = await f.add("DB", "deadlock detected");
    assert.equal(new FavoriteSearchIndex(await f.store.list()).search("死锁", {}, "smart")[0].id, deadlock.id);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("history indexes real message content across three adapters incrementally, scopes hits, groups sessions, and retains failed generations", async () => {
  const f = await fixture();
  let reads = 0,
    failure = false;
  const sessions: Session[] = (["codex", "kiro", "grok"] as const).map((provider) => ({
    id: "same-id",
    provider,
    title: "not the needle",
    projectPath: `/project/${provider}`,
    logPath: `/synthetic/${provider}.jsonl`,
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    fingerprint: sha256(provider),
    files: [],
    warnings: [],
    messages: [
      { id: "user", role: "user", content: "Which approach?", timestamp: 1, line: 2 },
      { id: "answer", role: "assistant", content: "unique needle O'Reilly 中文超时", timestamp: 2, line: 3 },
      { id: "answer-2", role: "assistant", content: "needle second reply", timestamp: 3, line: 4 },
    ],
  }));
  sessions[2].messages[1].content += " 中文字符跨越输出块".repeat(5000);
  const registry = new ProviderRegistry(
    sessions.map((session) => ({
      id: session.provider,
      listSessions: async () => ({ sessions: [session], warnings: [] }),
      readSession: async () => {
        reads++;
        if (failure) throw new Error("unreadable");
        return session;
      },
    })),
  );
  const index = new HistoryIndex(f.store.directory, registry);
  const catalog = (stamp: number, items = sessions): HistoryCatalog => ({
    version: 1,
    sessions: items,
    lastSyncAt: stamp,
    lastSuccessfulSync: { codex: stamp, kiro: stamp, grok: stamp },
    changes: { added: [], changed: [], removed: [] },
    warnings: [],
  });
  try {
    const saved = await f.add("Keep", "permanent snapshot");
    const originalStore = await readFile(f.store.filePath, "utf8");
    await index.refresh(catalog(1));
    assert.equal(reads, 3);
    let hits = await index.search("unique needle");
    assert.equal(hits.length, 3);
    assert.ok(
      hits.every(
        (hit) =>
          hit.message.id === "answer" && hit.message.line === 3 && hit.draft?.context?.question === "Which approach?",
      ),
    );
    assert.equal(hits.find((hit) => hit.summary.provider === "grok")?.draft?.content, sessions[2].messages[1].content);
    assert.equal((await index.search("O'Reilly")).length, 3);
    assert.equal((await index.search("超时", { provider: "kiro" })).length, 1);
    assert.equal((await index.search("needle", { project: "/project/codex" })).length, 1);
    await index.refresh(catalog(2));
    assert.equal(reads, 3);
    sessions[0].fingerprint = sha256("changed");
    sessions[0].messages[1].content = "replacement content";
    failure = true;
    assert.equal((await index.refresh(catalog(3))).warnings.length, 1);
    assert.equal((await index.search("unique needle", { provider: "codex" })).length, 1);
    failure = false;
    await index.refresh(catalog(4));
    assert.equal((await index.search("unique needle", { provider: "codex" })).length, 0);
    assert.equal((await index.search("replacement", { provider: "codex" })).length, 1);
    await index.refresh(catalog(3, [])); // An older scan cannot remove newer sources.
    assert.equal((await index.search("replacement", { provider: "codex" })).length, 1);
    await index.refresh(catalog(5, []));
    assert.equal((await index.search("needle")).length, 0);
    assert.equal(await readFile(f.store.filePath, "utf8"), originalStore);
    assert.equal((await stat(index.filePath)).mode & 0o777, 0o600);
    await writeFile(index.filePath, "corrupted derived index");
    await index.clear();
    await index.refresh(catalog(6));
    hits = await index.search("replacement");
    assert.equal(hits.length, 1);
    assert.equal((await f.store.list())[0].snapshot.sha256, saved.snapshot.sha256);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("backup restore validates checksums, merges idempotently and preserves both sides of an ID conflict and manual verification", async () => {
  const f = await fixture();
  try {
    const one = await f.add("One", "first content");
    await f.store.setVerification(one.id, { status: "verified", project: "p", version: "1", date: "2026-10-18" });
    await f.store.recordReuse(one.id, "unresolved");
    assert.equal((await f.store.list())[0].verification?.status, "verified");
    const path = join(f.root, "backup.json");
    await f.store.backup(path);
    await assert.rejects(f.store.backup(path), /EEXIST/);
    assert.equal((await f.store.previewRestore(path)).count, 1);
    await f.store.edit(one.id, { title: "Local edits", tags: ["keep"], note: "retain this note" });
    assert.deepEqual(await f.store.restore(path), { added: 0, skipped: 1, conflicts: 0 });
    const source = JSON.parse(await readFile(path, "utf8"));
    source.favorites[0].content = "distinct snapshot";
    source.favorites[0].snapshot.sha256 = sha256("distinct snapshot");
    source.sha256 = sha256(JSON.stringify(source.favorites));
    const conflict = join(f.root, "conflict.json");
    await writeFile(conflict, JSON.stringify(source));
    assert.deepEqual(await f.store.restore(conflict), { added: 1, skipped: 0, conflicts: 1 });
    assert.equal((await f.store.list()).find((favorite) => favorite.id === one.id)?.note, "retain this note");
    assert.equal((await f.store.list()).length, 2);
    assert.deepEqual(await f.store.restore(conflict), { added: 0, skipped: 1, conflicts: 0 });
    source.favorites[0].content = "tampered";
    await writeFile(conflict, JSON.stringify(source));
    const before = await readFile(f.store.filePath, "utf8");
    await assert.rejects(f.store.restore(conflict), /校验和/);
    assert.equal(await readFile(f.store.filePath, "utf8"), before);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("context packs deduplicate code and favorites, obey budgets, exclude selections/paths, and expose invalid evidence", async () => {
  const f = await fixture();
  try {
    const one = await f.add("Solution", "```ts\nuniqueFunction();\n```\n" + "x".repeat(20000));
    one.source.logPath = "/private/path/history.jsonl";
    one.verification = { status: "invalid" };
    const full = contextPack([one, one], "task", { maxChars: 10000, includePaths: false });
    assert.equal(full.match(/uniqueFunction\(\);/g)?.length, 1);
    assert.ok(!full.includes("/private/path"));
    assert.ok(full.includes(one.id));
    assert.ok(full.includes("已失效"));
    assert.ok(full.includes("内容已截取"));
    assert.ok(full.length <= 10000);
    assert.throws(() => contextPack([one], "", { excludeIds: [one.id] }), /至少选择/);
    assert.throws(() => contextPack([one], "", { maxChars: 2 }), /长度/);
    const small = contextPack([one], "a".repeat(3000), { maxChars: 1000 });
    assert.ok(small.length <= 1000);
    assert.ok(small.includes(one.id));
    assert.ok(small.includes("已失效"));
    assert.equal(contextPack([one], "", { mode: "code" }).match(/uniqueFunction\(\);/g)?.length, 1);
    const reader = new FavoriteReader(f.store);
    const page = await reader.get(one.id, 10, 20);
    assert.equal(page.content.length, 20);
    assert.equal(page.nextOffset, 30);
    await assert.rejects(reader.get(one.id, -1, 10), /分页/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("optional loopback embedding retrieval caches hashes, supplements lexical hits, and falls back without changing favorites", async () => {
  const f = await fixture();
  let calls = 0;
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    calls++;
    const { input } = JSON.parse(text) as { input: string[] };
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({ embeddings: input.map((value) => (/RetryPolicy|等太久/.test(value) ? [1, 0] : [0, 1])) }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  try {
    const one = await f.add("Solution", "RetryPolicy");
    await f.add("Other", "pagination");
    const original = await readFile(f.store.filePath, "utf8");
    const reader = new FavoriteReader(f.store, {
      model: "fixture-model",
      endpoint: `http://127.0.0.1:${address.port}`,
    });
    assert.equal((await reader.search("连接等太久如何恢复", {}, "exact")).hits.length, 0);
    assert.equal(calls, 0);
    const first = await reader.search("连接等太久如何恢复", {}, "hybrid");
    assert.equal(first.hits[0].favorite.id, one.id);
    assert.ok(first.hits[0].reasons.join().includes("语义"));
    assert.equal(calls, 2);
    await reader.search("连接等太久如何恢复", {}, "hybrid");
    assert.equal(calls, 3);
    const exact = await reader.search("pagination", {}, "hybrid");
    assert.equal(exact.hits[0].favorite.title, "Other");
    const remote = new FavoriteReader(f.store, { model: "fixture-model", endpoint: "https://example.org" });
    assert.ok((await remote.search("RetryPolicy", {}, "hybrid")).warnings.join().includes("loopback"));
    assert.equal(await readFile(f.store.filePath, "utf8"), original);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(f.root, { recursive: true, force: true });
  }
});

test("restore links existing version members, preserves local recommendation and resumes a budgeted index", async () => {
  const f = await fixture();
  try {
    const one = await f.add("old", "old answer"),
      two = await f.add("new", "new answer");
    await f.store.recommend(two.id, one.id);
    const backup = join(f.root, "versions.json");
    await f.store.backup(backup);
    await f.store.remove(two.id);
    await f.store.recommend(one.id);
    const [current] = await f.store.list();
    await f.store.restore(backup);
    const restored = await f.store.list();
    assert.equal(restored.length, 2);
    assert.ok(restored.every((favorite) => favorite.versionGroupId === current.versionGroupId));
    assert.equal(restored.filter((favorite) => favorite.recommended).length, 1);
    assert.equal(restored.find((favorite) => favorite.recommended)?.id, one.id);
    const summary = {
      id: "budget",
      provider: "codex" as const,
      title: "budget",
      logPath: "/synthetic/budget.jsonl",
      createdAt: 1,
      updatedAt: 1,
      archived: false,
    };
    const index = new HistoryIndex(
      f.store.directory,
      new ProviderRegistry([
        {
          id: "codex",
          listSessions: async () => ({ sessions: [summary], warnings: [] }),
          readSession: async () => ({
            ...summary,
            files: [],
            warnings: [],
            messages: [{ id: "m", role: "assistant", content: "budget needle", timestamp: 1, line: 1 }],
          }),
        },
      ]),
    );
    const catalog: HistoryCatalog = {
      version: 1,
      sessions: [summary],
      lastSyncAt: 1,
      lastSuccessfulSync: { codex: 1 },
      changes: { added: [], removed: [], changed: [] },
      warnings: [],
    };
    assert.equal((await index.refresh(catalog, undefined, 0)).indexed, 0);
    assert.equal((await index.search("needle")).length, 0);
    assert.equal((await index.refresh(catalog)).indexed, 1);
    assert.equal((await index.search("needle")).length, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("compact context uses current task to locate a later passage without changing the snapshot", async () => {
  const f = await fixture();
  try {
    const favorite = await f.add(
      "Long discussion",
      "Introduction ".repeat(1000) + "\n\nCritical RetryPolicy details at the end.",
    );
    const text = contextPack([favorite], "RetryPolicy", { mode: "compact", maxChars: 4000 });
    assert.ok(text.includes("Critical RetryPolicy details"));
    assert.ok(text.includes("原文片段"));
    assert.equal((await f.store.list())[0].content, favorite.content);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
