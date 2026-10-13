import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturedDraft, captureText } from "../src/core/capture";
import { contextPack, obsidianMarkdown } from "../src/core/knowledge";
import { exportFavorites } from "../src/core/export";
import { FavoriteStore } from "../src/core/store";
import { fileDraft } from "../src/core/favorite-service";
import { snapshotDiff, versionKey } from "../src/core/versions";
import { codeTerms, searchByCode } from "../src/core/code-search";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ai-knowledge-"));
  const store = new FavoriteStore(join(root, "store"));
  const { favorite } = await store.add(
    capturedDraft("重试方案", "Use RetryPolicy for SocketTimeoutException.\n\n```java\nretry();\n```", "manual", {
      label: "项目讨论",
      url: "https://example.org/discussion",
      captureMethod: "selection",
    }),
    { title: "重试方案", tags: ["Java", "并发"], note: "个人备注", applicability: "Java 21" },
  );
  favorite.context = { question: "网络超时怎么办？", previousAssistant: "先设置请求超时" };
  return { root, store, favorite };
}

test("selection capture falls back only when selection is empty/unavailable, and preserves honest provenance", async () => {
  let clipboardReads = 0;
  const clipboard = async () => {
    clipboardReads++;
    return "clipboard content";
  };
  assert.deepEqual(await captureText(async () => "selection content", clipboard), {
    text: "selection content",
    method: "selection",
  });
  assert.equal(clipboardReads, 0);
  assert.equal(
    (
      await captureText(async () => {
        throw new Error("app unavailable");
      }, clipboard)
    ).method,
    "clipboard",
  );
  assert.equal((await captureText(async () => "  ", clipboard)).text, "clipboard content");
  assert.equal(
    (
      await captureText(async () => {
        throw new Error("Selection is unavailable");
      }, clipboard)
    ).selectionIssue,
    "Selection is unavailable",
  );
  assert.deepEqual(
    await captureText(
      async () => "",
      async () => undefined,
    ),
    { text: "", method: "manual" },
  );
  assert.throws(() => capturedDraft("title", "content", "manual", {}), /来源/);
  const draft = capturedDraft("title", "content", "manual", { label: "clipboard", captureMethod: "clipboard" });
  assert.equal(draft.sessionId, undefined);
  assert.equal(draft.source.application, undefined);
});

