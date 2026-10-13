import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CodexProvider } from "../src/providers/codex";
import { FavoriteStore, parseTags } from "../src/core/store";
import { fileDraft, MAX_FILE_BYTES, messageDraft, sessionDraft, sha256 } from "../src/core/favorite-service";
import { FavoriteSearchIndex } from "../src/core/search";
import { codeBlocks, favoriteMarkdown, fileMarkdown } from "../src/core/markdown";
import { expandPath } from "../src/core/paths";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ai-favorites-test-"));
  const project = join(root, "project");
  await mkdir(join(root, "sessions", "2026", "10"), { recursive: true });
  await mkdir(project);
  const log = join(root, "sessions", "2026", "10", "rollout.jsonl");
  const rows = [
    { type: "session_meta", payload: { id: "session-1", timestamp: "2026-10-12T01:00:00Z", cwd: project } },
    {
      type: "response_item",
      payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "Private steering" }] },
    },
    {
      timestamp: "2026-10-12T01:00:01Z",
      type: "event_msg",
      payload: { type: "user_message", message: "如何实现幂等支付？" },
    },
    {
      timestamp: "2026-10-12T01:00:01Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "question-1",
        role: "user",
        content: [
          { type: "input_text", text: "<environment_context>internal</environment_context>" },
          { type: "input_text", text: "如何实现幂等支付？" },
        ],
      },
    },
    {
      timestamp: "2026-10-12T01:00:02Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "reply-1",
        role: "assistant",
        phase: "final",
        content: [{ type: "output_text", text: "使用唯一键和事务。\n\n```java\nprocessOnce();\n```" }],
      },
    },
    {
      timestamp: "2026-10-12T01:00:02Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "使用唯一键和事务。\n\n```java\nprocessOnce();\n```" },
    },
    { type: "response_item", payload: { type: "reasoning", summary: [{ text: "Internal reasoning" }] } },
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        input:
          'await tools.apply_patch("*** Begin Patch\\n*** Add File: service.java\\n+class Service {}\\n*** End Patch")',
      },
    },
    { type: "turn_context", payload: { cwd: join(project, "sub") } },
    {
      type: "response_item",
      payload: { type: "function_call", name: "apply_patch", arguments: "*** Update File: second.md\n@@\n-old\n+new" },
    },
    {
      timestamp: "2026-10-12T01:02:00Z",
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "如何实现幂等支付？" }] },
    },
    {
      timestamp: "2026-10-12T01:02:01Z",
      type: "response_item",
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "第二次回答" }] },
    },
  ];
  await writeFile(log, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await writeFile(
    join(root, "session_index.jsonl"),
    JSON.stringify({ id: "session-1", thread_name: "支付设计", updated_at: "2026-10-12" }) + "\n",
  );
  return { root, project, log, provider: new CodexProvider(root), store: new FavoriteStore(join(root, "favorites")) };
}

const metadata = { title: "Payment Design", tags: ["Java", "架构"], note: "review before reuse" };

