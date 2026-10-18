import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { FavoriteStore } from "../src/core/store";
import { capturedDraft } from "../src/core/capture";

const execute = promisify(execFile);
test("real stdio MCP client initializes, lists only read tools, searches, paginates and packs without modifying favorites", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-favorites-mcp-"));
  const store = new FavoriteStore(root);
  const { favorite } = await store.add(
    capturedDraft("Retry", "RetryPolicy solves timeouts. ".repeat(400), "manual", { label: "synthetic" }),
    { title: "Retry", tags: [], note: "" },
  );
  const before = await readFile(store.filePath, "utf8");
  const entry = process.env.AI_FAVORITES_TEST_BUILT
    ? [resolve("build/ai-favorites.cjs")]
    : ["--import", "tsx", resolve("src/cli.ts")];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...entry, "mcp", "--storage", root],
    stderr: "pipe",
  });
  const client = new Client({ name: "favorites-protocol-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["search_favorites", "get_favorite", "build_context_pack"],
    );
    assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint));
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      const content = result.content as { type: string; text: string }[];
      return JSON.parse(content[0].text);
    };
    assert.equal((await call("search_favorites", { query: "RetryPolicy" })).results[0].id, favorite.id);
    const page = await call("get_favorite", { id: favorite.id, offset: 5, maxChars: 30 });
    assert.equal(page.content, favorite.content.slice(5, 35));
    assert.equal(page.nextOffset, 35);
    const pack = await call("build_context_pack", { ids: [favorite.id], maxChars: 1500 });
    assert.ok(pack.markdown.length <= 1500);
    assert.ok(pack.markdown.includes(favorite.id));
    const invalid = await client.callTool({ name: "get_favorite", arguments: { id: favorite.id, offset: -1 } });
    assert.equal(invalid.isError, true);
    const unsupported = await client.callTool({ name: "delete_favorite", arguments: { id: favorite.id } });
    assert.equal(unsupported.isError, true);
    assert.equal(await readFile(store.filePath, "utf8"), before);
    const cli = await execute(process.execPath, [...entry, "search", "RetryPolicy", "--storage", root]);
    assert.equal(JSON.parse(cli.stdout).results[0].id, favorite.id);
    assert.equal(cli.stderr, "");
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