test("context packs preserve question, solution, applicability, code, provenance, validation and notes", async () => {
  const f = await fixture();
  try {
    f.favorite.verification = { status: "verified", project: "交易项目", version: "v2", date: "2026-10-13" };
    const markdown = contextPack(
      [f.favorite, { ...f.favorite, id: "other", title: "第二方案", applicability: undefined }],
      "修复超时",
    );
    for (const text of [
      "问题",
      "方案",
      "适用条件",
      "代码",
      "来源",
      "网络超时怎么办",
      "Java 21",
      "retry();",
      "example.org/discussion",
      "个人备注",
      "已验证",
      "交易项目",
      "v2",
      "2026-10-13",
      "第二方案",
      "修复超时",
      "未记录，请结合项目环境验证",
    ])
      assert.ok(markdown.includes(text), text);
    assert.throws(() => contextPack([]), /至少选择/);
    const exported = obsidianMarkdown(f.favorite);
    assert.ok(exported.startsWith("---\n"));
    assert.ok(exported.includes('tags: ["Java","并发"]'));
    assert.ok(exported.includes('source_url: "https://example.org/discussion"'));
    assert.ok(exported.includes("网络超时怎么办"));
    assert.ok(exported.includes("先设置请求超时"));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("single/batch Obsidian export produces navigable notes, preserves edited notes and rejects escaping paths", async () => {
  const f = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "ai-export-outside-"));
  try {
    const first = await exportFavorites([f.favorite], f.root, "知识/AI 收藏");
    assert.equal(first.errors.length, 0);
    const path = first.files[0].path;
    const contents = await readFile(path, "utf8");
    assert.ok(contents.includes("个人备注"));
    const uri = new URL(first.files[0].uri);
    assert.equal(uri.searchParams.get("path"), path);
    assert.ok(path.startsWith(await realpath(f.root)));
    assert.equal(uri.searchParams.has("vault"), false);
    assert.ok(first.files[0].uri.includes("%20"));
    await writeFile(path, "User edited this note");
    const next = await exportFavorites(
      [f.favorite, { ...f.favorite, id: "second", title: "../../new:*?#" }],
      f.root,
      "知识/AI 收藏",
    );
    assert.equal(next.files.length, 2);
    assert.notEqual(next.files[0].path, path);
    assert.equal(await readFile(path, "utf8"), "User edited this note");
    await assert.rejects(exportFavorites([f.favorite], f.root, "../outside"), /仓库内/);
    await symlink(outside, join(f.root, "escaped"));
    await assert.rejects(exportFavorites([f.favorite], f.root, "escaped/new"), /仓库外/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("version diff and recommendations retain snapshots, link corrected replies and keep future file versions grouped", async () => {
  const f = await fixture();
  try {
    const path = join(f.root, "service.java"),
      metadata = { title: "service", tags: [], note: "" };
    await writeFile(path, "timeout(10);\n");
    const old = (await f.store.add(await fileDraft(path), metadata)).favorite;
    await writeFile(path, "timeout(30);\n");
    const latest = (await f.store.add(await fileDraft(path), metadata)).favorite;
    const diff = snapshotDiff(old, latest);
    assert.ok(diff.includes("-timeout(10);"));
    assert.ok(diff.includes("+timeout(30);"));
    await f.store.recommend(latest.id, old.id);
    const reopened = await f.store.list();
    assert.equal(reopened.find((v) => v.id === old.id)?.content, old.content);
    assert.equal(reopened.filter((v) => v.recommended).length, 1);
    assert.equal(
      versionKey(reopened.find((v) => v.id === old.id)!),
      versionKey(reopened.find((v) => v.id === latest.id)!),
    );
    await writeFile(path, "timeout(60);\n");
    const third = (await f.store.add(await fileDraft(path), metadata)).favorite;
    assert.equal(third.versionGroupId, reopened.find((v) => v.id === latest.id)?.versionGroupId);
    await f.store.recommend(old.id, f.favorite.id);
    assert.equal((await f.store.list()).filter((v) => v.recommended).length, 1);
    assert.equal((await f.store.list()).length, 4);
    const contextDiff = snapshotDiff(f.favorite, { ...f.favorite, context: { question: "different question" } });
    assert.ok(contextDiff.includes("+different question"));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("verification is manual, records project/version/date, keeps content and supports invalidation", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.store.list())[0].verification, undefined);
    await assert.rejects(f.store.setVerification(f.favorite.id, { status: "verified" }), /项目、版本和日期/);
    const validation = {
      status: "verified" as const,
      project: "payment",
      version: "2.0",
      date: "2026-10-13",
      note: "集成测试成功",
    };
    await f.store.setVerification(f.favorite.id, validation);
    const verified = (await new FavoriteStore(f.store.directory).list())[0];
    assert.deepEqual(verified.verification, validation);
    assert.equal(verified.content, f.favorite.content);
    await f.store.setVerification(f.favorite.id, { ...validation, status: "invalid", note: "API 3.0 已移除" });
    assert.equal((await f.store.list())[0].verification?.status, "invalid");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("error/code search prioritizes exact exceptions, then classes, excludes code boilerplate and reveals lexical limits", async () => {
  const f = await fixture();
  try {
    const classOnly = {
      ...f.favorite,
      id: "class",
      content: "RetryPolicy",
      title: "policy",
      note: "",
      context: undefined,
      tags: [],
      applicability: undefined,
    };
    const substring = { ...classOnly, id: "substring", content: "OtherSocketTimeoutException RetryPolicyFactory" };
    const query = "java.net.SocketTimeoutException: read timed out\n at RetryPolicy.execute(RetryPolicy.java:14)";
    const results = searchByCode([classOnly, substring, f.favorite], query);
    assert.equal(results[0].favorite.id, f.favorite.id);
    assert.ok(results[0].matches.some((t) => t.kind === "异常"));
    assert.equal(
      results.some((r) => r.favorite.id === "substring"),
      false,
    );
    assert.equal(codeTerms("public static void return new null").length, 0);
    assert.equal(searchByCode([classOnly], "连接等太久如何恢复").length, 0); // semantic gap is explicit
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