test("discovers active/archived history, latest titles, project paths, and reports unreadable logs", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, "archived_sessions"));
    await writeFile(
      join(f.root, "archived_sessions", "archive.jsonl"),
      JSON.stringify({ type: "session_meta", payload: { id: "archived-1", cwd: "/other" } }),
    );
    await writeFile(join(f.root, "sessions", "broken.jsonl"), "{broken\n");
    const result = await f.provider.listSessions();
    assert.equal(result.sessions.length, 2);
    const summary = result.sessions.find((s) => s.id === "session-1")!;
    assert.equal(summary.title, "支付设计");
    assert.equal(summary.projectPath, f.project);
    assert.equal(result.sessions.find((s) => s.id === "archived-1")?.archived, true);
    assert.equal(result.warnings.length, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("parses user/AI messages without system/reasoning or event duplicates, preserves repeated turns and patch cwd", async () => {
  const f = await fixture();
  try {
    const session = await f.provider.readSession((await f.provider.listSessions()).sessions[0]);
    assert.deepEqual(
      session.messages.map((m) => m.role),
      ["user", "assistant", "user", "assistant"],
    );
    assert.equal(session.messages[0].content, "如何实现幂等支付？");
    assert.equal(session.messages[1].id, "reply-1");
    assert.equal(session.messages[1].line, 5);
    assert.deepEqual(
      session.files.map((file) => file.path),
      [join(f.project, "service.java"), join(f.project, "sub", "second.md")],
    );
    assert.equal(session.files[0].origin, "patch");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("reads old event-only logs and flags an incomplete trailing record", async () => {
  const f = await fixture();
  try {
    await writeFile(
      f.log,
      JSON.stringify({ type: "session_meta", payload: { id: "old-1", cwd: f.project } }) +
        "\n" +
        JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "old question" } }) +
        "\n" +
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "old reply" } }) +
        '\n{"type":',
    );
    const session = await f.provider.readSession((await f.provider.listSessions()).sessions[0]);
    assert.deepEqual(
      session.messages.map((m) => m.content),
      ["old question", "old reply"],
    );
    assert.equal(session.warnings.length, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("session/reply snapshots and context remain readable after source deletion; metadata edits preserve snapshots", async () => {
  const f = await fixture();
  try {
    const session = await f.provider.readSession((await f.provider.listSessions()).sessions[0]);
    const sessionFavorite = await f.store.add(sessionDraft(session), metadata);
    const replyFavorite = await f.store.add(messageDraft(session, session.messages[1]), {
      ...metadata,
      title: "single reply",
    });
    assert.equal(replyFavorite.favorite.context?.question, "如何实现幂等支付？");
    assert.match(sessionFavorite.favorite.content, /第二次回答/);
    await rm(f.log);
    const reopened = new FavoriteStore(f.store.directory);
    assert.equal((await reopened.list()).length, 2);
    await reopened.edit(replyFavorite.favorite.id, { title: "renamed", tags: ["changed"], note: "my new note" });
    const edited = (await reopened.list()).find((v) => v.id === replyFavorite.favorite.id)!;
    assert.equal(edited.content, replyFavorite.favorite.content);
    assert.deepEqual(edited.snapshot, replyFavorite.favorite.snapshot);
    assert.deepEqual(edited.source, replyFavorite.favorite.source);
    assert.match(favoriteMarkdown(edited), /如何实现幂等支付/);
    assert.match(favoriteMarkdown(edited), /my new note/);
    const duplicate = await reopened.add(messageDraft(session, session.messages[1]), metadata);
    assert.equal(duplicate.existed, true);
    assert.equal(duplicate.favorite.title, "renamed");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("file versions remain distinct, with full content after mutation and deletion; duplicate versions are idempotent", async () => {
  const f = await fixture();
  try {
    const path = join(f.project, "architecture.md");
    await writeFile(path, "# Original\nversion one");
    const one = await f.store.add(await fileDraft(path), metadata);
    assert.equal((await f.store.add(await fileDraft(path), metadata)).existed, true);
    await writeFile(path, "# Changed\nversion two");
    const two = await f.store.add(await fileDraft(path), metadata);
    assert.notEqual(one.favorite.snapshot.sha256, two.favorite.snapshot.sha256);
    await rm(path);
    const versions = await f.store.list();
    assert.equal(versions.length, 2);
    assert.match(versions[0].content, /version one/);
    assert.match(versions[1].content, /version two/);
    assert.equal(versions[0].filePath, path);
    assert.ok(versions[0].snapshot.fileModifiedAt);
    assert.equal((await stat(f.store.filePath)).mode & 0o777, 0o600);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects directories, binary files, invalid UTF-8, oversized files and relative paths; empty UTF-8 files work", async () => {
  const f = await fixture();
  try {
    const path = join(f.project, "file.txt");
    await assert.rejects(fileDraft(f.project), /普通文本/);
    await writeFile(path, Buffer.from([0, 1, 2]));
    await assert.rejects(fileDraft(path), /二进制/);
    await writeFile(path, Buffer.from([0xff, 0xfe]));
    await assert.rejects(fileDraft(path), /UTF-8/);
    await writeFile(path, Buffer.alloc(MAX_FILE_BYTES + 1, 0x61));
    await assert.rejects(fileDraft(path), /8 MiB/);
    await writeFile(path, "");
    assert.equal((await fileDraft(path)).content, "");
    assert.throws(() => expandPath("relative.txt"), /绝对路径/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("full-text search spans replies, user questions, filenames, notes, tags, projects and supports combined filters", async () => {
  const f = await fixture();
  try {
    const session = await f.provider.readSession((await f.provider.listSessions()).sessions[0]);
    const reply = (await f.store.add(messageDraft(session, session.messages[1]), metadata)).favorite;
    const otherDraft = { ...sessionDraft(session), projectPath: "/other/project" };
    const other = (await f.store.add(otherDraft, { title: "ＡＢＣ guide", tags: ["other"], note: "rollback" }))
      .favorite;
    const index = new FavoriteSearchIndex(await f.store.list());
    assert.deepEqual(
      index.search("processOnce").map((v) => v.id),
      [reply, other].sort((a, b) => b.updatedAt - a.updatedAt).map((v) => v.id),
    );
    assert.equal(index.search("幂等", { type: "message", project: f.project, tag: "Java" })[0].id, reply.id);
    assert.equal(index.search("review reuse", { type: "message" }).length, 1);
    assert.equal(index.search("abc rollback")[0].id, other.id);
    assert.equal(index.search("Java missing").length, 0);
    assert.equal(index.search("", { project: "/other/project", tag: "Java" }).length, 0);
    await f.store.edit(reply.id, { title: "edited", tags: ["fresh"], note: "newword" });
    assert.equal(new FavoriteSearchIndex(await f.store.list()).search("newword", { tag: "fresh" }).length, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("independent store instances writing simultaneously do not lose additions", async () => {
  const f = await fixture();
  try {
    const session = await f.provider.readSession((await f.provider.listSessions()).sessions[0]);
    const draft = sessionDraft(session);
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        new FavoriteStore(f.store.directory).add({ ...draft, sessionId: `concurrent-${i}` }, metadata),
      ),
    );
    assert.equal((await f.store.list()).length, 12);
    assert.equal(new Set((await f.store.list()).map((v) => v.sessionId)).size, 12);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("separate Raycast-like processes serialize writes", async () => {
  const f = await fixture();
  try {
    const processes = Array.from(
      { length: 4 },
      (_, i) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ["--import", "tsx", "scripts/test-writer.ts", f.store.directory, String(i)],
            { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
          );
          let error = "";
          child.stderr.on("data", (chunk) => {
            error += chunk;
          });
          child.on("error", reject);
          child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(error))));
        }),
    );
    await Promise.all(processes);
    assert.equal((await f.store.list()).length, 4);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("damaged stores and future schema versions are never replaced on write failure", async () => {
  const f = await fixture();
  try {
    const session = await f.provider.readSession((await f.provider.listSessions()).sessions[0]);
    await mkdir(f.store.directory);
    for (const raw of [
      "{broken",
      JSON.stringify({ version: 2, favorites: [] }),
      JSON.stringify({ version: 1, favorites: [{ content: "missing identity" }] }),
    ]) {
      await writeFile(f.store.filePath, raw);
      await assert.rejects(f.store.add(sessionDraft(session), metadata), /资料库|JSON/);
      assert.equal(await readFile(f.store.filePath, "utf8"), raw);
      await assert.rejects(stat(join(f.store.directory, ".write-lock")), { code: "ENOENT" });
    }
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("removing a favorite keeps the source file", async () => {
  const f = await fixture();
  try {
    const path = join(f.project, "code.ts");
    await writeFile(path, "const x = 1;");
    const saved = await f.store.add(await fileDraft(path), metadata);
    await f.store.remove(saved.favorite.id);
    assert.equal((await f.store.list()).length, 0);
    assert.equal(await readFile(path, "utf8"), "const x = 1;");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("renders backticks safely, extracts code and normalizes tags without losing Unicode", () => {
  const markdown = fileMarkdown("const x = `hello`;\n```\nembedded fence", "/file.ts");
  assert.ok(markdown.startsWith("````ts"));
  assert.ok(markdown.endsWith("````"));
  assert.equal(codeBlocks("```java\na();\n```\n\n~~~ts\nb();\n~~~"), "a();\n\nb();");
  assert.deepEqual(parseTags("Java, 架构，Java\n可靠性"), ["Java", "架构", "可靠性"]);
});

test("missing Codex home reports a useful error; a valid empty home is browsable", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-favorites-empty-"));
  try {
    await assert.rejects(new CodexProvider(join(root, "missing")).listSessions(), /无法访问 Codex 历史目录/);
    assert.deepEqual(await new CodexProvider(root).listSessions(), { sessions: [], warnings: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("event-only file references use the working directory at their own turn", async () => {
  const f = await fixture();
  try {
    await writeFile(
      f.log,
      [
        { type: "session_meta", payload: { id: "events-cwd", cwd: f.project } },
        { type: "event_msg", payload: { type: "agent_message", message: "Generated `./first.md`" } },
        { type: "turn_context", payload: { cwd: join(f.project, "nested") } },
        { type: "event_msg", payload: { type: "agent_message", message: "Generated `./second.md`" } },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n"),
    );
    const session = await f.provider.readSession((await f.provider.listSessions()).sessions[0]);
    assert.deepEqual(
      session.files.map((file) => file.path),
      [join(f.project, "first.md"), join(f.project, "nested", "second.md")],
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
