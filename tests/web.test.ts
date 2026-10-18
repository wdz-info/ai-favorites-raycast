import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { request as httpRequest } from "node:http";
import { createServices, Preferences } from "../src/services";
import { startWebServer } from "../src/web/server";
import { ensureWebServer, reachable, WebState } from "../src/web/launcher";
import { capturedDraft } from "../src/core/capture";
import { fileDraft } from "../src/core/favorite-service";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ai-favorites-web-"));
  const preferences: Preferences = {
    storageDirectory: join(root, "library"),
    codexHome: join(root, "codex"),
    kiroHome: join(root, "no-kiro"),
    kiroDatabase: join(root, "no-kiro.sqlite"),
    kiroLegacyIde: join(root, "no-ide"),
    grokHome: join(root, "no-grok"),
    openCodexLinks: false,
  };
  await mkdir(join(root, "codex/sessions"), { recursive: true });
  await writeFile(
    join(root, "codex/sessions/rollout.jsonl"),
    [
      { type: "session_meta", payload: { id: "web-session", cwd: root } },
      {
        type: "response_item",
        payload: {
          type: "message",
          id: "question",
          role: "user",
          content: [{ type: "input_text", text: "如何避免重复扣款？" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          id: "reply",
          role: "assistant",
          content: [{ type: "output_text", text: "使用幂等键。\n\n```ts\nprocessOnce();\n```" }],
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n",
  );
  const services = createServices(preferences);
  const server = await startWebServer({ services, assetsDirectory: resolve("assets/web") });
  async function call(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`${server.origin}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${server.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  }
  return {
    root,
    preferences,
    services,
    ...server,
    call,
    async cleanup() {
      if (server.server.listening) await server.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("web API shares immutable favorites with Raycast storage and manages search, metadata, verification, feedback, versions and packs", async () => {
  const f = await fixture();
  try {
    const created = await f.call("/favorites", "POST", {
      kind: "text",
      content: "# 重试方案\n\nUse RetryPolicy.\n\n```ts\nretry();\n```",
      tags: ["重试"],
      note: "timeout policy",
    });
    const id = created.favorite.id;
    assert.equal((await f.services.store.list())[0].id, id);
    const original = (await f.services.store.list())[0];
    await f.call(`/favorites/${id}`, "PATCH", {
      title: "重试与幂等",
      tags: ["Java"],
      note: "付款重试",
      content: "cannot replace snapshot",
    });
    const saved = (await f.services.store.list())[0];
    assert.equal(saved.content, original.content);
    assert.equal(saved.snapshot.sha256, original.snapshot.sha256);
    assert.equal(saved.note, "付款重试");
    const search = await f.call("/favorites?q=付款&tag=Java");
    assert.equal(search.items[0].id, id);
    assert.equal(search.allCount, 1);
    assert.equal((await f.call("/favorites?q=unrelated")).total, 0);
    const detail = await f.call(`/favorites/${id}`);
    assert.ok(detail.markdown.includes("Use RetryPolicy"));
    assert.equal(detail.favorite.directorySnapshot, undefined);
    await f.call(`/favorites/${id}/verification`, "POST", {
      verification: { status: "verified", project: "payments", version: "v2", date: "2026-10-18" },
    });
    await f.call(`/favorites/${id}/feedback`, "POST", { result: "helpful" });
    assert.equal((await f.services.store.list())[0].verification?.status, "verified");
    assert.equal((await f.services.store.list())[0].reuseFeedback?.helpful, 1);
    const packed = await f.call("/pack", "POST", { ids: [id, id], mode: "full", maxChars: 1600 });
    assert.ok(packed.markdown.includes("retry()"));
    assert.ok(packed.markdown.length <= 1600);
    await f.call(`/favorites/${id}/verification`, "POST", { verification: { status: "invalid" } });
    assert.equal((await f.call("/favorites")).total, 0);
    assert.equal((await f.call("/favorites?verification=invalid")).total, 1);
    // Writes through the existing store immediately become visible through the web API.
    await f.services.store.add(
      capturedDraft("来自 Raycast", "another answer", "manual", { label: "Raycast fixture" }),
      { title: "来自 Raycast", tags: [], note: "" },
    );
    assert.equal((await f.call("/favorites?q=another")).total, 1);
    await Promise.all([
      f.call("/favorites", "POST", { kind: "text", title: "Web concurrent", content: "concurrent web" }),
      f.services.store.add(capturedDraft("Ray concurrent", "concurrent raycast", "manual", { label: "fixture" }), {
        title: "Ray concurrent",
        tags: [],
        note: "",
      }),
    ]);
    assert.equal((await f.services.store.list()).length, 4);
    assert.equal(
      (await f.call(`/favorites/${id}`)).versions.length,
      1,
      "unlinked captures with the same generic label are separate items",
    );
    await f.call(`/favorites/${id}`, "DELETE");
    assert.equal((await f.services.store.list()).length, 3);
  } finally {
    await f.cleanup();
  }
});

test("web captures complete HTML directories from encoded file URLs, serves resources safely, keeps versions and merges full backups", async () => {
  const f = await fixture();
  try {
    const source = join(f.root, "指标 #指南");
    await mkdir(join(source, "assets"), { recursive: true });
    const html =
      '<title>指标指南</title><h1>连接池</h1><link rel="stylesheet" href="assets/site.css"><script>document.title="动态页面"</script>';
    await writeFile(join(source, "index.html"), html);
    await writeFile(join(source, "assets/site.css"), "h1{color:green}");
    await writeFile(join(source, "assets/picture.png"), Buffer.from([0, 255, 137]));
    const first = await f.call("/favorites", "POST", {
      kind: "file",
      path: pathToFileURL(join(source, "index.html")).href,
    });
    assert.equal(first.favorite.directory.fileCount, 3);
    assert.equal(first.favorite.directorySnapshot, undefined);
    assert.equal((await f.call("/favorites", "POST", { kind: "file", path: source })).existed, true);
    await writeFile(join(source, "assets/site.css"), "h1{color:blue}");
    const second = await f.call("/favorites", "POST", { kind: "file", path: source });
    const versions = await f.call(`/favorites/${first.favorite.id}`);
    assert.equal(versions.versions.length, 2);
    assert.ok(
      (await f.call(`/favorites/${first.favorite.id}/diff?other=${second.favorite.id}`)).diff.includes(
        "assets/site.css",
      ),
    );
    await f.call(`/favorites/${first.favorite.id}/recommend`, "POST", {});
    assert.equal((await f.services.store.list()).filter((v) => v.recommended).length, 1);
    await rm(source, { recursive: true });
    const view = await f.call(`/favorites/${first.favorite.id}/view`, "POST", {});
    const entry = await fetch(view.url);
    assert.equal(await entry.text(), html);
    assert.match(entry.headers.get("content-security-policy")!, /sandbox allow-scripts/);
    const resource = await fetch(new URL("assets/site.css", view.url));
    assert.equal(await resource.text(), "h1{color:green}");
    assert.equal(resource.headers.get("access-control-allow-origin"), "*");
    assert.equal((await fetch(`${f.origin}/view/invalid/index.html`)).status, 404);
    const plain = join(f.root, "plain");
    await mkdir(plain);
    await writeFile(join(plain, "guide.md"), "plain folder");
    const folder = await f.call("/favorites", "POST", { kind: "file", path: plain });
    const directory = await f.call(`/favorites/${folder.favorite.id}/view`, "POST", {});
    assert.ok((await (await fetch(directory.url)).text()).includes("guide.md"));
    const backup = await f.call("/backup");
    assert.equal(backup.favorites.length, 3);
    assert.equal(backup.favorites[0].directorySnapshot.files.length, 3);
    assert.equal((await f.call("/restore/preview", "POST", backup)).count, 3);
    await f.call(`/favorites/${first.favorite.id}`, "DELETE");
    const merged = await f.call("/restore", "POST", backup);
    assert.equal(merged.added, 1);
    assert.equal(merged.skipped, 2);
    assert.equal((await f.services.store.list()).length, 3);
    const before = await readFile(f.services.store.filePath, "utf8");
    const broken = await fetch(`${f.origin}/api/restore`, {
      method: "POST",
      headers: { Authorization: `Bearer ${f.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...backup, sha256: "wrong" }),
    });
    assert.equal(broken.status, 400);
    assert.equal(await readFile(f.services.store.filePath, "utf8"), before);
  } finally {
    await f.cleanup();
  }
});

