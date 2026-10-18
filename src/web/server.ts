import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { createServices } from "../services";
import { AIFavorite, FavoriteDraft, FavoriteMetadata, ProviderId } from "../core/types";
import { capturedDraft } from "../core/capture";
import { fileDraft, messageDraft, sessionDraft, sha256 } from "../core/favorite-service";
import { favoriteMarkdown } from "../core/markdown";
import { FavoriteSearchIndex } from "../core/search";
import { contextPack } from "../core/knowledge";
import { snapshotDiff, versionKey } from "../core/versions";
import { sessionKey } from "../providers/registry";
import { expandPath } from "../core/paths";
import { validDirectorySnapshot, directoryHash } from "../core/directory-snapshot";
import type { DetailResult, LibraryResult, WebFavorite } from "./types";
import type { HistoryCatalog } from "../core/sync";
import { historyPeriod, historyPeriods, historyPrograms } from "./history-groups";

export const WEB_API_VERSION = 1;
const BODY_LIMIT = 128 * 1024 * 1024;
const providers: ProviderId[] = ["manual", "codex", "kiro", "grok", "claude", "gemini", "opencode"];
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function text(value: unknown, name: string, fallback = "", limit = 2000000): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > limit) throw new HttpError(400, `${name}格式或长度无效。`);
  return value;
}
function metadata(body: Record<string, unknown>, defaultTitle = ""): FavoriteMetadata {
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.some((v) => typeof v !== "string")))
    throw new HttpError(400, "标签格式无效。");
  return {
    title: text(body.title, "标题", defaultTitle, 500),
    tags: (body.tags || []) as string[],
    note: text(body.note, "备注"),
    applicability: text(body.applicability, "适用条件"),
  };
}
async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "请发送 JSON。");
  const chunks: Buffer[] = [];
  let count = 0;
  for await (const chunk of request) {
    count += chunk.length;
    if (count > BODY_LIMIT) throw new HttpError(413, "请求超过 128 MiB；大备份请使用 Raycast 的本地恢复功能。");
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON 无效。");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "请求内容应为对象。");
  return body as Record<string, unknown>;
}
function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
function publicFavorite(favorite: AIFavorite): WebFavorite {
  const { directorySnapshot, ...rest } = favorite;
  return {
    ...rest,
    ...(directorySnapshot
      ? { directory: { entryPath: directorySnapshot.entryPath, fileCount: directorySnapshot.files.length } }
      : {}),
  };
}

