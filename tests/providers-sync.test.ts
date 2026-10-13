import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { KiroProvider } from "../src/providers/kiro";
import { GrokProvider } from "../src/providers/grok";
import { ProviderRegistry } from "../src/providers/registry";
import { HistorySync, sourceStatus } from "../src/core/sync";
import { ProviderAdapter, SessionSummary } from "../src/core/types";
import { messageDraft } from "../src/core/favorite-service";
import { FavoriteStore } from "../src/core/store";
import { readSource } from "../src/core/source";

async function json(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value));
}
async function jsonl(path: string, values: unknown[]) {
  await writeFile(path, values.map((v) => JSON.stringify(v)).join("\n") + "\n");
}
const execute = promisify(execFile);

test("overlapping slow background scan does not block foreground or overwrite its newer result", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-sync-overlap-"));
  try {
    let started!: () => void;
    const scanning = new Promise<void>((resolve) => {
      started = resolve;
    });
    let calls = 0;
    const adapter: ProviderAdapter = {
      id: "codex",
      listSessions: async () => {
        const call = ++calls;
        if (call === 1) {
          started();
          await new Promise((resolve) => setTimeout(resolve, 3500));
        }
        return { sessions: [], warnings: [call === 1 ? "older" : "newer"] };
      },
      readSession: async (s) => ({ ...s, messages: [], files: [], warnings: [] }),
    };
    const registry = new ProviderRegistry([adapter]);
    const background = new HistorySync(root, registry).sync();
    await scanning;
    const foreground = new HistorySync(root, registry).sync();
    const latest = await foreground;
    assert.deepEqual(latest.warnings, ["newer"]);
    assert.deepEqual(await background, latest);
    assert.equal(calls, 2);
    assert.ok((await new HistorySync(root, registry).read())?.lastSyncAt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Kiro CLI and IDE readers retain public replies and file references, skip reasoning and replace streamed IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-kiro-"));
  try {
    const cli = join(root, "sessions", "cli"),
      ide = join(root, "sessions", "workspace", "ide-id");
    await mkdir(cli, { recursive: true });
    await mkdir(ide, { recursive: true });
    await json(join(cli, "cli-id.json"), { session_id: "cli-id", cwd: "/project", title: "CLI 方案" });
    await jsonl(join(cli, "cli-id.jsonl"), [
      { kind: "Prompt", data: { message_id: "q", content: [{ kind: "text", data: "问题" }] } },
      {
        kind: "AssistantMessage",
        data: {
          message_id: "a",
          content: [
            { kind: "thinking", data: "private" },
            { kind: "text", data: "方案" },
            { kind: "toolUse", data: { input: { path: "src/A.java" } } },
          ],
        },
      },
    ]);
    await json(join(ide, "session.json"), { id: "ide-id", title: "IDE 方案", workspacePaths: ["/project"] });
    await jsonl(join(ide, "messages.jsonl"), [
      { id: "iq", payload: { type: "user", content: "问题" } },
      { id: "reason", payload: { type: "assistant", operationType: "Reasoning", content: "private" } },
      { id: "ia", payload: { type: "assistant", operationType: "Say", content: "half" } },
      { id: "ia", payload: { type: "assistant", operationType: "Say", content: "完整方案" } },
    ]);
    const provider = new KiroProvider({
      home: root,
      cliDatabase: join(root, "missing.db"),
      legacyIde: join(root, "missing"),
    });
    const list = await provider.listSessions();
    assert.equal(list.sessions.length, 2);
    assert.deepEqual(list.warnings, []);
    const cliSession = await provider.readSession(list.sessions.find((s) => s.id === "cli-id")!);
    assert.deepEqual(
      cliSession.messages.map((m) => m.content),
      ["问题", "方案"],
    );
    assert.ok(cliSession.files.some((f) => f.path === "/project/src/A.java"));
    const ideSession = await provider.readSession(list.sessions.find((s) => s.id === "ide-id")!);
    assert.deepEqual(
      ideSession.messages.map((m) => m.content),
      ["问题", "完整方案"],
    );
    const draft = messageDraft(ideSession, ideSession.messages[1]);
    assert.equal(draft.context?.question, "问题");
    assert.ok((await readSource(draft.source)).includes("完整方案"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Kiro legacy IDE JSON and CLI SQLite support precise source records with no database changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-kiro-old-"));
  try {
    const workspace = join(root, "ide", "workspace-sessions", "encoded");
    await mkdir(workspace, { recursive: true });
    await json(join(workspace, "sessions.json"), [
      { sessionId: "legacy", title: "旧版", workspaceDirectory: "/project" },
    ]);
    await json(join(workspace, "legacy.json"), {
      history: [
        { message: { role: "user", content: "问题" } },
        { message: { role: "assistant", content: "旧版答案" } },
      ],
    });
    const database = join(root, "history.sqlite3");
    const value = JSON.stringify({
      conversation_id: "db-id",
      history: [
        {
          user: { content: { Prompt: { prompt: "数据库问题" } } },
          assistant: { Response: { message_id: "db-a", content: "数据库答案" } },
        },
      ],
    });
    const sqlQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
    await execute("/usr/bin/sqlite3", [
      database,
      `CREATE TABLE conversations_v2(key TEXT,conversation_id TEXT,value TEXT,created_at INTEGER,updated_at INTEGER); INSERT INTO conversations_v2 VALUES ('/project','db-id',${sqlQuote(value)},1,2); CREATE TABLE auth_token(secret TEXT); INSERT INTO auth_token VALUES ('never-read');`,
    ]);
    const before = await readFile(database);
    const provider = new KiroProvider({
      home: join(root, "nohome"),
      cliDatabase: database,
      legacyIde: join(root, "ide"),
    });
    const list = await provider.listSessions();
    assert.equal(list.sessions.length, 2);
    assert.equal(list.warnings.length, 0);
    for (const summary of list.sessions) {
      const session = await provider.readSession(summary);
      assert.equal(session.messages.length, 2);
      const draft = messageDraft(session, session.messages[1]);
      assert.ok((await readSource(draft.source)).includes(session.messages[1].content));
      assert.ok(!JSON.stringify(session).includes("never-read"));
    }
    assert.deepEqual(await readFile(database), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Grok authoritative updates concatenate message chunks, separate tool turns, omit thoughts and keep source lines", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-grok-"));
  try {
    const directory = join(root, "sessions", "encoded", "grok-id");
    await mkdir(directory, { recursive: true });
    await json(join(directory, "summary.json"), {
      info: { id: "grok-id", cwd: "/project" },
      generated_title: "Grok 方案",
    });
    const update = (sessionUpdate: string, fields: Record<string, unknown> = {}) => ({
      timestamp: 1,
      params: { sessionId: "grok-id", update: { sessionUpdate, ...fields } },
    });
    await jsonl(join(directory, "updates.jsonl"), [
      update("user_message_chunk", { content: { type: "text", text: "问题" } }),
      update("agent_thought_chunk", { content: { type: "text", text: "private" } }),
      update("agent_message_chunk", { content: { type: "text", text: "Hello " } }),
      update("agent_message_chunk", { content: { type: "text", text: "world" } }),
      update("tool_call", { rawInput: { target_file: "src/A.java" } }),
      update("agent_message_chunk", { content: { type: "text", text: "完成" } }),
      update("turn_completed"),
    ]);
    const provider = new GrokProvider(root);
    const list = await provider.listSessions();
    assert.equal(list.sessions.length, 1);
    const session = await provider.readSession(list.sessions[0]);
    assert.deepEqual(
      session.messages.map((m) => m.content),
      ["问题", "Hello world", "完成"],
    );
    assert.equal(session.messages[1].line, 3);
    assert.ok(session.files.some((f) => f.path === "/project/src/A.java"));
    assert.ok(!JSON.stringify(session).includes("private"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("automatic sync persists additions/changes/removals, retains failed providers, and never rewrites favorites", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-sync-"));
  try {
    let summaries: SessionSummary[] = [
      {
        id: "same",
        provider: "codex",
        title: "first",
        logPath: "/log",
        createdAt: 1,
        updatedAt: 1,
        archived: false,
        fingerprint: "a".repeat(64),
      },
    ];
    let failure = false,
      warnings: string[] = [];
    const adapter: ProviderAdapter = {
      id: "codex",
      listSessions: async () => {
        if (failure) throw new Error("offline");
        return { sessions: summaries, warnings };
      },
      readSession: async (s) => ({ ...s, messages: [], files: [], warnings: [] }),
    };
    const registry = new ProviderRegistry([adapter]),
      sync = new HistorySync(root, registry);
    const first = await sync.sync();
    assert.equal(first.changes.added.length, 1);
    const store = new FavoriteStore(root);
    const favorite = (
      await store.add(
        {
          type: "session",
          provider: "codex",
          sessionId: "same",
          title: "saved",
          content: "snapshot",
          source: { logPath: "/log" },
          snapshot: { sha256: "b".repeat(64), capturedAt: 1, sourceFingerprint: first.sessions[0].fingerprint },
        },
        { title: "saved", tags: [], note: "" },
      )
    ).favorite;
    const saved = await readFile(store.filePath);
    summaries = [{ ...summaries[0], title: "changed", updatedAt: 2, fingerprint: "c".repeat(64) }];
    const changed = await sync.sync();
    assert.equal(changed.changes.changed.length, 1);
    assert.equal(sourceStatus(favorite, changed), "changed");
    failure = true;
    summaries = [];
    const failed = await sync.sync();
    assert.equal(failed.sessions.length, 1);
    assert.ok(failed.warnings.length);
    failure = false;
    warnings = ["partial"];
    assert.equal((await sync.sync()).sessions.length, 1);
    warnings = [];
    const removed = await sync.sync();
    assert.equal(removed.changes.removed.length, 1);
    assert.equal(sourceStatus(favorite, removed), "missing");
    assert.equal((await new HistorySync(root, registry).read())?.sessions.length, 0);
    assert.deepEqual(await readFile(store.filePath), saved);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