test("web history browses actual provider records and captures sessions and replies with their original question", async () => {
  const f = await fixture();
  try {
    const list = await f.call("/sessions");
    assert.equal(list.total, 1);
    const key = list.items[0].key;
    const detail = await f.call(`/sessions/${key}`);
    assert.equal(detail.session.messages.length, 2);
    const reply = await f.call("/favorites", "POST", { kind: "message", sessionKey: key, messageId: "reply" });
    assert.equal(reply.favorite.context.question, "如何避免重复扣款？");
    assert.equal(reply.favorite.source.line, 3);
    const session = await f.call("/favorites", "POST", { kind: "session", sessionKey: key });
    assert.equal(session.favorite.type, "session");
    assert.ok(session.favorite.content.includes("processOnce"));
    const file = join(f.root, "generated.md");
    await writeFile(file, "current file version");
    const standalone = await f.call("/favorites", "POST", { kind: "file", path: file });
    assert.equal(standalone.favorite.provider, "manual");
    assert.equal(standalone.favorite.projectPath, f.root);
    const draft = { ...(await fileDraft(file)), provider: "manual" as const, projectPath: f.root };
    assert.equal((await f.services.store.add(draft, { title: draft.title, tags: [], note: "" })).existed, true);
    const linked = await f.call("/favorites", "POST", { kind: "file", path: file, sessionKey: key });
    assert.equal(linked.favorite.sessionId, "web-session");
    assert.equal(linked.favorite.provider, "codex");
  } finally {
    await f.cleanup();
  }
});

