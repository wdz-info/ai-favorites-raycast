import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { FavoriteReader, RetrievalMode, summarizeHit } from "./core/reader";
import { FavoriteStore } from "./core/store";
import { storageDirectory } from "./core/paths";
import { createServices } from "./services";

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      storage: { type: "string" },
      mode: { type: "string" },
      project: { type: "string" },
      "task-version": { type: "string" },
      verification: { type: "string" },
      "include-invalid": { type: "boolean" },
      limit: { type: "string" },
      offset: { type: "string" },
      "max-chars": { type: "string" },
      task: { type: "string" },
      "pack-mode": { type: "string" },
      "include-paths": { type: "boolean" },
      "embedding-model": { type: "string" },
      "embedding-endpoint": { type: "string" },
      help: { type: "boolean" },
    },
  });
  const directory = storageDirectory(values.storage || process.env.AI_FAVORITES_STORAGE);
  const reader = new FavoriteReader(new FavoriteStore(directory), {
    model: values["embedding-model"] || process.env.AI_FAVORITES_EMBEDDING_MODEL,
    endpoint: values["embedding-endpoint"] || process.env.AI_FAVORITES_EMBEDDING_ENDPOINT,
  });
  const [command, ...args] = positionals;
  if (values.help || !command) {
    process.stdout.write(
      "AI Favorites: search <query> | get <id> | pack <id...> | history <query> | mcp | web\nOptions: --storage <absolute path>, --mode exact|smart|hybrid, --project <path>, --task-version <version>, --verification verified|unverified|invalid, --include-invalid, --limit <1-100>, --offset <n>, --max-chars <n>, --pack-mode full|compact|code, --task <text>, --include-paths\nMCP serves curated favorites only. history explicitly reads and indexes the existing local Agent logs.\n",
    );
    return;
  }
  if (command === "web") {
    const { ensureWebServer } = await import("./web/launcher");
    const url = await ensureWebServer(
      { storageDirectory: directory, openCodexLinks: true },
      resolve(__dirname, "../assets/web/server.cjs"),
    );
    process.stdout.write(url + "\n");
    return;
  }
  if (command === "mcp") {
    const { serveFavorites } = await import("./mcp");
    await serveFavorites(reader);
    return;
  }
  const mode = values.mode || "exact";
  if (!["exact", "smart", "hybrid"].includes(mode)) throw new Error("mode 应为 exact、smart 或 hybrid。");
  if (values.verification && !["verified", "unverified", "invalid"].includes(values.verification))
    throw new Error("验证状态无效。");
  const limit = Number(values.limit || 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit 应为 1–100。");
  let result: unknown;
  if (command === "search") {
    const found = await reader.search(
      args.join(" "),
      {
        project: values.project,
        version: values["task-version"],
        verification: values.verification as "verified" | "unverified" | "invalid" | undefined,
        includeInvalid: !!values["include-invalid"],
      },
      mode as RetrievalMode,
      limit,
    );
    result = { results: found.hits.map(summarizeHit), warnings: found.warnings };
  } else if (command === "get")
    result = await reader.get(args[0], Number(values.offset || 0), Number(values["max-chars"] || 12000));
  else if (command === "pack") {
    const packMode = values["pack-mode"] || "compact";
    if (!["full", "compact", "code"].includes(packMode)) throw new Error("pack-mode 无效。");
    result = {
      markdown: await reader.pack(args, values.task || "", {
        mode: packMode as "compact" | "full" | "code",
        maxChars: Number(values["max-chars"] || 20000),
        includePaths: !!values["include-paths"],
      }),
    };
  } else if (command === "history") {
    if (!args.join(" ").trim()) throw new Error("请输入历史查询词。");
    const services = createServices({ storageDirectory: directory, openCodexLinks: false });
    const status = await services.historyIndex.refresh(await services.sync.sync());
    const hits = await services.historyIndex.search(args.join(" "), {
      mode: mode === "exact" ? "exact" : "smart",
      project: values.project,
      limit,
    });
    result = {
      results: hits.map(({ summary, message, snippet, matches }) => ({
        sessionId: summary.id,
        provider: summary.provider,
        title: summary.title,
        project: summary.projectPath,
        messageId: message.id,
        source: message.source || { logPath: summary.logPath, line: message.line },
        snippet,
        matches,
      })),
      warnings: status.warnings,
    };
  } else throw new Error("未知命令，请使用 --help。");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (require.main === module)
  void main().catch((error) => {
    process.stderr.write((error as Error).message + "\n");
    process.exitCode = 1;
  });
