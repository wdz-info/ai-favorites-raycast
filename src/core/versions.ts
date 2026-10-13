import { createTwoFilesPatch } from "diff";
import { AIFavorite } from "./types";

export function versionKey(f: AIFavorite): string {
  return f.versionGroupId || naturalVersionKey(f);
}

export function naturalVersionKey(
  f: Pick<AIFavorite, "provider" | "type" | "projectPath" | "filePath" | "sessionId" | "messageId" | "source"> & {
    id?: string;
  },
): string {
  return JSON.stringify([
    f.provider,
    f.type,
    f.projectPath || "",
    f.type === "file" ? f.filePath : f.sessionId,
    f.type === "message" ? f.messageId || f.source.label || f.id : "",
  ]);
}

export function snapshotDiff(before: AIFavorite, after: AIFavorite): string {
  // Context is part of a reply snapshot, so changes to the question must also be visible.
  const text = (f: AIFavorite) =>
    [
      f.context?.question ? `用户问题:\n${f.context.question}\n\n` : "",
      f.context?.previousAssistant ? `上一条回复:\n${f.context.previousAssistant}\n\n` : "",
      f.content,
    ].join("");
  const result = createTwoFilesPatch(
    `${before.title} (${before.snapshot.sha256.slice(0, 12)})`,
    `${after.title} (${after.snapshot.sha256.slice(0, 12)})`,
    text(before),
    text(after),
    "旧快照",
    "新快照",
    { context: 3, timeout: 3000 },
  );
  if (result === undefined) throw new Error("快照差异过大，暂时无法生成差异；可分别打开完整内容。");
  return result;
}