export async function startWebServer(options: {
  services: ReturnType<typeof createServices>;
  assetsDirectory: string;
  buildId?: string;
  profileKey?: string;
}) {
  const { services, assetsDirectory } = options;
  const { store, provider, sync } = services;
  const token = randomBytes(32).toString("hex");
  const views = new Map<string, AIFavorite["directorySnapshot"]>();
  const assets = new Map(
    await Promise.all(
      ["index.html", "app.js", "style.css"].map(
        async (name) => [name, await readFile(join(assetsDirectory, name))] as const,
      ),
    ),
  );
  let origin = "";
  let catalog: HistoryCatalog | undefined;
  let catalogRead: Promise<HistoryCatalog> | undefined;
  let catalogReadAt = 0;
  async function historyCatalog(refresh = false): Promise<HistoryCatalog> {
    if (catalogRead) return catalogRead;
    if (!refresh && catalog && Date.now() - catalogReadAt < 15000) return catalog;
    catalogRead = sync.sync().then((value) => {
      catalog = value;
      catalogReadAt = Date.now();
      return value;
    });
    try {
      return await catalogRead;
    } finally {
      catalogRead = undefined;
    }
  }
  async function favorite(id: string) {
    const found = (await store.list()).find((f) => f.id === id);
    if (!found) throw new HttpError(404, "该收藏已不存在，请刷新列表。");
    return found;
  }
  async function findSession(key: string) {
    const catalog = await historyCatalog();
    const summary = catalog.sessions.find((s) => sha256(sessionKey(s)) === key);
    if (!summary) throw new HttpError(404, "会话已不存在，请刷新历史列表。");
    return provider.readSession(summary);
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      json(
        response,
        { error: error instanceof Error ? error.message : String(error) },
        error instanceof HttpError ? error.status : 400,
      );
    });
  });
  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (request.headers.host !== new URL(origin).host) throw new HttpError(403, "主机地址无效。");
    const url = new URL(request.url || "/", origin);
    const path = url.pathname;
    const method = request.method || "GET";
    // Snapshot pages get an opaque sandbox origin and a separate, resource-only capability.
    if (path.startsWith("/view/") && method === "GET") {
      const [, , grant, ...parts] = path.split("/");
      const snapshot = views.get(grant);
      const resource = parts.map(decodeURIComponent).join("/");
      if (snapshot && !resource && !snapshot.entryPath) {
        const escape = (value: string) =>
          value.replace(
            /[&<>"']/g,
            (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
          );
        response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; base-uri 'none'");
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(
          `<!doctype html><meta charset="utf-8"><title>目录快照</title><h1>已保存的目录</h1><ul>${snapshot.files.map((f) => `<li><a href="${f.path.split("/").map(encodeURIComponent).join("/")}">${escape(f.path)}</a></li>`).join("")}</ul>`,
        );
        return;
      }
      const file = snapshot?.files.find((f) => f.path === resource);
      if (!file) throw new HttpError(404, "快照资源不存在。");
      const bytes = Buffer.from(file.base64, "base64");
      if (sha256(bytes) !== file.sha256) throw new HttpError(400, "快照资源校验失败。");
      response.setHeader(
        "Content-Security-Policy",
        "sandbox allow-scripts allow-forms allow-popups; default-src 'self' data: blob: https: http:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http:; object-src 'none'",
      );
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Content-Type", mime[extname(file.path).toLowerCase()] || "application/octet-stream");
      response.end(bytes);
      return;
    }
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (path.startsWith("/api/")) {
      if (
        (request.headers.origin && request.headers.origin !== origin) ||
        request.headers["sec-fetch-site"] === "cross-site"
      )
        throw new HttpError(403, "不接受跨站请求。");
      const actual = Buffer.from(request.headers.authorization || "");
      const expected = Buffer.from(`Bearer ${token}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new HttpError(401, "连接凭证已失效，请从 Raycast 重新打开网页。");
      const params = url.searchParams;
      if (path === "/api/health" && method === "GET") {
        json(response, { apiVersion: WEB_API_VERSION, buildId: options.buildId, profileKey: options.profileKey });
        return;
      }
      if (path === "/api/shutdown" && method === "POST") {
        json(response, { stopped: true });
        setImmediate(() => server.close());
        return;
      }
      if (path === "/api/favorites" && method === "GET") {
        const favorites = await store.list();
        const type = params.get("type");
        const hits = new FavoriteSearchIndex(favorites).results(
          params.get("q") || "",
          {
            type: ["file", "session", "message"].includes(type || "") ? (type as AIFavorite["type"]) : undefined,
            project: params.has("project") ? params.get("project")! : undefined,
            tag: params.get("tag") || undefined,
            provider: providers.includes(params.get("provider") as ProviderId)
              ? (params.get("provider") as ProviderId)
              : undefined,
            verification: ["verified", "invalid", "unverified"].includes(params.get("verification") || "")
              ? (params.get("verification") as "verified")
              : undefined,
            includeInvalid: params.get("verification") === "all" || params.get("verification") === "invalid",
          },
          params.get("mode") === "smart" ? "smart" : "exact",
        );
        if (params.get("sort") === "updated") hits.sort((a, b) => b.favorite.updatedAt - a.favorite.updatedAt);
        if (params.get("sort") === "title") hits.sort((a, b) => a.favorite.title.localeCompare(b.favorite.title));
        const offset = Math.max(0, Number(params.get("offset")) || 0);
        const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 30));
        const result: LibraryResult = {
          items: hits.slice(offset, offset + limit).map(({ favorite: f, snippet }) => ({
            id: f.id,
            type: f.type,
            provider: f.provider,
            title: f.title,
            tags: f.tags,
            projectPath: f.projectPath,
            snippet,
            verification: f.verification,
            recommended: f.recommended,
            updatedAt: f.updatedAt,
            directory: !!f.directorySnapshot,
          })),
          total: hits.length,
          allCount: favorites.length,
          tags: [...new Set(favorites.flatMap((f) => f.tags))].sort(),
          projects: [...new Set(favorites.map((f) => f.projectPath).filter((p): p is string => !!p))].sort(),
          counts: Object.fromEntries(
            ["session", "message", "file"].map((type) => [type, favorites.filter((f) => f.type === type).length]),
          ),
        };
        json(response, result);
        return;
      }
      if (path === "/api/favorites" && method === "POST") {
        const body = await bodyOf(request);
        let draft: FavoriteDraft;
        if (body.kind === "file") {
          const session = body.sessionKey ? await findSession(text(body.sessionKey, "会话")) : undefined;
          const path = text(body.path, "路径");
          draft = await fileDraft(
            path,
            session,
            session?.files.find((file) => file.path === expandPath(path)),
          );
          if (!session) draft.provider = "manual";
        } else if (body.kind === "session" || body.kind === "message") {
          const session = await findSession(text(body.sessionKey, "会话"));
          if (body.kind === "session") draft = sessionDraft(session);
          else {
            const message = session.messages.find((m) => m.id === body.messageId);
            if (!message) throw new HttpError(404, "该回复不存在。");
            draft = messageDraft(session, message);
          }
        } else if (body.kind === "text") {
          const content = text(body.content, "正文");
          const title =
            text(body.title, "标题") ||
            content
              .split("\n")
              .find((l) => l.trim())
              ?.replace(/^[#*>\s]+/, "")
              .slice(0, 100) ||
            "文字收藏";
          const sourceUrl = text(body.sourceUrl, "来源链接").trim();
          if (sourceUrl && !/^(https?:|file:|codex:|obsidian:)\/\//i.test(sourceUrl))
            throw new HttpError(400, "来源链接格式无效。");
          draft = capturedDraft(title, content, "manual", {
            label: text(body.sourceLabel, "来源说明") || "网页手动收藏",
            url: sourceUrl || undefined,
            captureMethod: "manual",
          });
        } else throw new HttpError(400, "请选择收藏类型。");
        if (body.provider !== undefined) {
          if (!providers.includes(body.provider as ProviderId)) throw new HttpError(400, "来源无效。");
          if ((body.kind === "file" && !draft.sessionId) || body.kind === "text")
            draft.provider = body.provider as ProviderId;
        }
        if (typeof body.projectPath === "string" && body.projectPath.trim())
          draft.projectPath = expandPath(body.projectPath.trim());
        else if (body.kind === "file" && !draft.projectPath)
          draft.projectPath = draft.directorySnapshot ? draft.filePath : dirname(draft.filePath!);
        const result = await store.add(draft, metadata(body, draft.title));
        json(response, { favorite: publicFavorite(result.favorite), existed: result.existed }, 201);
        return;
      }
      if (path === "/api/sessions" && method === "GET") {
        const catalog = await historyCatalog(params.get("refresh") === "1");
        const query = (params.get("q") || "").toLocaleLowerCase();
        const searched = catalog.sessions.filter((s) =>
          `${s.title}\n${s.projectPath}\n${s.id}`.toLocaleLowerCase().includes(query),
        );
        const now = Date.now();
        const categories = historyPrograms(catalog.sessions.map((s) => s.provider)).map((provider) => {
          const sessions = searched.filter((s) => s.provider === provider);
          return {
            provider,
            count: sessions.length,
            periods: Object.fromEntries(
              historyPeriods.map((period) => [
                period,
                sessions.filter((s) => historyPeriod(s.updatedAt, now) === period).length,
              ]),
            ),
          };
        });
        const matching = searched.filter(
          (s) =>
            (!params.get("provider") || s.provider === params.get("provider")) &&
            (!params.get("period") || historyPeriod(s.updatedAt, now) === params.get("period")),
        );
        const offset = Math.max(0, Number(params.get("offset")) || 0);
        json(response, {
          items: matching.slice(offset, offset + 40).map((s) => ({ ...s, key: sha256(sessionKey(s)) })),
          total: matching.length,
          warnings: catalog.warnings,
          categories,
          now,
        });
        return;
      }
      const sessionMatch = path.match(/^\/api\/sessions\/([a-f0-9]{64})$/);
      if (sessionMatch && method === "GET") {
        json(response, { session: await findSession(sessionMatch[1]), key: sessionMatch[1] });
        return;
      }
      if (path === "/api/pack" && method === "POST") {
        const body = await bodyOf(request);
        if (!Array.isArray(body.ids) || !body.ids.length || body.ids.some((v) => typeof v !== "string"))
          throw new HttpError(400, "请选择收藏。");
        const favorites = await store.list();
        const selected = [...new Set(body.ids as string[])].map((id) => {
          const f = favorites.find((f) => f.id === id);
          if (!f) throw new HttpError(404, "所选收藏已不存在。");
          return f;
        });
        const mode = body.mode || "full";
        if (!["full", "compact", "code"].includes(String(mode))) throw new HttpError(400, "打包模式无效。");
        json(response, {
          markdown: contextPack(selected, text(body.task, "任务"), {
            mode: mode as "full",
            maxChars: body.maxChars === undefined ? 20000 : Number(body.maxChars),
            includePaths: body.includePaths !== false,
          }),
        });
        return;
      }
      if (path === "/api/backup" && method === "GET") {
        const temporary = await mkdtemp(join(tmpdir(), "ai-web-backup-"));
        try {
          const file = join(temporary, "backup.json");
          await store.backup(file);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Content-Disposition", 'attachment; filename="ai-favorites-backup.json"');
          response.end(await readFile(file));
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
        return;
      }
      if (["/api/restore/preview", "/api/restore"].includes(path) && method === "POST") {
        const body = await bodyOf(request);
        const temporary = await mkdtemp(join(tmpdir(), "ai-web-restore-"));
        try {
          const file = join(temporary, "backup.json");
          await writeFile(file, JSON.stringify(body), { mode: 0o600 });
          json(response, path.endsWith("preview") ? await store.previewRestore(file) : await store.restore(file));
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
        return;
      }
      const match = path.match(/^\/api\/favorites\/([^/]+)(?:\/(verification|feedback|recommend|diff|view))?$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const action = match[2];
        const item = await favorite(id);
        if (!action && method === "GET") {
          const result: DetailResult = {
            favorite: publicFavorite(item),
            markdown: favoriteMarkdown(item),
            versions: (await store.list())
              .filter((f) => versionKey(f) === versionKey(item))
              .sort((a, b) => b.snapshot.capturedAt - a.snapshot.capturedAt)
              .map((f) => ({
                id: f.id,
                title: f.title,
                capturedAt: f.snapshot.capturedAt,
                sha256: f.snapshot.sha256,
                recommended: f.recommended,
              })),
          };
          json(response, result);
          return;
        }
        if (!action && method === "PATCH") {
          await store.edit(id, metadata(await bodyOf(request)));
          json(response, { saved: true });
          return;
        }
        if (!action && method === "DELETE") {
          await store.remove(id);
          json(response, { removed: true });
          return;
        }
        if (action === "diff" && method === "GET") {
          json(response, { diff: snapshotDiff(item, await favorite(params.get("other") || "")) });
          return;
        }
        if (action === "view" && method === "POST") {
          const snapshot = item.directorySnapshot;
          if (!snapshot || !validDirectorySnapshot(snapshot) || directoryHash(snapshot) !== item.snapshot.sha256)
            throw new HttpError(400, "没有有效的目录快照。");
          const existing = [...views].find(([, saved]) => saved && directoryHash(saved) === item.snapshot.sha256);
          const grant = existing?.[0] || randomBytes(24).toString("hex");
          if (!existing) views.set(grant, snapshot);
          if (views.size > 30) views.delete(views.keys().next().value!);
          json(response, {
            url: `${origin}/view/${grant}/${snapshot.entryPath?.split("/").map(encodeURIComponent).join("/") || ""}`,
            files: snapshot.files.map((f) => f.path),
          });
          return;
        }
        if (method === "POST") {
          const body = await bodyOf(request);
          if (action === "verification") {
            if (!body.verification || typeof body.verification !== "object") throw new HttpError(400, "验证信息无效。");
            await store.setVerification(id, body.verification as AIFavorite["verification"] & {});
          } else if (action === "feedback") {
            if (body.result !== "helpful" && body.result !== "unresolved") throw new HttpError(400, "反馈无效。");
            await store.recordReuse(id, body.result);
          } else if (action === "recommend") await store.recommend(id);
          else throw new HttpError(405, "不支持该操作。");
          json(response, { saved: true });
          return;
        }
      }
      throw new HttpError(404, "接口不存在。");
    }
    if (method !== "GET") throw new HttpError(405, "不支持该操作。");
    const asset = path === "/" ? "index.html" : path.slice(1);
    const bytes = assets.get(asset);
    if (!bytes) throw new HttpError(404, "页面不存在。");
    response.setHeader("Content-Type", mime[extname(asset)] || "application/octet-stream");
    response.end(bytes);
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("本地服务启动失败。");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    origin,
    token,
    url: `${origin}/#token=${token}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}
