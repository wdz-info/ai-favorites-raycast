import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { DirectorySnapshot, FavoriteDraft, Session } from "./types";

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 2000;
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const safePath = (path: string) =>
  !!path &&
  !path.includes("\\") &&
  !path.includes("\0") &&
  !path.startsWith("/") &&
  path.split("/").every((part) => !!part && part !== "." && part !== "..");

export function validDirectorySnapshot(value: unknown): value is DirectorySnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as DirectorySnapshot;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.files) || snapshot.files.length > MAX_FILES) return false;
  let bytes = 0;
  const paths = new Set<string>();
  for (const file of snapshot.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !safePath(file.path) ||
      paths.has(file.path) ||
      typeof file.base64 !== "string" ||
      file.base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64) ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      return false;
    bytes += (file.base64.length / 4) * 3;
    if (bytes > MAX_BYTES + MAX_FILES * 2) return false;
    paths.add(file.path);
  }
  // A file cannot also be the parent directory of another file.
  for (const path of paths) {
    let parent = posix.dirname(path);
    while (parent !== ".") {
      if (paths.has(parent)) return false;
      parent = posix.dirname(parent);
    }
  }
  return snapshot.entryPath === undefined || (typeof snapshot.entryPath === "string" && paths.has(snapshot.entryPath));
}

export function directoryHash(snapshot: DirectorySnapshot) {
  return digest(JSON.stringify([snapshot.entryPath || "", snapshot.files.map((f) => [f.path, f.sha256])]));
}

function readableHtml(html: string) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

export async function directoryDraft(root: string, session?: Session, entryPath?: string): Promise<FavoriteDraft> {
  const files: DirectorySnapshot["files"] = [];
  let total = 0;
  async function visit(directory: string, prefix = "") {
    const before = await lstat(directory);
    if (!before.isDirectory() || before.isSymbolicLink()) throw new Error("目录快照不支持符号链接，请选择实际目录。");
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!safePath(path)) throw new Error(`目录包含不支持的文件名：${path}`);
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`目录包含符号链接：${path}。请使用包含实际资源的目录。`);
      if (entry.isDirectory()) {
        await visit(absolute, path);
        continue;
      }
      if (!entry.isFile()) throw new Error(`目录包含非普通文件：${path}`);
      if (files.length >= MAX_FILES) throw new Error("目录快照最多支持 2000 个文件。");
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || total + stat.size > MAX_BYTES) throw new Error("目录快照总大小不能超过 64 MiB。");
        const bytes = Buffer.alloc(stat.size + 1);
        let count = 0;
        while (count < bytes.length) {
          const result = await handle.read(bytes, count, bytes.length - count, null);
          if (!result.bytesRead) break;
          count += result.bytesRead;
        }
        const after = await handle.stat();
        if (
          count !== stat.size ||
          stat.size !== after.size ||
          stat.mtimeMs !== after.mtimeMs ||
          stat.ctimeMs !== after.ctimeMs
        )
          throw new Error("读取期间目录文件发生变化，请重试。");
        const content = bytes.subarray(0, count);
        total += count;
        files.push({ path, base64: content.toString("base64"), sha256: digest(content) });
      } finally {
        await handle.close();
      }
    }
    const after = await lstat(directory);
    if (before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw new Error("读取期间目录发生变化，请重试。");
  }
  await visit(root);
  entryPath ||= ["index.html", "index.htm"].find((name) => files.some((f) => f.path === name));
  if (entryPath && !files.some((f) => f.path === entryPath)) throw new Error("目录入口文件不存在。");
  const directorySnapshot: DirectorySnapshot = { version: 1, entryPath, files };
  const entry = files.find((f) => f.path === entryPath);
  const html = entry ? Buffer.from(entry.base64, "base64").toString("utf8") : "";
  const title =
    readableHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 150) || basename(root);
  const preview = readableHtml(html).slice(0, 150000);
  return {
    type: "file",
    provider: session?.provider || "manual",
    sessionId: session?.id,
    projectPath: session?.projectPath,
    filePath: root,
    title,
    directorySnapshot,
    content: `目录快照 · ${files.length} 个文件 · ${(total / 1024 / 1024).toFixed(1)} MiB\n入口：${entryPath || "无（打开目录）"}\n\n${preview}\n\n文件清单：\n${files.map((f) => f.path).join("\n")}`,
    source: session?.source || { logPath: session?.logPath },
    snapshot: {
      sha256: directoryHash(directorySnapshot),
      capturedAt: Date.now(),
      sourceFingerprint: session?.fingerprint,
    },
  };
}

// Always rebuild from the embedded immutable version, never from the current source directory.
export async function materializeDirectory(snapshot: DirectorySnapshot, expectedHash: string, storage: string) {
  if (!validDirectorySnapshot(snapshot) || directoryHash(snapshot) !== expectedHash)
    throw new Error("目录快照格式或校验和无效。");
  const parent = join(storage, "directory-previews");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if ((await lstat(parent)).isSymbolicLink()) throw new Error("快照输出目录不能是符号链接。");
  const root = await mkdtemp(join(parent, "snapshot-"));
  try {
    for (const file of snapshot.files) {
      const bytes = Buffer.from(file.base64, "base64");
      if (digest(bytes) !== file.sha256) throw new Error(`目录资源校验失败：${file.path}`);
      const target = join(root, file.path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    }
    return snapshot.entryPath ? pathToFileURL(join(root, snapshot.entryPath)).href : root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