test("local service rejects missing credentials, foreign origins and Host headers, malformed writes and unsupported source URLs", async () => {
  const f = await fixture();
  try {
    const root = await fetch(f.origin);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /AI 收藏夹/);
    assert.match(root.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
    assert.equal((await fetch(`${f.origin}/api/favorites`)).status, 401);
    const auth = { Authorization: `Bearer ${f.token}` };
    assert.equal(
      (await fetch(`${f.origin}/api/favorites`, { headers: { ...auth, Origin: "https://foreign.invalid" } })).status,
      403,
    );
    assert.equal(
      await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(
          `${f.origin}/api/favorites`,
          { headers: { ...auth, Host: "foreign.invalid" } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        request.on("error", reject);
        request.end();
      }),
      403,
    );
    assert.equal(
      (
        await fetch(`${f.origin}/api/favorites`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: '{"kind":"text","content":"ok","sourceUrl":"javascript:alert(1)"}',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${f.origin}/api/favorites`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: '{"kind":"text","content":"ok","tags":4}',
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(`${f.origin}/api/favorites`, { method: "POST", headers: auth, body: "bad" })).status,
      415,
    );
    assert.equal((await fetch(`${f.origin}/../../favorites.json`)).status, 404);
    assert.equal((await f.services.store.list()).length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Raycast launcher starts a real detached service, reuses concurrent opens, replaces changed web assets and recovers a stopped service", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-web-launch-"));
  const assets = join(root, "assets");
  await cp(resolve("assets/web"), assets, { recursive: true });
  const preferences: Preferences = { storageDirectory: join(root, "library"), openCodexLinks: false };
  const entry = join(assets, "server.cjs");
  let latest: string | undefined;
  async function stop(url: string) {
    const parsed = new URL(url);
    await fetch(`${parsed.origin}/api/shutdown`, {
      method: "POST",
      headers: { Authorization: `Bearer ${new URLSearchParams(parsed.hash.slice(1)).get("token")}` },
    }).catch(() => {});
  }
  try {
    const urls = await Promise.all([
      ensureWebServer(preferences, entry),
      ensureWebServer(preferences, entry),
      ensureWebServer(preferences, entry),
    ]);
    latest = urls[0];
    assert.ok(urls.every((url) => url === latest));
    const state = JSON.parse(
      await readFile(join(preferences.storageDirectory!, "web-service.json"), "utf8"),
    ) as WebState;
    assert.ok(await reachable(state));
    assert.equal((await stat(join(preferences.storageDirectory!, "web-service.json"))).mode & 0o777, 0o600);
    await writeFile(
      join(assets, "style.css"),
      (await readFile(join(assets, "style.css"), "utf8")) + "\n/* changed asset */\n",
    );
    const changed = await ensureWebServer(preferences, entry);
    assert.notEqual(changed, latest);
    latest = changed;
    await stop(changed);
    latest = await ensureWebServer(preferences, entry);
    assert.notEqual(latest, changed);
    assert.match(new URL(latest).origin, /^http:\/\/127\.0\.0\.1:/);
  } finally {
    if (latest) await stop(latest);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await rm(root, { recursive: true, force: true });
  }
});

test("history list, search, reading and saving reuse one scan; explicit refresh performs a new scan", async () => {
  const f = await fixture();
  const scan = f.services.sync.sync.bind(f.services.sync);
  let scans = 0;
  f.services.sync.sync = async () => {
    scans++;
    await new Promise((resolve) => setTimeout(resolve, 40));
    return scan();
  };
  try {
    const [list] = await Promise.all([f.call("/sessions"), f.call("/sessions?q=web"), f.call("/sessions?offset=0")]);
    assert.equal(scans, 1);
    const key = list.items[0].key;
    await f.call(`/sessions/${key}`);
    await f.call("/favorites", "POST", { kind: "message", sessionKey: key, messageId: "reply" });
    assert.equal(scans, 1);
    await f.call("/sessions?refresh=1");
    assert.equal(scans, 2);
    assert.equal((await f.services.store.list())[0].context?.question, "如何避免重复扣款？");
  } finally {
    await f.cleanup();
  }
});

test("history categories separate providers and calendar periods before pagination, with whole-result counts and scoped search", async () => {
  const f = await fixture();
  try {
    const original = await f.services.sync.sync();
    const base = original.sessions[0];
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(Date.now());
    const today = Date.parse(`${date}T12:00:00+08:00`),
      yesterday = today - 86400000,
      old = today - 4 * 86400000;
    const summary = (id: string, provider: "codex" | "grok" | "kiro", updatedAt: number) => ({
      ...base,
      id,
      provider,
      title: id,
      updatedAt,
    });
    const sessions = [
      summary("target-grok-today", "grok", today),
      summary("grok-yesterday", "grok", yesterday),
      summary("grok-old", "grok", old),
      ...Array.from({ length: 45 }, (_, n) => summary(`codex-old-${n}`, "codex", old)),
      summary("target-codex-today", "codex", today),
      summary("codex-yesterday", "codex", yesterday),
      summary("kiro-old", "kiro", old),
    ];
    f.services.sync.sync = async () => ({ ...original, sessions });
    const all = await f.call("/sessions");
    assert.deepEqual(
      all.categories.map((c: { provider: string }) => c.provider),
      ["codex", "grok", "kiro"],
    );
    assert.equal(all.total, 51);
    assert.equal(all.items.length, 40);
    assert.deepEqual(all.categories[0].periods, { today: 1, yesterday: 1, history: 45 });
    const current = await f.call("/sessions?provider=codex&period=today");
    assert.equal(current.total, 1);
    assert.equal(current.items[0].id, "target-codex-today");
    const previous = await f.call("/sessions?provider=grok&period=yesterday");
    assert.equal(previous.total, 1);
    assert.equal(previous.items[0].id, "grok-yesterday");
    const page = await f.call("/sessions?provider=codex&period=history&offset=40");
    assert.equal(page.total, 45);
    assert.equal(page.items.length, 5);
    assert.ok(page.items.every((s: { provider: string }) => s.provider === "codex"));
    const search = await f.call("/sessions?q=target&provider=codex&period=today");
    assert.equal(search.total, 1);
    assert.deepEqual(
      search.categories.map((c: { count: number }) => c.count),
      [1, 1, 0],
    );
  } finally {
    await f.cleanup();
  }
});
