import { createHash } from "node:crypto";
import { open, lstat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { directoryDraft } from "./directory-snapshot";
import { TextDecoder } from "node:util";
import { sessionMarkdown } from "./markdown";
import { expandPath } from "./paths";
import { FavoriteDraft, Session, SessionFile, SessionMessage } from "./types";

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function sessionDraft(session: Session): FavoriteDraft {
  const content = sessionMarkdown(session);
  if (!session.messages.length) throw new Error("该会话还没有可收藏的消息。");
  return {
    type: "session",
    provider: session.provider,
    sessionId: session.id,
    projectPath: session.projectPath,
    title: session.title,
    content,
    source: session.source || { logPath: session.logPath },
    snapshot: { sha256: sha256(content), capturedAt: Date.now(), sourceFingerprint: session.fingerprint },
  };
}

export function messageDraft(session: Session, message: SessionMessage): FavoriteDraft {
  if (message.role !== "assistant") throw new Error("请选择一条 AI 回复进行收藏。");
  const index = session.messages.findIndex((m) => m.id === message.id);
  if (index < 0) throw new Error("所选会话中不存在这条回复。");
  const preceding = session.messages.slice(0, index);
  const question = preceding.findLast((m) => m.role === "user");
  const previousAssistant = preceding.findLast((m) => m.role === "assistant" && m.line > (question?.line || 0));
  const context = { question: question?.content, previousAssistant: previousAssistant?.content };
  return {
    type: "message",
    provider: session.provider,
    sessionId: session.id,
    messageId: message.id,
    projectPath: session.projectPath,
    title:
      message.content
        .replace(/[#*`>]/g, "")
        .split("\n")
        .find((l) => l.trim())
        ?.slice(0, 100) || session.title,
    content: message.content,
    context,
    source: message.source || { logPath: session.logPath, line: message.line },
    snapshot: {
      sha256: sha256(JSON.stringify({ content: message.content, context })),
      capturedAt: Date.now(),
      sourceFingerprint: session.fingerprint,
    },
  };
}

export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function fileDraft(path: string, session?: Session, sourceFile?: SessionFile): Promise<FavoriteDraft> {
  const filePath = expandPath(path);
  if ((await lstat(filePath)).isDirectory()) return directoryDraft(filePath, session);
  if (/^index\.html?$/i.test(basename(filePath))) return directoryDraft(dirname(filePath), session, basename(filePath));
  const handle = await open(filePath, "r");
  let content: string;
  let modifiedAt: number;
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("请选择普通文本文件。");
    if (before.size > MAX_FILE_BYTES) throw new Error("文件快照支持最大 8 MiB 的文本文件。");
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    let count = 0;
    while (count < bytes.length) {
      const result = await handle.read(bytes, count, bytes.length - count, null);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    if (count > MAX_FILE_BYTES) throw new Error("文件快照支持最大 8 MiB 的文本文件。");
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw new Error("读取期间文件发生变化，请重试。");
    const buffer = bytes.subarray(0, count);
    if (buffer.includes(0)) throw new Error("二进制文件无法作为文本预览，请选择 UTF-8 文件。");
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw new Error("文件不是有效的 UTF-8 文本。");
    }
    modifiedAt = after.mtimeMs;
  } finally {
    await handle.close();
  }
  return {
    type: "file",
    provider: session?.provider || "codex",
    sessionId: session?.id,
    projectPath: session?.projectPath,
    filePath,
    title: basename(filePath),
    content,
    source:
      session?.source?.format === "json" || session?.source?.format === "sqlite"
        ? session.source
        : { logPath: session?.logPath, line: sourceFile?.line },
    snapshot: {
      sha256: sha256(content),
      capturedAt: Date.now(),
      fileModifiedAt: modifiedAt,
      sourceFingerprint: session?.fingerprint,
    },
  };
}
